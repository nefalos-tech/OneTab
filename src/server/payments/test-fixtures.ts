import { AccountState, getMintEncoder, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getAddressDecoder, type ReadonlyUint8Array } from "@solana/kit";
import type { PublicConfig, RoomSnapshot } from "../../contracts/index";
import { DEVNET_USDC, equalShares } from "../../lib/payments/payment-core";
import { createCheckoutPaymentPlan, fromBase64, toBase64 } from "../../lib/payments/signing-payload";
import { DEVNET_GENESIS_HASH, type PaymentRpc } from "./preflight";
import { createPaymentService } from "./service";
import { TestAttemptStore } from "./test-store";

export async function serviceFixture(count: 2 | 3 = 2) {
  const signers = await Promise.all(Array.from({ length: count }, async () => {
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const wallet = getAddressDecoder().decode(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
    return { keys, wallet };
  }));
  const organizer = signers[0];
  if (!organizer) throw new Error("Fixture organizer missing");
  const seller = getAddressDecoder().decode(new Uint8Array(32).fill(90));
  const config: PublicConfig = { network: "devnet", mint: DEVNET_USDC, tokenDecimals: 6, confirmationTarget: "finalized" };
  const shares = equalShares(10n, count);
  const room: RoomSnapshot = {
    checkout: { id: "00000000-0000-4000-8000-000000000001", title: "Synthetic payment",
      organizerWallet: organizer.wallet, sellerWallet: seller, totalUnits: "10", payerCount: count,
      createdAt: "2026-11-07T00:00:00Z", network: config.network, mint: config.mint, tokenDecimals: 6 },
    participants: signers.map((signer, slot) => ({ slot, wallet: signer.wallet, shareUnits: String(shares[slot]), ready: true })),
    phase: "ready", attempt: null,
  };
  const plan = await createCheckoutPaymentPlan({ ...room, config });
  const encoded = (data: ReadonlyUint8Array) => ({ value: {
    owner: TOKEN_PROGRAM_ADDRESS, executable: false, data: [toBase64(data), "base64"],
  } });
  const accounts = new Map<string, unknown>([[plan.mint, encoded(getMintEncoder().encode({
    mintAuthority: null, supply: 100n, decimals: 6, isInitialized: true, freezeAuthority: null,
  }))]]);
  for (const payer of [...plan.contributions.map(payer => ({ wallet: payer.wallet, token: payer.sourceTokenAccount })),
    { wallet: plan.sellerWallet, token: plan.sellerTokenAccount }]) {
    accounts.set(payer.token, encoded(getTokenEncoder().encode({
      mint: plan.mint, owner: payer.wallet, amount: 100n, delegate: null, state: AccountState.Initialized,
      isNative: null, delegatedAmount: 0n, closeAuthority: null,
    })));
  }
  const calls: string[] = [];
  const replies: Record<string, unknown> = {
    getGenesisHash: DEVNET_GENESIS_HASH, getBalance: { value: 15000 }, getFeeForMessage: { value: 15000 },
    getLatestBlockhash: { value: { blockhash: getAddressDecoder().decode(new Uint8Array(32).fill(20)), lastValidBlockHeight: 100 } },
  };
  const rpc: PaymentRpc = { async call(method, params) {
    calls.push(method);
    return method === "getAccountInfo" ? accounts.get(String(params[0])) ?? { value: null } : replies[method];
  } };
  const store = new TestAttemptStore(room);
  const progressCalls: string[] = [];
  const progress = async (attemptId: string) => {
    progressCalls.push(attemptId);
    const attempt = await store.getAttempt({ attemptId });
    if (!attempt) throw new Error("Fixture attempt missing");
    return attempt;
  };
  const dependencies = { store, lifecycle: store, config, rpc, readRoom: store.readRoom, progress };
  const service = createPaymentService(dependencies);
  const prepare = () => service.prepare({ checkoutId: room.checkout.id, wallet: organizer.wallet, retryOfAttemptId: null });
  const current = () => {
    const attempt = store.currentId ? store.attempts.get(store.currentId) : null;
    if (!attempt) throw new Error("Fixture attempt missing");
    return attempt;
  };
  const upload = async (slot: number, message?: Uint8Array) => {
    const signer = signers[slot];
    const attempt = current();
    if (!signer || !attempt.signingPayload) throw new Error("Fixture signing data missing");
    const signature = await crypto.subtle.sign("Ed25519", signer.keys.privateKey,
      Uint8Array.from(message ?? fromBase64(attempt.signingPayload.messageBase64)));
    return { attemptId: attempt.id, wallet: signer.wallet, messageHash: attempt.signingPayload.messageHash,
      signatureBase64: toBase64(new Uint8Array(signature)) };
  };
  return { service, store, dependencies, signers, organizer, room, config, rpc, plan,
    calls, replies, accounts, progressCalls, prepare, current, upload };
}
