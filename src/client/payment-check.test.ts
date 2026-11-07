import { describe, expect, it } from "vitest";
import { termsOf, type ApprovalTerms } from "./checkout-view";
import type { SignatureBase64 } from "@/lib/wallet/environment";
import { parseSigningPayload, type Address, type BlockHeight, type MessageHash, type Network, type SigningPayload, type TokenUnits } from "./contracts";
import { SAMPLE_WALLETS } from "./fixture-data";
import { FIXTURES } from "./fixtures";
import { checkPayment, paymentCheck, type MessageCheck, type ReturnCheck } from "./payment-check";
import { wirePayloadFor } from "./payment-fixture";

const room = FIXTURES.signing.snapshot;
const bea = { wallet: SAMPLE_WALLETS.bea, expiresAt: "2099-01-01T00:00:00.000Z" };
const terms = termsOf(room, bea)!;
const payload = parseSigningPayload(wirePayloadFor(room))!;
const bytesMatch: MessageCheck = async () => "match";
const signatureMatches: ReturnCheck = async () => "match";
const check = paymentCheck(bytesMatch, signatureMatches).payload;

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

describe("the payment check before any wallet prompt", () => {
  it("passes the payload's own bytes for the viewer when every field and byte matches the screen", async () => {
    const result = await check(payload, terms);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      attemptId: room.attempt!.id,
      account: SAMPLE_WALLETS.bea,
      messageHash: payload.messageHash,
    });
    expect(result.value.transaction).toBe(payload.transaction);
    expect(result.value.message).toBe(payload.message);
  });

  it.each<[string, SigningPayload]>([
    ["another attempt", { ...payload, attemptId: FIXTURES["declined-on-hold"].snapshot.attempt!.id }],
    ["another checkout", { ...payload, checkoutId: FIXTURES["declined-on-hold"].snapshot.checkout.id }],
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

  it("accepts any expiry height while the room has none yet", async () => {
    const result = await check({ ...payload, lastValidBlockHeight: "1" as BlockHeight }, { ...terms, lastValidBlockHeight: null });
    expect(result.ok).toBe(true);
  });

  it("refuses when Payments' byte check finds other bytes, or throws", async () => {
    expect(await paymentCheck(async () => "mismatch", signatureMatches).payload(payload, terms)).toEqual({ ok: false, failure: "mismatch" });
    expect(
      await paymentCheck(async () => {
        throw new Error("decoder bug");
      }, signatureMatches).payload(payload, terms),
    ).toEqual({ ok: false, failure: "mismatch" });
    expect(
      await paymentCheck(() => {
        throw new Error("decoder bug");
      }, signatureMatches).payload(payload, terms),
    ).toEqual({ ok: false, failure: "mismatch" });
  });

  it("fails closed when the bytes can't be checked, and until Payments' check is wired", async () => {
    expect(await paymentCheck(async () => "unsupported", signatureMatches).payload(payload, terms)).toEqual({ ok: false, failure: "unsupported" });
    expect(await checkPayment.payload(payload, terms)).toEqual({ ok: false, failure: "unsupported" });
  });
});

describe("the check of what the wallet returned, before the upload", () => {
  const approval = { messageHash: payload.messageHash, signature: "c2lnbmVkIGJ5IGJlYQ==" as SignatureBase64 };
  const checked = async (returnCheck: ReturnCheck) => {
    const payment = await paymentCheck(bytesMatch, returnCheck).payload(payload, terms);
    if (!payment.ok) throw new Error("The sample payment didn't pass the check");
    return paymentCheck(bytesMatch, returnCheck).returned(payment.value, approval);
  };

  it("passes the wallet's approval when P3's check finds the payer's signature over these bytes", async () => {
    const seen: [string, string][] = [];
    const result = await checked(async (payment, signature) => {
      seen.push([payment.messageHash, signature]);
      return "match";
    });
    expect(result).toEqual({ ok: true, value: approval });
    expect(seen).toEqual([[payload.messageHash, approval.signature]]);
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
  ])("fails closed when P3's check %s", async (_, returnCheck) => {
    expect(await checked(returnCheck)).toEqual({ ok: false, failure: "unchecked" });
  });

  it("fails closed for an approval of another message, and until P3's check is wired", async () => {
    const payment = await paymentCheck(bytesMatch, signatureMatches).payload(payload, terms);
    if (!payment.ok) throw new Error("The sample payment didn't pass the check");
    const other = { ...approval, messageHash: "6b".repeat(32) as MessageHash };
    expect(await paymentCheck(bytesMatch, signatureMatches).returned(payment.value, other)).toEqual({ ok: false, failure: "unchecked" });
    expect(await checkPayment.returned(payment.value, approval)).toEqual({ ok: false, failure: "unchecked" });
  });
});

