import type { RoomSnapshot } from "../../contracts/index.js";
import { expectedOrigin, requireWalletSession } from "../auth/service.js";
import { getRoom, publicConfig } from "../rooms/service.js";
import { PaymentFailure } from "./errors.js";
import { createPaymentHandlers } from "./http.js";
import { createPaymentService, type PaymentDependencies } from "./service.js";
import { createPaymentProgress } from "./settlement.js";

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

export function createPaymentRuntime(ports?: Pick<PaymentDependencies, "store" | "lifecycle" | "rpc">) {
  if (!ports) throw new PaymentFailure("CONFIGURATION_UNAVAILABLE");
  const config = publicConfig();
  if (!config.ok) throw new PaymentFailure(config.code);
  const paymentConfig = { ...config.value };
  const progress = createPaymentProgress({
    store: ports.store, rpc: ports.rpc, config: paymentConfig,
    readCheckout: async checkoutId => (await readPaymentRoom({ checkoutId }))?.checkout ?? null,
  });
  return createPaymentService({ ...ports, config: paymentConfig, readRoom: readPaymentRoom, progress });
}

export const paymentHandlers = createPaymentHandlers({
  requireSession: requireWalletSession,
  originAllowed: request => expectedOrigin(request) !== null,
  service: () => createPaymentRuntime(),
});
