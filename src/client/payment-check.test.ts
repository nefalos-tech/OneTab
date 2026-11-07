import { describe, expect, it } from "vitest";
import { termsOf, type ApprovalTerms } from "./checkout-view";
import { parseSigningPayload, type Address, type Network, type SigningPayload, type TokenUnits } from "./contracts";
import { SAMPLE_WALLETS } from "./fixture-data";
import { FIXTURES } from "./fixtures";
import { checkPayment, paymentCheck, type MessageCheck } from "./payment-check";
import { wirePayloadFor } from "./payment-fixture";

const room = FIXTURES.signing.snapshot;
const bea = { wallet: SAMPLE_WALLETS.bea, expiresAt: "2099-01-01T00:00:00.000Z" };
const terms = termsOf(room, bea)!;
const payload = parseSigningPayload(wirePayloadFor(room))!;
const bytesMatch: MessageCheck = async () => "match";
const check = paymentCheck(bytesMatch);

type Contribution = SigningPayload["payment"]["contributions"][number];
const units = (n: bigint) => n.toString() as TokenUnits;
const withPayment = (patch: Partial<SigningPayload["payment"]>): SigningPayload => ({ ...payload, payment: { ...payload.payment, ...patch } });
const withContributions = (change: (c: Contribution, slot: number) => Partial<Contribution>): SigningPayload =>
  withPayment({ contributions: payload.payment.contributions.map((c, slot) => ({ ...c, ...change(c, slot) })) });
const [first, second] = payload.payment.contributions.map((c) => BigInt(c.amountUnits));

/** The room and the payload agree on these, and the payment would still be wrong to approve. */
function agreeing(change: (c: Contribution, slot: number) => Partial<Contribution>, patch: Partial<ApprovalTerms> = {}) {
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
    ["another expiry height than the room's", { ...payload, lastValidBlockHeight: payload.lastValidBlockHeight + 150n }],
  ])("refuses %s before the wallet opens, whatever the bytes", async (_, tampered) => {
    expect(await check(tampered, terms)).toEqual({ ok: false, failure: "mismatch" });
  });

  it.each<[string, readonly [SigningPayload, ApprovalTerms]]>([
    ["the seller as a payer", agreeing((_, slot) => (slot === 2 ? { wallet: room.checkout.sellerWallet } : {}))],
    ["one wallet in two spots", agreeing((_, slot) => (slot === 2 ? { wallet: SAMPLE_WALLETS.bea } : {}))],
    ["shares that don't add up to the total", agreeing(() => ({}), { totalUnits: units(BigInt(terms.totalUnits) + 1n) })],
    ["a viewer who isn't a payer", agreeing(() => ({}), { payer: SAMPLE_WALLETS.outsider as Address })],
  ])("refuses %s even when the room shows the same", async (_, [tampered, shown]) => {
    expect(await check(tampered, shown)).toEqual({ ok: false, failure: "mismatch" });
  });

  it("refuses a payload that leaves out a payer whose share is zero, though the rest adds up", async () => {
    const [whole, shown] = agreeing((_, slot) => ({ amountUnits: units(slot === 2 ? 0n : 1n) }), { totalUnits: units(2n) });
    const leftOut = { ...whole, payment: { ...whole.payment, contributions: whole.payment.contributions.slice(0, 2) } };
    expect((await check(whole, shown)).ok).toBe(true);
    expect(await check(leftOut, shown)).toEqual({ ok: false, failure: "mismatch" });
  });

  it("accepts any expiry height while the room has none yet", async () => {
    const result = await check({ ...payload, lastValidBlockHeight: 1n }, { ...terms, lastValidBlockHeight: null });
    expect(result.ok).toBe(true);
  });

  it("refuses when Payments' byte check finds other bytes, or throws", async () => {
    expect(await paymentCheck(async () => "mismatch")(payload, terms)).toEqual({ ok: false, failure: "mismatch" });
    expect(
      await paymentCheck(async () => {
        throw new Error("decoder bug");
      })(payload, terms),
    ).toEqual({ ok: false, failure: "mismatch" });
    expect(
      await paymentCheck(() => {
        throw new Error("decoder bug");
      })(payload, terms),
    ).toEqual({ ok: false, failure: "mismatch" });
  });

  it("fails closed when the bytes can't be checked, and until Payments' check is wired", async () => {
    expect(await paymentCheck(async () => "unsupported")(payload, terms)).toEqual({ ok: false, failure: "unsupported" });
    expect(await checkPayment(payload, terms)).toEqual({ ok: false, failure: "unsupported" });
  });
});
