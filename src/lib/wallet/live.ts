import {
  looksLikeAddress,
  type AuthChallenge,
  type AuthVerifyRequest,
  type ErrorCode,
  type ErrorEnvelope,
  type Session,
} from "@/client/contracts";
import {
  authMessage,
  type Challenge,
  type ChallengeId,
  type ServiceFailure,
  type ServiceResult,
  type SignInService,
  type WalletBridge,
  type WalletEnvironment,
} from "./environment";

export function liveEnvironment(): WalletEnvironment {
  return { bridge: unavailableBridge, service: liveSignInService((path, init) => globalThis.fetch(path, init)) };
}

const unavailableBridge: WalletBridge = {
  connect: async () => ({ ok: false, failure: "failed" }),
  disconnect: async () => {},
  signAuthentication: async () => ({ ok: false, failure: "failed" }),
  signPayment: async () => ({ ok: false, failure: "failed" }),
  onAccountChange: () => () => {},
};

export type FetchLike = (path: string, init: RequestInit) => Promise<Response>;

const AUTH_TIMEOUT_MS = 10_000;
const SESSION_PATH = "/api/auth/session";
const CHALLENGE_PATH = "/api/auth/challenge";
const VERIFY_PATH = "/api/auth/verify";

const FAILURE_BY_CODE: Partial<Record<ErrorCode, ServiceFailure>> = {
  CHALLENGE_EXPIRED: "stale_challenge",
  CHALLENGE_USED: "stale_challenge",
  UNSUPPORTED_WALLET: "unsupported_wallet",
};

const UNAVAILABLE = { ok: false, failure: "unavailable" } as const;

type Reply = { readonly status: number; readonly body: unknown };

export function liveSignInService(fetchImpl: FetchLike): SignInService {
  const send = async (method: "GET" | "POST" | "DELETE", path: string, body?: object): Promise<Reply | null> => {
    try {
      const response = await fetchImpl(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
      return { status: response.status, body: await response.json().catch(() => undefined) };
    } catch {
      return null;
    }
  };

  return {
    async readSession() {
      const reply = await send("GET", SESSION_PATH);
      if (reply?.status === 401) return { ok: true, value: null };
      if (reply?.status !== 200) return failureOf(reply);
      const data = dataOf(reply.body);
      return data === null ? { ok: true, value: null } : parsed(parseSession(data));
    },
    async requestChallenge(wallet) {
      const reply = await send("POST", CHALLENGE_PATH, { wallet });
      return reply?.status === 200 ? parsed(parseChallenge(dataOf(reply.body))) : failureOf(reply);
    },
    async verify({ challengeId, signature }) {
      const request: AuthVerifyRequest = { challengeId, signatureBase64: signature };
      const reply = await send("POST", VERIFY_PATH, request);
      return reply?.status === 200 ? parsed(parseSession(dataOf(reply.body))) : failureOf(reply);
    },
    async endSession() {
      await send("DELETE", SESSION_PATH);
    },
  };
}

function failureOf(reply: Reply | null): { readonly ok: false; readonly failure: ServiceFailure } {
  const failure = isErrorEnvelope(reply?.body) ? FAILURE_BY_CODE[reply.body.error.code] : undefined;
  return { ok: false, failure: failure ?? "unavailable" };
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  return isRecord(body) && isRecord(body.error) && typeof body.error.code === "string";
}

function dataOf(body: unknown): unknown {
  return isRecord(body) && "data" in body ? body.data : undefined;
}

function parsed<T>(value: T | null): ServiceResult<T> {
  return value === null ? UNAVAILABLE : { ok: true, value };
}

function parseSession(data: unknown): Session | null {
  return isRecord(data) &&
    typeof data.wallet === "string" &&
    looksLikeAddress(data.wallet) &&
    typeof data.expiresAt === "string" &&
    Number.isFinite(Date.parse(data.expiresAt))
    ? { wallet: data.wallet, expiresAt: data.expiresAt }
    : null;
}

function parseChallenge(data: unknown): Challenge | null {
  if (!isAuthChallenge(data) || data.challengeId === "") return null;
  const bytes = fromBase64(data.messageBase64);
  const message = bytes && authMessage(bytes);
  return message ? { id: data.challengeId as ChallengeId, message } : null;
}

function isAuthChallenge(data: unknown): data is AuthChallenge {
  return (
    isRecord(data) &&
    typeof data.challengeId === "string" &&
    typeof data.messageBase64 === "string" &&
    typeof data.expiresAt === "string"
  );
}

function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
