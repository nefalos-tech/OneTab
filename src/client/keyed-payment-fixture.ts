import { address, getAddressDecoder, getTransactionDecoder, getTransactionEncoder, signatureBytes } from "@solana/kit";
import type { RoomSnapshot as WireRoom, SigningPayload as WirePayload } from "@/contracts";
import { createCheckoutPaymentPlan, validateFrozenSigningPayload, type ValidatedSigningPayload } from "@/lib/payments/signing-payload";
import { config, paymentFixture, payloadForPlan } from "@/lib/payments/test-fixtures";
import { parseRoomSnapshot, parseSigningPayload, type Address, type RoomSnapshot, type SigningPayload } from "./contracts";

/**
 * Test support, never bundled. Payments' payment fixture with a generated Ed25519 key for every payer, the
 * swap in src/server/payments/settlement-fixture.ts, which client tests can't import. Every signature a test
 * makes with these keys is one the server's own check accepts.
 */
export type KeyedPayer = { readonly address: Address; readonly keys: CryptoKeyPair };

export type KeyedPayment = {
  /** Slot order. Slot 0 is the organizer and the fee payer. */
  readonly payers: readonly KeyedPayer[];
  /** B1 JSON as GET /api/checkouts/:id answers it: paying, attempt signing, nobody approved yet. */
  readonly wireRoom: WireRoom;
  /** B1 JSON as GET /api/attempts/:id/signing-payload answers it, with this room's real bytes. */
  readonly wirePayload: WirePayload;
  readonly room: RoomSnapshot;
  readonly payload: SigningPayload;
  readonly validated: ValidatedSigningPayload;
};

export type KeyedOptions = {
  readonly checkoutId?: string;
  readonly attemptId?: string;
  readonly createdAt?: string;
  readonly totalUnits?: bigint;
};

export async function keyedPayment(count: 2 | 3 = 3, options: KeyedOptions = {}): Promise<KeyedPayment> {
  const f = await paymentFixture(count, options.totalUnits ?? 30_000_000n);
  const keys = await Promise.all(f.room.participants.map(() => crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])));
  const payers = await Promise.all(
    keys.map(async (pair) => ({
      address: getAddressDecoder().decode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))) as string as Address,
      keys: pair,
    })),
  );
  const attempt = f.room.attempt!;
  const checkoutId = options.checkoutId ?? f.room.checkout.id;
  const attemptId = options.attemptId ?? attempt.id;
  const wireRoom: WireRoom = {
    ...f.room,
    checkout: {
      ...f.room.checkout,
      id: checkoutId,
      title: "Weekend cabin",
      organizerWallet: payers[0]!.address,
      createdAt: options.createdAt ?? f.room.checkout.createdAt,
    },
    participants: f.room.participants.map((p, slot) => ({ ...p, wallet: payers[slot]!.address })),
    attempt: { ...attempt, id: attemptId },
  };
  const plan = await createCheckoutPaymentPlan({ ...wireRoom, config });
  const wirePayload: WirePayload = { ...(await payloadForPlan(plan)), attemptId, checkoutId };
  const validated = await validateFrozenSigningPayload({
    payload: wirePayload,
    checkout: wireRoom.checkout,
    participants: wireRoom.participants,
    attemptId,
    lastValidBlockHeight: wirePayload.lastValidBlockHeight,
    config,
  });
  const room = parseRoomSnapshot(wireRoom);
  const payload = parseSigningPayload(wirePayload);
  if (room === null || payload === null) throw new Error("The keyed payment doesn't parse as the client's room and payload");
  return { payers, wireRoom, wirePayload, room, payload, validated };
}

export async function signBytes(payer: KeyedPayer, bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("Ed25519", payer.keys.privateKey, Uint8Array.from(bytes)));
}

/** What a wallet returns for solana:signTransaction: the same transaction with this payer's signature in its own slot. */
export async function signedTransaction(payer: KeyedPayer, transaction: Uint8Array): Promise<Uint8Array> {
  const decoded = getTransactionDecoder().decode(transaction);
  const signature = signatureBytes(await signBytes(payer, Uint8Array.from(decoded.messageBytes)));
  const signatures = { ...decoded.signatures, [address(payer.address)]: signature };
  return Uint8Array.from(getTransactionEncoder().encode({ ...decoded, signatures }));
}
