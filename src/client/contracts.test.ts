import { describe, expect, it } from "vitest";
import { parsePublicConfig, parseRoomSnapshot } from "./contracts";
import { SAMPLE_CONFIG } from "./fixture-data";
import { FIXTURES } from "./fixtures";

const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

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
    ["no participants list", { ...open, participants: undefined }],
    ["an HTML page", "<html>Not found</html>"],
  ])("rejects %s", (_, data) => {
    expect(parseRoomSnapshot(overTheWire(data))).toBeNull();
  });

  it("keeps only the contract's fields", () => {
    const parsed = parseRoomSnapshot({ ...overTheWire(open) as object, debug: "server internals" });
    expect(parsed).toEqual(open);
    expect(parsed).not.toHaveProperty("debug");
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
