import { blockhash, getAddressDecoder } from "@solana/kit";
import type { PublicConfig, RoomSnapshot, SigningPayload } from "../../contracts/index";
import { buildPaymentMessage, equalShares, type PaymentPlan } from "./payment-core";
import { createCheckoutPaymentPlan, toBase64 } from "./signing-payload";

export const key = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));
export const config: PublicConfig = {
  network: "devnet", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", tokenDecimals: 6, confirmationTarget: "finalized",
};
export const lifetime = { blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };

export async function payloadForPlan(plan: PaymentPlan): Promise<SigningPayload> {
  const message = await buildPaymentMessage(plan, lifetime);
  return {
    attemptId: "00000000-0000-4000-8000-000000000002", checkoutId: "00000000-0000-4000-8000-000000000001",
    transactionBase64: toBase64(message.transactionBytes), messageBase64: toBase64(message.messageBytes),
    messageHash: message.messageHash, blockhash: lifetime.blockhash, lastValidBlockHeight: String(lifetime.lastValidBlockHeight),
    payment: {
      network: plan.network, mint: plan.mint, tokenDecimals: plan.decimals, sellerWallet: plan.sellerWallet,
      sellerTokenAccount: plan.sellerTokenAccount, feePayerWallet: plan.feePayer,
      contributions: plan.contributions.map(payer => ({
        slot: payer.slot, wallet: payer.wallet, sourceTokenAccount: payer.sourceTokenAccount, amountUnits: String(payer.units),
      })),
    },
  };
}

export async function paymentFixture(count: 2 | 3 = 3, total = 10n) {
  const shares = equalShares(total, count);
  const room: RoomSnapshot = {
    checkout: {
      id: "00000000-0000-4000-8000-000000000001", title: "Synthetic payment", organizerWallet: key(1), sellerWallet: key(7),
      network: config.network, mint: config.mint, tokenDecimals: config.tokenDecimals,
      totalUnits: String(total), payerCount: count, createdAt: "2026-11-07T00:00:00.000Z",
    },
    participants: shares.map((share, slot) => ({ slot, wallet: key(slot + 1), shareUnits: String(share), ready: true })),
    phase: "paying", attempt: {
      id: "00000000-0000-4000-8000-000000000002", state: "signing", signedWallets: [], transactionReference: null,
      lastValidBlockHeight: "100", error: null, canRetry: false, receipt: null,
    },
  };
  const plan = await createCheckoutPaymentPlan({ ...room, config });
  return { room, config: { ...config }, plan, payload: await payloadForPlan(plan) };
}
