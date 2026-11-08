import type { RoomSnapshot } from "../../contracts/index";
import { expectedOrigin, requireWalletSession } from "../auth/service";
import { getRoom, publicConfig } from "../rooms/service";
import { PaymentFailure } from "./errors";
import { createPaymentHandlers } from "./http";
import { createPaymentRpc } from "./rpc";
import { createPaymentService, type PaymentDependencies } from "./service";
import { createPaymentProgress } from "./settlement";
import { boundAttemptStore, boundLifecycle } from "./store-boundary";

export async function readPaymentRoom(input: { checkoutId: string }): Promise<RoomSnapshot | null> {
  const result = await getRoom(input.checkoutId);
  if (!result.ok) {
    if (result.code === "CHECKOUT_NOT_FOUND") return null;
    throw new PaymentFailure(result.code);
  }
  const room = result.value;
  return { checkout: { ...room.checkout }, phase: room.phase,
    participants: room.participants.map(payer => ({ ...payer })),
    attempt: room.attempt ? { ...room.attempt, signedWallets: [...room.attempt.signedWallets],
      receipt: room.attempt.receipt ? { ...room.attempt.receipt,
        contributions: room.attempt.receipt.contributions.map(payer => ({ ...payer })) } : null,
    } : null,
  };
}

async function durablePorts(): Promise<Pick<PaymentDependencies, "store" | "lifecycle" | "rpc"> | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const parsed = typeof supabaseUrl === "string" ? URL.parse(supabaseUrl) : null;
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return null;
  if (typeof key !== "string" || key.length === 0 || typeof rpcUrl !== "string" || rpcUrl.length === 0) return null;
  const rpc = createPaymentRpc({ url: rpcUrl });
  const { postgresAttemptStore } = await import("../attempt-store/postgres");
  return { store: postgresAttemptStore, lifecycle: postgresAttemptStore, rpc };
}

export async function createPaymentRuntime(ports?: Pick<PaymentDependencies, "store" | "lifecycle" | "rpc">): Promise<ReturnType<typeof createPaymentService>> {
  const resolved = ports ?? await durablePorts();
  if (!resolved) throw new PaymentFailure("CONFIGURATION_UNAVAILABLE");
  const config = publicConfig();
  if (!config.ok) throw new PaymentFailure(config.code);
  const store = boundAttemptStore(resolved.store);
  const lifecycle = boundLifecycle(resolved.lifecycle);
  const paymentConfig = { ...config.value };
  const progress = createPaymentProgress({
    store, rpc: resolved.rpc, config: paymentConfig,
    readCheckout: async checkoutId => (await readPaymentRoom({ checkoutId }))?.checkout ?? null,
  });
  return createPaymentService({ store, lifecycle, rpc: resolved.rpc, config: paymentConfig, readRoom: readPaymentRoom, progress });
}

export const paymentHandlers = createPaymentHandlers({
  requireSession: requireWalletSession,
  originAllowed: request => expectedOrigin(request) !== null,
  service: () => createPaymentRuntime(),
});
