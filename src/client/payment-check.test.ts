import { address } from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyPayerSignature } from "@/lib/payments/signature-core";
import { termsOf, type ApprovalTerms } from "./checkout-view";
import type { PaymentApproval, SignatureBase64 } from "@/lib/wallet/environment";
import {
  parseSigningPayload,
  type Address,
  type BlockHeight,
  type MessageHash,
  type Network,
  type RoomSnapshot,
  type SigningPayload,
  type TokenUnits,
} from "./contracts";
import { SAMPLE_WALLETS } from "./fixture-data";
import { FIXTURES } from "./fixtures";
import { keyedPayment, signBytes, signedTransaction, type KeyedPayment } from "./keyed-payment-fixture";
import { checkPayment, paymentCheck, walletRequest, type CheckedPayment, type MessageCheck, type ReturnCheck } from "./payment-check";
import { wirePayloadFor } from "./payment-fixture";

const KEYED = await keyedPayment();
const VALIDATED = KEYED.validated;

const room = FIXTURES.signing.snapshot;
const bea = { wallet: SAMPLE_WALLETS.bea, expiresAt: "2099-01-01T00:00:00.000Z" };
const terms = termsOf(room, bea)!;
const payload = parseSigningPayload(wirePayloadFor(room))!;
const bytesMatch: MessageCheck = async () => ({ ok: true, value: VALIDATED });
const signatureMatches: ReturnCheck = async () => "match";
const check = (p: SigningPayload, t: ApprovalTerms, r: RoomSnapshot = room) => paymentCheck(bytesMatch, signatureMatches).payload(p, t, r);

type Contribution = SigningPayload["payment"]["contributions"][number];
const units = (n: bigint) => n.toString() as TokenUnits;
const withPayment = (patch: Partial<SigningPayload["payment"]>): SigningPayload => ({ ...payload, payment: { ...payload.payment, ...patch } });
const withContributions = (change: (c: Contribution, slot: number) => Partial<Contribution>): SigningPayload =>
  withPayment({ contributions: payload.payment.contributions.map((c, slot) => ({ ...c, ...change(c, slot) })) });
const [first, second] = payload.payment.contributions.map((c) => BigInt(c.amountUnits));
const total = BigInt(terms.totalUnits);

function withScreenShowingTheSame(change: (c: Contribution, slot: number) => Partial<Contribution>, patch: Partial<ApprovalTerms> = {}) {
  const tampered = withContributions(change);
  return [
    tampered,
    {
      ...terms,
      ...patch,
      contributions: tampered.payment.contributions.map(({ slot, wallet, amountUnits }) => ({ slot, wallet, amountUnits })),
    },
  ] as const;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/payments/wallet-signature");
});

describe("the payment check before any wallet prompt", () => {
  it("makes a frozen payment for the viewer, whose wallet request is a fresh copy of the bytes Payments validated", async () => {
    const result = await check(payload, terms);
    if (!result.ok) throw new Error(result.failure);
    const payment = result.value;
    expect(payment).toEqual({ attemptId: room.attempt!.id, account: SAMPLE_WALLETS.bea, messageHash: payload.messageHash });
    expect(Object.isFrozen(payment)).toBe(true);
    const validated = Uint8Array.from(VALIDATED.message.transactionBytes);
    walletRequest(payment)!.transaction.fill(0);
    expect(walletRequest(payment)!.transaction).toEqual(validated);
    expect(VALIDATED.message.transactionBytes).toEqual(validated);
  });

  it("gives a copy of the payment, or one with other bytes, no wallet request, and the payment itself can't change", async () => {
    const result = await check(payload, terms);
    if (!result.ok) throw new Error(result.failure);
    const payment = result.value;
    expect(walletRequest({ ...payment })).toBeNull();
    expect(walletRequest({ ...payment, transaction: new Uint8Array(3), signatureIn: async () => null } as unknown as CheckedPayment)).toBeNull();
    expect(Reflect.set(payment, "account", SAMPLE_WALLETS.cam)).toBe(false);
    expect(payment.account).toBe(SAMPLE_WALLETS.bea);
  });

  it.each<[string, SigningPayload]>([
    ["another attempt", { ...payload, attemptId: FIXTURES.declined.snapshot.attempt!.id }],
    ["another checkout", { ...payload, checkoutId: FIXTURES.declined.snapshot.checkout.id }],
    ["another network", withPayment({ network: "mainnet-beta" as Network })],
    ["another mint", withPayment({ mint: SAMPLE_WALLETS.outsider })],
    ["other decimals", withPayment({ tokenDecimals: 9 })],
    ["another seller", withPayment({ sellerWallet: SAMPLE_WALLETS.outsider })],
    ["a payer as the fee payer", withPayment({ feePayerWallet: SAMPLE_WALLETS.bea })],
    ["a larger share", withContributions((c, slot) => (slot === 1 ? { amountUnits: units(BigInt(c.amountUnits) + 1n) } : {}))],
    [
      "a share moved between payers, with the same total",
      withContributions((_, slot) => (slot === 0 ? { amountUnits: units(first! + 1n) } : slot === 1 ? { amountUnits: units(second! - 1n) } : {})),
    ],
    ["two payers in each other's spots", withContributions((_, slot) => (slot === 1 ? { wallet: SAMPLE_WALLETS.cam } : slot === 2 ? { wallet: SAMPLE_WALLETS.bea } : {}))],
    ["someone else in a payer's spot", withContributions((_, slot) => (slot === 2 ? { wallet: SAMPLE_WALLETS.outsider } : {}))],
    ["a payer missing", withPayment({ contributions: payload.payment.contributions.slice(0, 2) })],
    ["another expiry height than the room's", { ...payload, lastValidBlockHeight: String(BigInt(payload.lastValidBlockHeight) + 150n) as BlockHeight }],
  ])("refuses %s before the wallet opens, whatever the bytes", async (_, tampered) => {
    expect(await check(tampered, terms)).toEqual({ ok: false, failure: "mismatch" });
  });

  it.each<[string, readonly [SigningPayload, ApprovalTerms]]>([
    ["the seller as a payer", withScreenShowingTheSame((_, slot) => (slot === 2 ? { wallet: room.checkout.sellerWallet } : {}))],
    ["one wallet in two spots", withScreenShowingTheSame((_, slot) => (slot === 2 ? { wallet: SAMPLE_WALLETS.bea } : {}))],
    ["shares that don't add up to the total", withScreenShowingTheSame(() => ({}), { totalUnits: units(BigInt(terms.totalUnits) + 1n) })],
    ["a viewer who isn't a payer", withScreenShowingTheSame(() => ({}), { payer: SAMPLE_WALLETS.outsider as Address })],
    ["shares that aren't the equal split", withScreenShowingTheSame((_, slot) => ({ amountUnits: units([15_000_000n, 10_000_000n, 5_000_000n][slot]!) }), { totalUnits: units(30_000_000n) })],
    ["one payer paying most of the total", withScreenShowingTheSame((_, slot) => ({ amountUnits: units([total / 6n, total - (total / 6n) * 2n, total / 6n][slot]!) }))],
    ["a payer paying nothing", withScreenShowingTheSame((_, slot) => ({ amountUnits: units([total / 2n, total - total / 2n, 0n][slot]!) }))],
  ])("refuses %s even when the room shows the same", async (_, [tampered, shown]) => {
    expect(await check(tampered, shown)).toEqual({ ok: false, failure: "mismatch" });
  });

  it("refuses a payload that leaves out a payer whose share is zero, though the rest adds up", async () => {
    const [whole, shown] = withScreenShowingTheSame((_, slot) => ({ amountUnits: units(slot === 2 ? 0n : 1n) }), { totalUnits: units(2n) });
    const leftOut = { ...whole, payment: { ...whole.payment, contributions: whole.payment.contributions.slice(0, 2) } };
    expect((await check(whole, shown)).ok).toBe(true);
    expect(await check(leftOut, shown)).toEqual({ ok: false, failure: "mismatch" });
  });

  it("accepts any expiry height while the screen has none yet, because the fresh room has one", async () => {
    const result = await check({ ...payload, lastValidBlockHeight: "1" as BlockHeight }, { ...terms, lastValidBlockHeight: null });
    expect(result.ok).toBe(true);
  });

  it("passes on what Payments' byte check answers, and refuses when it throws", async () => {
    for (const failure of ["mismatch", "unsupported", "check_unavailable"] as const) {
      expect(await paymentCheck(async () => ({ ok: false, failure }), signatureMatches).payload(payload, terms, room)).toEqual({ ok: false, failure });
    }
    const throws = async () => {
      throw new Error("decoder bug");
    };
    expect(await paymentCheck(throws, signatureMatches).payload(payload, terms, room)).toEqual({ ok: false, failure: "mismatch" });
  });
});

describe("the room the check reads after the payload", () => {
  const attempt = room.attempt!;
  it.each<[string, RoomSnapshot, string]>([
    ["is no longer paying", { ...room, phase: "needs_attention" }, "room_changed"],
    ["has no attempt", { ...room, attempt: null }, "room_changed"],
    ["has another attempt", { ...room, attempt: { ...attempt, id: FIXTURES.declined.snapshot.attempt!.id } }, "room_changed"],
    ["is still preparing", { ...room, attempt: { ...attempt, state: "preparing" } }, "room_changed"],
    ["has every approval", { ...room, attempt: { ...attempt, state: "submitting" } }, "room_changed"],
    ["has this payer's approval already", { ...room, attempt: { ...attempt, signedWallets: [...attempt.signedWallets, SAMPLE_WALLETS.bea] } }, "room_changed"],
    ["is signing with no expiry height", { ...room, attempt: { ...attempt, lastValidBlockHeight: null } }, "check_unavailable"],
  ])("refuses a room that %s, before Payments runs", async (_, fresh, failure) => {
    const seen: unknown[] = [];
    const recording: MessageCheck = async (...args) => (seen.push(args), { ok: true, value: VALIDATED });
    expect(await paymentCheck(recording, signatureMatches).payload(payload, terms, fresh)).toEqual({ ok: false, failure });
    expect(seen).toEqual([]);
  });

  it("hands Payments the fresh room's checkout, payers, attempt and height, and the viewer", async () => {
    const seen: Parameters<MessageCheck>[] = [];
    const recording: MessageCheck = async (...args) => (seen.push(args), { ok: true, value: VALIDATED });
    await paymentCheck(recording, signatureMatches).payload(payload, terms, room);
    expect(seen).toEqual([
      [payload, { checkout: room.checkout, participants: room.participants, attemptId: attempt.id, lastValidBlockHeight: attempt.lastValidBlockHeight }, SAMPLE_WALLETS.bea],
    ]);
  });
});

const keyedTerms = (k: KeyedPayment, slot = 1) => termsOf(k.room, { wallet: k.payers[slot]!.address, expiresAt: "2099-01-01T00:00:00.000Z" })!;

async function checked(k: KeyedPayment = KEYED, slot = 1): Promise<CheckedPayment> {
  const result = await checkPayment.payload(k.payload, keyedTerms(k, slot), k.room);
  if (!result.ok) throw new Error(`The keyed payment didn't pass the check: ${result.failure}`);
  return result.value;
}

describe("Payments' check of a real payment", () => {
  it("passes a real payload and room, and the wallet gets exactly the payload's bytes", async () => {
    const payment = await checked();
    expect(walletRequest(payment)!.transaction).toEqual(KEYED.payload.transaction);
    expect(payment).toMatchObject({ account: KEYED.payers[1]!.address, attemptId: KEYED.payload.attemptId, messageHash: KEYED.payload.messageHash });
  });

  it("passes a room whose createdAt carries an offset, as Postgres renders it", async () => {
    const offset = await keyedPayment(3, { createdAt: "2026-11-08T07:04:24.594424+00:00" });
    expect((await checked(offset)).messageHash).toBe(offset.payload.messageHash);
  });

  const flip = (bytes: Uint8Array, at: number) => Uint8Array.from(bytes, (b, i) => (i === at ? b ^ 1 : b));
  const p = KEYED.payload;
  const contributions = p.payment.contributions;
  it.each<[string, SigningPayload]>([
    ["a transaction one byte off", { ...p, transaction: flip(p.transaction, p.transaction.length - 1) }],
    ["a message one byte off", { ...p, message: flip(p.message, p.message.length - 1) }],
    ["both one byte off, the same byte", { ...p, transaction: flip(p.transaction, p.transaction.length - 1), message: flip(p.message, p.message.length - 1) }],
    ["a signature slot already filled", { ...p, transaction: flip(p.transaction, 1) }],
    ["another message hash", { ...p, messageHash: "6b".repeat(32) as MessageHash }],
    ["another blockhash", { ...p, blockhash: SAMPLE_WALLETS.outsider }],
    ["another seller token account", { ...p, payment: { ...p.payment, sellerTokenAccount: SAMPLE_WALLETS.outsider } }],
    [
      "a payer's token account swapped for another",
      { ...p, payment: { ...p.payment, contributions: contributions.map((c, slot) => (slot === 1 ? { ...c, sourceTokenAccount: SAMPLE_WALLETS.outsider } : c)) } },
    ],
  ])("refuses %s, which the screen can't show", async (_, tampered) => {
    expect(await checkPayment.payload(tampered, keyedTerms(KEYED), KEYED.room)).toEqual({ ok: false, failure: "mismatch" });
  });

  it("refuses a room whose frozen checkout differs from the payload's", async () => {
    const other = await keyedPayment();
    const mixed = { ...other.room, checkout: { ...other.room.checkout, id: KEYED.room.checkout.id }, attempt: { ...other.room.attempt!, id: KEYED.room.attempt!.id } };
    expect(await checkPayment.payload(KEYED.payload, keyedTerms(KEYED), mixed)).toEqual({ ok: false, failure: "mismatch" });
  });

  it("refuses with unsupported, before loading Payments, when this browser can't import an Ed25519 key", async () => {
    vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(new DOMException("Unrecognized name.", "NotSupportedError"));
    expect(await checkPayment.payload(KEYED.payload, keyedTerms(KEYED), KEYED.room)).toEqual({ ok: false, failure: "unsupported" });
  });

  it("says it couldn't check when Payments' code doesn't load, and loads it again on the next press", async () => {
    vi.resetModules();
    vi.doMock("@/lib/payments/wallet-signature", () => {
      throw new Error("Loading chunk 712 failed.");
    });
    const fresh = (await import("./payment-check")).checkPayment;
    expect(await fresh.payload(KEYED.payload, keyedTerms(KEYED), KEYED.room)).toEqual({ ok: false, failure: "check_unavailable" });
    vi.doUnmock("@/lib/payments/wallet-signature");
    expect((await fresh.payload(KEYED.payload, keyedTerms(KEYED), KEYED.room)).ok).toBe(true);
  });
});

describe("the check of the wallet's returned transaction", () => {
  it("answers the payer's signature from a real return, and the server's own check accepts it", async () => {
    const request = walletRequest(await checked())!;
    const signature = await request.signatureIn(await signedTransaction(KEYED.payers[1]!, request.transaction));
    expect(signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    const bytes = Uint8Array.from(atob(signature!), (c) => c.charCodeAt(0));
    await expect(verifyPayerSignature(VALIDATED, { wallet: address(KEYED.payers[1]!.address), signatureBytes: bytes })).resolves.toBeTruthy();
  });

  it.each<[string, (transaction: Uint8Array) => Promise<Uint8Array>]>([
    ["only another payer's signature", (transaction) => signedTransaction(KEYED.payers[2]!, transaction)],
    [
      "another payer's signature beside the payer's",
      async (transaction) => signedTransaction(KEYED.payers[2]!, await signedTransaction(KEYED.payers[1]!, transaction)),
    ],
    [
      "a changed message",
      async (transaction) => signedTransaction(KEYED.payers[1]!, Uint8Array.from(transaction, (b, i) => (i === transaction.length - 1 ? b ^ 1 : b))),
    ],
    ["no signature at all", async (transaction) => transaction],
    ["bytes that aren't a transaction", async () => new Uint8Array([1, 2, 3])],
  ])("answers null for %s", async (_, returned) => {
    const request = walletRequest(await checked())!;
    expect(await request.signatureIn(await returned(request.transaction))).toBeNull();
  });
});

describe("the check of the approval before the upload", () => {
  const asBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)) as SignatureBase64;

  it("passes the payer's signature over the validated message", async () => {
    const payment = await checked();
    const approval = { messageHash: payment.messageHash, signature: asBase64(await signBytes(KEYED.payers[1]!, Uint8Array.from(VALIDATED.message.messageBytes))) };
    expect(await checkPayment.returned(payment, approval)).toEqual({ ok: true, value: approval });
  });

  it.each<[string, (payment: CheckedPayment) => Promise<PaymentApproval>]>([
    [
      "another payer's signature",
      async (payment) => ({ messageHash: payment.messageHash, signature: asBase64(await signBytes(KEYED.payers[2]!, Uint8Array.from(VALIDATED.message.messageBytes))) }),
    ],
    [
      "a signature over other bytes",
      async (payment) => ({ messageHash: payment.messageHash, signature: asBase64(await signBytes(KEYED.payers[1]!, walletRequest(payment)!.transaction)) }),
    ],
    [
      "noncanonical base64",
      async (payment) => {
        const signature = asBase64(await signBytes(KEYED.payers[1]!, Uint8Array.from(VALIDATED.message.messageBytes)));
        return { messageHash: payment.messageHash, signature: signature.replace(/==$/, "=") as SignatureBase64 };
      },
    ],
    [
      "an approval of another message",
      async () => ({ messageHash: "6b".repeat(32) as MessageHash, signature: asBase64(await signBytes(KEYED.payers[1]!, Uint8Array.from(VALIDATED.message.messageBytes))) }),
    ],
  ])("refuses %s", async (_, approval) => {
    const payment = await checked();
    expect(await checkPayment.returned(payment, await approval(payment))).toEqual({ ok: false, failure: "unchecked" });
  });

  it("refuses the payer's real approval for a copy of the payment", async () => {
    const payment = await checked();
    const approval = { messageHash: payment.messageHash, signature: asBase64(await signBytes(KEYED.payers[1]!, Uint8Array.from(VALIDATED.message.messageBytes))) };
    expect(await checkPayment.returned({ ...payment }, approval)).toEqual({ ok: false, failure: "unchecked" });
  });

  it.each<[string, ReturnCheck]>([
    ["finds another signer or other bytes", async () => "mismatch"],
    ["can't run", async () => "unsupported"],
    [
      "throws",
      async () => {
        throw new Error("verifier bug");
      },
    ],
  ])("fails closed when the return check %s", async (_, returnCheck) => {
    const payment = await paymentCheck(bytesMatch, returnCheck).payload(payload, terms, room);
    if (!payment.ok) throw new Error("The sample payment didn't pass the check");
    const approval = { messageHash: payload.messageHash, signature: "c2lnbmVkIGJ5IGJlYQ==" as SignatureBase64 };
    expect(await paymentCheck(bytesMatch, returnCheck).returned(payment.value, approval)).toEqual({ ok: false, failure: "unchecked" });
  });
});
