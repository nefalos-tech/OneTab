import { describe, expect, it } from "vitest";
import {
  parseAttemptId,
  parseAttemptSummary,
  parseCheckoutId,
  parsePublicConfig,
  parseRoomSnapshot,
  parseSigningPayload,
} from "./contracts";
import { SAMPLE_CONFIG } from "./fixture-data";
import { FIXTURES } from "./fixtures";
import { wirePayloadFor } from "./payment-fixture";

const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const LOWER = "0b8f3c1e-7d2a-4c55-9f10-2a6b8e4d1c01";
const UPPER = "0B8F3C1E-7D2A-4C55-9F10-2A6B8E4D1C01";

describe("parseRoomSnapshot", () => {
  it.each(Object.entries(FIXTURES))("reads the %s sample exactly as it was sent", (_, entry) => {
    expect(parseRoomSnapshot(overTheWire(entry.snapshot))).toEqual(entry.snapshot);
  });

  const open = FIXTURES["open-spots"].snapshot;
  const paid = FIXTURES.paid.snapshot;
  const withAttempt = (patch: object) => ({ ...paid, attempt: { ...paid.attempt, ...patch } });

  it.each<[string, unknown]>([
    ["an unknown phase", { ...open, phase: "closed" }],
    ["an unknown attempt state", withAttempt({ state: "pending" })],
    ["a payer count of 4", { ...open, checkout: { ...open.checkout, payerCount: 4 } }],
    ["a slot outside the payer count", { ...open, participants: [{ ...open.participants[0]!, slot: 3 }] }],
    ["a checkout ID that isn't a UUID", { ...open, checkout: { ...open.checkout, id: "sample-open-spots" } }],
    ["a seller that isn't an address", { ...open, checkout: { ...open.checkout, sellerWallet: "not a wallet" } }],
    ["a total that isn't integer units", { ...open, checkout: { ...open.checkout, totalUnits: "10.5" } }],
    ["another network", { ...open, checkout: { ...open.checkout, network: "mainnet-beta" } }],
    ["a receipt that can't be dated", withAttempt({ receipt: { ...paid.attempt!.receipt!, observedAt: "soon" } })],
    ["an attempt error with an unknown code", withAttempt({ error: { code: "OOPS", message: "x" } })],
    ["an attempt ID that isn't a UUID", withAttempt({ id: "attempt-1" })],
    ["an expiry height that isn't a whole number", withAttempt({ lastValidBlockHeight: "312345678.5" })],
    ["no participants list", { ...open, participants: undefined }],
    ["an HTML page", "<html>Not found</html>"],
  ])("rejects %s", (_, data) => {
    expect(parseRoomSnapshot(overTheWire(data))).toBeNull();
  });

  it("reads an uppercase checkout ID as its lowercase form", () => {
    const shouted = { ...open, checkout: { ...open.checkout, id: UPPER } };
    expect(parseRoomSnapshot(overTheWire(shouted))?.checkout.id).toBe(LOWER);
  });

  it("keeps only the contract's fields", () => {
    const parsed = parseRoomSnapshot({ ...overTheWire(open) as object, debug: "server internals" });
    expect(parsed).toEqual(open);
    expect(parsed).not.toHaveProperty("debug");
  });
});

describe("parseCheckoutId", () => {
  it("reads a UUID in any case as its lowercase form", () => {
    expect(parseCheckoutId(UPPER)).toBe(LOWER);
    expect(parseCheckoutId(LOWER)).toBe(LOWER);
  });

  it.each(["", "sample-open-spots", `{${LOWER}}`, LOWER.replaceAll("-", ""), `${LOWER.slice(0, -1)}g`, ` ${LOWER}`])("refuses %j", (text) => {
    expect(parseCheckoutId(text)).toBeNull();
  });
});

describe("parseAttemptId", () => {
  it("reads a UUID in any case as its lowercase form", () => {
    expect(parseAttemptId(UPPER)).toBe(LOWER);
  });

  it.each(["", "attempt-1", LOWER.replaceAll("-", ""), `../${LOWER}`])("refuses %j", (text) => {
    expect(parseAttemptId(text)).toBeNull();
  });
});

describe("parseAttemptSummary", () => {
  const attempt = FIXTURES.signing.snapshot.attempt!;

  it("reads an attempt route's answer exactly as it was sent", () => {
    expect(parseAttemptSummary(overTheWire(attempt))).toEqual(attempt);
  });

  it("refuses an answer that isn't an attempt", () => {
    expect(parseAttemptSummary(overTheWire({ ...attempt, id: "attempt-1" }))).toBeNull();
    expect(parseAttemptSummary(overTheWire(FIXTURES.signing.snapshot))).toBeNull();
  });
});

describe("parseSigningPayload", () => {
  const signing = FIXTURES.signing.snapshot;
  const wire = wirePayloadFor(signing);
  const payment = wire.payment as Record<string, unknown> & { readonly contributions: readonly Record<string, unknown>[] };
  const withPayment = (patch: object) => ({ ...wire, payment: { ...payment, ...patch } });

  it("decodes the bytes and the expiry height, and keeps every contribution in slot order", () => {
    const parsed = parseSigningPayload(overTheWire(wire));
    const message = new TextEncoder().encode(`OneTab payment for ${signing.attempt!.id}`);
    expect(parsed?.message).toEqual(message);
    expect(parsed?.transaction).toEqual(new Uint8Array([1, ...new Uint8Array(64), ...message]));
    expect(parsed?.lastValidBlockHeight).toBe("312345678");
    expect(parsed?.attemptId).toBe(signing.attempt!.id);
    expect(parsed?.payment.contributions.map((c) => [c.slot, c.wallet, c.amountUnits])).toEqual(
      signing.participants.map((p) => [p.slot, p.wallet, p.shareUnits]),
    );
  });

  it("reads uppercase IDs as their lowercase form", () => {
    const shouted = { ...wire, attemptId: String(wire.attemptId).toUpperCase(), checkoutId: String(wire.checkoutId).toUpperCase() };
    expect(parseSigningPayload(shouted)).toMatchObject({ attemptId: wire.attemptId, checkoutId: wire.checkoutId });
  });

  it.each<[string, unknown]>([
    ["an attempt ID that isn't a UUID", { ...wire, attemptId: "attempt-1" }],
    ["transaction bytes that aren't base64", { ...wire, transactionBase64: "not base64!" }],
    ["base64 without its padding", { ...wire, messageBase64: String(wire.messageBase64).replace(/=+$/, "") }],
    ["empty message bytes", { ...wire, messageBase64: "" }],
    ["a hash in uppercase", { ...wire, messageHash: "5A".repeat(32) }],
    ["a hash that is too short", { ...wire, messageHash: "5a".repeat(31) }],
    ["a blockhash that isn't base58", { ...wire, blockhash: "0".repeat(44) }],
    ["a negative expiry height", { ...wire, lastValidBlockHeight: "-1" }],
    ["an expiry height sent as a number", { ...wire, lastValidBlockHeight: 312345678 }],
    ["another network", withPayment({ network: "mainnet-beta" })],
    ["a seller token account that isn't an address", withPayment({ sellerTokenAccount: "seller usdc" })],
    ["a fee payer that isn't an address", withPayment({ feePayerWallet: null })],
    ["contributions out of slot order", withPayment({ contributions: [...payment.contributions].reverse() })],
    ["a single contribution", withPayment({ contributions: payment.contributions.slice(0, 1) })],
    ["a share that isn't integer units", withPayment({ contributions: [{ ...payment.contributions[0], amountUnits: "1.5" }, ...payment.contributions.slice(1)] })],
    ["no payment", { ...wire, payment: undefined }],
    ["an HTML page", "<html>Not found</html>"],
  ])("rejects %s", (_, data) => {
    expect(parseSigningPayload(overTheWire(data))).toBeNull();
  });
});

describe("parsePublicConfig", () => {
  it("reads the configuration exactly as it was sent", () => {
    expect(parsePublicConfig(overTheWire(SAMPLE_CONFIG))).toEqual(SAMPLE_CONFIG);
  });

  it.each<[string, unknown]>([
    ["another network", { ...SAMPLE_CONFIG, network: "mainnet-beta" }],
    ["negative decimals", { ...SAMPLE_CONFIG, tokenDecimals: -1 }],
    ["fractional decimals", { ...SAMPLE_CONFIG, tokenDecimals: 6.5 }],
    ["a mint that isn't an address", { ...SAMPLE_CONFIG, mint: "usdc" }],
    ["a weaker confirmation target", { ...SAMPLE_CONFIG, confirmationTarget: "confirmed" }],
    ["null", null],
  ])("rejects %s", (_, data) => {
    expect(parsePublicConfig(data)).toBeNull();
  });
});
