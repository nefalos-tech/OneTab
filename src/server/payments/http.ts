import { z } from "zod";
import type { AuthResult, WalletSession } from "../auth/service";
import { paymentFailure, publicPaymentError, PaymentFailure } from "./errors";
import type { PaymentService } from "./service";

const uuid = z.uuid().transform(value => value.toLowerCase());
const preparation = z.strictObject({ retryOfAttemptId: uuid.nullable().optional().default(null) });
const signature = z.strictObject({ messageHash: z.string().regex(/^[a-f0-9]{64}$/), signatureBase64: z.string().length(88) });
const empty = z.strictObject({});

export interface PaymentHandlerDependencies {
  requireSession(): Promise<AuthResult<WalletSession>>;
  originAllowed(request: Request): boolean;
  service(): PaymentService;
}

async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 4096) throw new PaymentFailure("INVALID_INPUT");
  try { return text.length === 0 ? {} : JSON.parse(text); }
  catch { throw new PaymentFailure("INVALID_INPUT"); }
}

function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new PaymentFailure("INVALID_INPUT");
  return result.data;
}

export function createPaymentHandlers(dependencies: PaymentHandlerDependencies) {
  async function authenticated(input: {
    request: Request; mutation: boolean; action(wallet: string): Promise<unknown>;
  }): Promise<Response> {
    try {
      if (input.mutation && !dependencies.originAllowed(input.request)) throw new PaymentFailure("ORIGIN_MISMATCH");
      const session = await dependencies.requireSession();
      if (!session.ok) throw new PaymentFailure(session.code);
      const data = await input.action(session.value.wallet);
      return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const failure = paymentFailure(error);
      return Response.json({ error: publicPaymentError(failure.code) }, {
        status: failure.status, headers: { "Cache-Control": "no-store" },
      });
    }
  }

  return {
    prepare(request: Request, checkoutId: string) {
      return authenticated({ request, mutation: true, action: async wallet => {
        const id = parsed(uuid, checkoutId);
        const input = parsed(preparation, await body(request));
        return dependencies.service().prepare({ checkoutId: id, wallet, ...input });
      } });
    },
    signingPayload(request: Request, attemptId: string) {
      return authenticated({ request, mutation: false, action: wallet => {
        const id = parsed(uuid, attemptId);
        return dependencies.service().signingPayload({ attemptId: id, wallet });
      } });
    },
    addSignature(request: Request, attemptId: string) {
      return authenticated({ request, mutation: true, action: async wallet => {
        const id = parsed(uuid, attemptId);
        const input = parsed(signature, await body(request));
        return dependencies.service().addSignature({ attemptId: id, wallet, ...input });
      } });
    },
    decline(request: Request, attemptId: string) {
      return authenticated({ request, mutation: true, action: async wallet => {
        const id = parsed(uuid, attemptId);
        parsed(empty, await body(request));
        return dependencies.service().decline({ attemptId: id, wallet });
      } });
    },
    submit(request: Request, attemptId: string) {
      return authenticated({ request, mutation: true, action: async wallet => {
        const id = parsed(uuid, attemptId);
        parsed(empty, await body(request));
        return dependencies.service().submit({ attemptId: id, wallet });
      } });
    },
    refresh(request: Request, attemptId: string) {
      return authenticated({ request, mutation: true, action: async wallet => {
        const id = parsed(uuid, attemptId);
        parsed(empty, await body(request));
        return dependencies.service().refresh({ attemptId: id, wallet });
      } });
    },
  };
}
