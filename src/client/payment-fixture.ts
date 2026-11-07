import type { RoomSnapshot } from "./contracts";

const sampleAccount = (word: string): string => `SAMPLE${word}`.padEnd(44, "1");
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/**
 * A signing payload, as the wire sends it, for the attempt in `room`. Tests use it until Payments
 * publishes real fixtures. Its bytes are placeholders, so only the field checks can judge it.
 */
export function wirePayloadFor(room: RoomSnapshot): Record<string, unknown> {
  const { checkout, participants, attempt } = room;
  if (attempt === null) throw new Error("A signing payload needs an attempt");
  const message = bytesOf(`OneTab payment for ${attempt.id}`);
  const transaction = new Uint8Array([1, ...new Uint8Array(64), ...message]);
  return {
    attemptId: attempt.id,
    checkoutId: checkout.id,
    transactionBase64: base64(transaction),
    messageBase64: base64(message),
    messageHash: "5a".repeat(32),
    blockhash: sampleAccount("b1ockhash"),
    lastValidBlockHeight: attempt.lastValidBlockHeight ?? "312345678",
    payment: {
      network: checkout.network,
      mint: checkout.mint,
      tokenDecimals: checkout.tokenDecimals,
      sellerWallet: checkout.sellerWallet,
      sellerTokenAccount: sampleAccount("se11erUsdcAccount"),
      feePayerWallet: checkout.organizerWallet,
      contributions: [...participants]
        .sort((a, b) => a.slot - b.slot)
        .map((p) => ({
          slot: p.slot,
          wallet: p.wallet,
          sourceTokenAccount: sampleAccount(`payer${p.slot + 1}UsdcAccount`),
          amountUnits: p.shareUnits,
        })),
    },
  };
}
