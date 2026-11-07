import { blockhash, getAddressDecoder } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { z } from "zod";
import type { Lifetime, PaymentPlan } from "../../lib/payments/payment-core";
import { fromBase64 } from "../../lib/payments/signing-payload";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const integer = z.number().int().nonnegative().safe();
const messages = {
  WRONG_NETWORK: "The RPC genesis does not match Solana Devnet.",
  MINT_INVALID: "The configured Devnet USDC mint has an unsupported owner, layout, or decimal count.",
  TOKEN_ACCOUNT_MISSING: "A required prepared token account is missing.",
  TOKEN_ACCOUNT_INVALID: "A token account has an unexpected owner, mint, state, delegation, or layout.",
  INSUFFICIENT_USDC: "A payer has insufficient Devnet USDC for its exact contribution.",
  INSUFFICIENT_SOL: "The organizer needs enough Devnet SOL for the estimated transaction fee.",
  FEE_UNAVAILABLE: "The RPC could not estimate the fixed message fee. Its blockhash may have expired.",
};
export class PaymentPreflightFailure extends Error {
  readonly code: keyof typeof messages;
  constructor(code: keyof typeof messages) {
    super(messages[code]);
    this.code = code;
  }
}
export interface PaymentRpc {
  call(method: string, params: readonly unknown[]): Promise<unknown>;
}

export async function assertDevnet(rpc: PaymentRpc): Promise<void> {
  if (await rpc.call("getGenesisHash", []) !== DEVNET_GENESIS_HASH) throw new PaymentPreflightFailure("WRONG_NETWORK");
}

async function account(rpc: PaymentRpc, key: string, mint = false): Promise<Uint8Array> {
  const result = z.object({ value: z.object({
    owner: z.string(), executable: z.boolean(), data: z.tuple([z.string(), z.literal("base64")]),
  }).nullable() }).parse(await rpc.call("getAccountInfo", [key, { encoding: "base64", commitment: "confirmed" }]));
  if (!result.value) throw new PaymentPreflightFailure(mint ? "MINT_INVALID" : "TOKEN_ACCOUNT_MISSING");
  if (result.value.owner !== TOKEN_PROGRAM_ADDRESS || result.value.executable) {
    throw new PaymentPreflightFailure(mint ? "MINT_INVALID" : "TOKEN_ACCOUNT_INVALID");
  }
  return fromBase64(result.value.data[0]);
}

export async function preparePayment(input: { plan: PaymentPlan; rpc: PaymentRpc }): Promise<Lifetime> {
  const { plan, rpc } = input;
  await assertDevnet(rpc);
  const mint = await account(rpc, plan.mint, true);
  if (mint.length !== 82 || mint[44] !== plan.decimals || mint[45] !== 1) throw new PaymentPreflightFailure("MINT_INVALID");
  for (const expected of [...plan.contributions.map(payer => ({
    wallet: payer.wallet, token: payer.sourceTokenAccount, minimum: payer.units,
  })), { wallet: plan.sellerWallet, token: plan.sellerTokenAccount, minimum: 0n }]) {
    const data = await account(rpc, expected.token);
    if (data.length !== 165) throw new PaymentPreflightFailure("TOKEN_ACCOUNT_INVALID");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (getAddressDecoder().decode(data.subarray(0, 32)) !== plan.mint
      || getAddressDecoder().decode(data.subarray(32, 64)) !== expected.wallet
      || data[108] !== 1 || view.getUint32(72, true) !== 0 || view.getUint32(109, true) !== 0
      || view.getUint32(129, true) !== 0) {
      throw new PaymentPreflightFailure("TOKEN_ACCOUNT_INVALID");
    }
    if (view.getBigUint64(64, true) < expected.minimum) throw new PaymentPreflightFailure("INSUFFICIENT_USDC");
  }
  const balance = z.object({ value: integer }).parse(await rpc.call("getBalance", [plan.feePayer, { commitment: "confirmed" }]));
  if (balance.value === 0) throw new PaymentPreflightFailure("INSUFFICIENT_SOL");
  const latest = z.object({ value: z.object({ blockhash: z.string().transform(blockhash), lastValidBlockHeight: integer }) })
    .parse(await rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }]));
  return Object.freeze({ blockhash: latest.value.blockhash, lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) });
}

export async function checkPaymentFee(input: {
  plan: Pick<PaymentPlan, "feePayer">; messageBase64: string; rpc: PaymentRpc;
}): Promise<{ feeLamports: string }> {
  const { plan, messageBase64, rpc } = input;
  await assertDevnet(rpc);
  const fee = z.object({ value: integer.nullable() }).parse(await rpc.call("getFeeForMessage", [messageBase64, { commitment: "confirmed" }]));
  const balance = z.object({ value: integer }).parse(await rpc.call("getBalance", [plan.feePayer, { commitment: "confirmed" }]));
  if (fee.value === null) throw new PaymentPreflightFailure("FEE_UNAVAILABLE");
  if (balance.value < fee.value) throw new PaymentPreflightFailure("INSUFFICIENT_SOL");
  return { feeLamports: String(fee.value) };
}
