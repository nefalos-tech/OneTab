import { address, type ReadonlyUint8Array } from "@solana/kit";
import { verifyWalletSignature } from "./signature-core";
import { toBase64, type ValidatedSigningPayload } from "./signing-payload";

export async function extractPaymentSignature(input: {
  validated: ValidatedSigningPayload; wallet: string; transactionBytes: ReadonlyUint8Array;
}): Promise<{ messageHash: string; signatureBase64: string }> {
  const messageHash = input.validated.message.messageHash;
  const signature = await verifyWalletSignature(input.validated, address(input.wallet), input.transactionBytes);
  return { messageHash, signatureBase64: toBase64(signature.signatureBytes) };
}
