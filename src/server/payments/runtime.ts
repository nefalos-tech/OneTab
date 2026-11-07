import type { RoomSnapshot } from "../../contracts/index";
import { expectedOrigin, requireWalletSession } from "../auth/service";
import { getRoom, publicConfig } from "../rooms/service";
import { PaymentFailure } from "./errors";
import { createPaymentHandlers } from "./http";
import { createPaymentService, type PaymentDependencies } from "./service";

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

export function createPaymentRuntime(ports?: Pick<PaymentDependencies, "store" | "lifecycle" | "rpc" | "progress">) {
  if (!ports) throw new PaymentFailure("CONFIGURATION_UNAVAILABLE");
  const config = publicConfig();
  if (!config.ok) throw new PaymentFailure(config.code);
  return createPaymentService({ ...ports, config: { ...config.value }, readRoom: readPaymentRoom });
}

export const paymentHandlers = createPaymentHandlers({
  requireSession: requireWalletSession,
  originAllowed: request => expectedOrigin(request) !== null,
  service: () => createPaymentRuntime(),
});
