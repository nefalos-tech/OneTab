import { z } from "zod";
import type { Checkout, Participant, PublicConfig, SigningPayload } from "../../contracts/index";
import { buildPaymentMessage } from "../../lib/payments/payment-core";
import { createCheckoutPaymentPlan, toBase64 } from "../../lib/payments/signing-payload";
import { checkPaymentFee, preparePayment, type PaymentRpc } from "./preflight";

/** The caller reserves and leases the attempt, supplies frozen membership, and persists this result before exposure. */
export async function buildSigningPayload(input: {
  attemptId: string; checkout: Checkout; participants: readonly Participant[]; config: PublicConfig; rpc: PaymentRpc;
}): Promise<SigningPayload> {
  const attemptId = z.uuid().parse(input.attemptId);
  const checkoutId = z.uuid().parse(input.checkout.id);
  const rpc = input.rpc;
  const plan = await createCheckoutPaymentPlan(input);
  const lifetime = await preparePayment({ plan, rpc });
  const message = await buildPaymentMessage(plan, lifetime);
  const messageBase64 = toBase64(message.messageBytes);
  await checkPaymentFee({ plan, messageBase64, rpc });
  return {
    attemptId, checkoutId, transactionBase64: toBase64(message.transactionBytes), messageBase64,
    messageHash: message.messageHash, blockhash: lifetime.blockhash,
    lastValidBlockHeight: String(lifetime.lastValidBlockHeight),
    payment: {
      network: plan.network, mint: plan.mint, tokenDecimals: plan.decimals,
      sellerWallet: plan.sellerWallet, sellerTokenAccount: plan.sellerTokenAccount, feePayerWallet: plan.feePayer,
      contributions: plan.contributions.map(payer => ({
        slot: payer.slot, wallet: payer.wallet, sourceTokenAccount: payer.sourceTokenAccount, amountUnits: String(payer.units),
      })),
    },
  };
}
