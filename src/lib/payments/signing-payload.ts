import { address, blockhash, LEGACY_TRANSACTION_SIZE_LIMIT, type ReadonlyUint8Array } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { z } from "zod";
import type { Checkout, Participant, PublicConfig, RoomSnapshot, SigningPayload } from "../../contracts/index";
import {
  createPaymentPlan, DEVNET_USDC, inspectPaymentMessage,
  type MessageCandidate, type PaymentPlan,
} from "./payment-core";

const units = z.string().max(20).regex(/^(0|[1-9][0-9]*)$/)
  .pipe(z.string().refine(value => BigInt(value) <= 18446744073709551615n));
const positiveUnits = units.pipe(z.string().refine(value => BigInt(value) > 0n));
const wallet = z.string().transform(value => address(value));
const slot = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const participant = z.object({ slot, wallet, shareUnits: positiveUnits, ready: z.boolean() }) satisfies z.ZodType<Participant>;
const participants = z.union([z.tuple([participant, participant]), z.tuple([participant, participant, participant])]);
const checkout = z.object({
  id: z.uuid(), title: z.string(), organizerWallet: wallet, sellerWallet: wallet,
  network: z.literal("devnet"), mint: z.literal(DEVNET_USDC), tokenDecimals: z.literal(6),
  totalUnits: positiveUnits, payerCount: z.union([z.literal(2), z.literal(3)]), createdAt: z.iso.datetime(),
}) satisfies z.ZodType<Checkout>;
const config = z.object({
  network: z.literal("devnet"), mint: z.literal(DEVNET_USDC), tokenDecimals: z.literal(6),
  confirmationTarget: z.literal("finalized"),
}) satisfies z.ZodType<PublicConfig>;
const contribution = z.strictObject({ slot, wallet, sourceTokenAccount: wallet, amountUnits: positiveUnits });
const paymentBase64 = z.string().max(4 * Math.ceil(LEGACY_TRANSACTION_SIZE_LIMIT / 3));
const payloadSchema = z.strictObject({
  attemptId: z.uuid(), checkoutId: z.uuid(), transactionBase64: paymentBase64, messageBase64: paymentBase64,
  messageHash: z.string().regex(/^[a-f0-9]{64}$/), blockhash: z.string().transform(blockhash),
  lastValidBlockHeight: units,
  payment: z.strictObject({
    network: z.literal("devnet"), mint: z.literal(DEVNET_USDC), tokenDecimals: z.literal(6),
    sellerWallet: wallet, sellerTokenAccount: wallet, feePayerWallet: wallet,
    contributions: z.union([z.tuple([contribution, contribution]), z.tuple([contribution, contribution, contribution])]),
  }),
}) satisfies z.ZodType<SigningPayload>;
const roomSchema = z.object({
  checkout, participants,
  phase: z.literal("paying"),
  attempt: z.object({ id: z.uuid(), state: z.literal("signing"), lastValidBlockHeight: units }),
});
const frozenSnapshotSchema = z.object({ checkout, participants, attemptId: z.uuid(), lastValidBlockHeight: units });
type CheckoutSnapshot = { checkout: z.infer<typeof checkout>; participants: z.infer<typeof participants> };

export function toBase64(bytes: ReadonlyUint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(value: string): Uint8Array {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (toBase64(bytes) !== value) throw new Error("Noncanonical base64");
  return bytes;
}

function paymentBytes(value: string): Uint8Array {
  const bytes = fromBase64(value);
  if (bytes.length > LEGACY_TRANSACTION_SIZE_LIMIT) throw new Error("Payment exceeds the legacy transaction size limit");
  return bytes;
}

async function planForSnapshot(snapshot: CheckoutSnapshot): Promise<PaymentPlan> {
  const { checkout, participants } = snapshot;
  if (participants.length !== checkout.payerCount || participants[0].wallet !== checkout.organizerWallet
    || participants.some((payer, index) => payer.slot !== index || !payer.ready)) {
    throw new Error("Payment requires the frozen ready participant slots");
  }
  const mint = address(checkout.mint);
  const account = async (owner: ReturnType<typeof address>) =>
    (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  const sellerTokenAccount = await account(checkout.sellerWallet);
  const payers = await Promise.all(participants.map(async payer => ({
    wallet: payer.wallet, sourceTokenAccount: await account(payer.wallet),
  })));
  const [first, second, third] = payers;
  if (!first || !second) throw new Error("Payment requires two or three payers");
  const plan = createPaymentPlan({
    totalUnits: BigInt(checkout.totalUnits), sellerWallet: checkout.sellerWallet, sellerTokenAccount,
    payers: third ? [first, second, third] : [first, second],
  });
  if (plan.contributions.some((payer, index) => String(payer.units) !== participants[index]?.shareUnits)) {
    throw new Error("Participant shares differ from the exact slot split");
  }
  return plan;
}

/** Input membership must be the server's frozen snapshot, never payload-supplied membership. */
export async function createCheckoutPaymentPlan(input: {
  checkout: Checkout; participants: readonly Participant[]; config: PublicConfig;
}): Promise<PaymentPlan> {
  config.parse(input.config);
  const snapshot = { checkout: checkout.parse(input.checkout), participants: participants.parse(input.participants) };
  return planForSnapshot(snapshot);
}

export type ValidatedSigningPayload = Readonly<{
  target: Readonly<{ attemptId: string; checkoutId: string; lastValidBlockHeight: bigint }>;
  plan: PaymentPlan;
  message: MessageCandidate;
}>;

/**
 * Checkout, membership, attempt identity, lifetime and config must come from trusted frozen storage.
 * Validation does not authorize the attempt's current state, prove current chain height or reserve
 * an attempt. Callers enforce those lifecycle rules before collection, submission or recovery.
 * Returned bytes are owned copies. Callers must keep them private from mutation.
 */
export async function validateFrozenSigningPayload(input: {
  payload: unknown; checkout: Checkout; participants: readonly Participant[];
  attemptId: string; lastValidBlockHeight: string; config: PublicConfig;
}): Promise<ValidatedSigningPayload> {
  const payload = payloadSchema.parse(input.payload);
  const snapshot = frozenSnapshotSchema.parse(input);
  config.parse(input.config);
  const transactionBytes = paymentBytes(payload.transactionBase64);
  const messageBytes = paymentBytes(payload.messageBase64);
  if (payload.checkoutId !== snapshot.checkout.id || payload.attemptId !== snapshot.attemptId
    || payload.lastValidBlockHeight !== snapshot.lastValidBlockHeight) {
    throw new Error("Payload differs from the frozen attempt");
  }
  const plan = await planForSnapshot(snapshot);
  const payment = payload.payment;
  if (payment.sellerWallet !== plan.sellerWallet || payment.sellerTokenAccount !== plan.sellerTokenAccount
    || payment.feePayerWallet !== plan.feePayer || payment.contributions.length !== plan.contributions.length
    || payment.contributions.some((payer, index) => {
      const expected = plan.contributions[index];
      return !expected || payer.slot !== expected.slot || payer.wallet !== expected.wallet
        || payer.sourceTokenAccount !== expected.sourceTokenAccount || payer.amountUnits !== String(expected.units);
    })) {
    throw new Error("Payload differs from the trusted checkout payment");
  }
  const message = await inspectPaymentMessage({ transactionBytes, messageBytes, messageHash: payload.messageHash }, {
    plan, blockhash: payload.blockhash, messageHash: payload.messageHash,
  });
  return Object.freeze({
    target: Object.freeze({ attemptId: payload.attemptId, checkoutId: payload.checkoutId,
      lastValidBlockHeight: BigInt(payload.lastValidBlockHeight) }), plan, message,
  });
}

/** The browser additionally requires an independently read current room in the signing state. */
export async function validateSigningPayload(input: {
  payload: unknown; room: RoomSnapshot; config: PublicConfig;
}): Promise<ValidatedSigningPayload> {
  const room = roomSchema.parse(input.room);
  return validateFrozenSigningPayload({ payload: input.payload, config: input.config,
    checkout: room.checkout, participants: room.participants,
    attemptId: room.attempt.id, lastValidBlockHeight: room.attempt.lastValidBlockHeight });
}
