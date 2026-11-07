import { describe, expect, it, onTestFinished, vi } from "vitest";
import { looksLikeAddress, type Address, type ClientRequestId } from "./contracts";
import { checkDraft, requestIds, type DraftInput } from "./create-draft";
import { SAMPLE_CONFIG, SAMPLE_WALLETS } from "./fixture-data";

const wallet = (s: string): Address => {
  if (!looksLikeAddress(s)) throw new Error(`bad test wallet ${s}`);
  return s;
};
const ORGANIZER = wallet("SAMPLEorganizer1111111111111111111111111org1");
const SELLER = "SAMPLEse11er111111111111111111111111111Se11";
const ctx = { config: SAMPLE_CONFIG, organizer: ORGANIZER };
const valid: DraftInput = { title: " Cabin weekend groceries ", seller: SELLER, total: "10", payerCount: "3" };

describe("checkDraft shows exact shares before anything is created", () => {
  it("splits 10 test USDC across 3 payers with the remainder in spot 1", () => {
    const check = checkDraft(valid, ctx);
    if (!check.ok) throw new Error(JSON.stringify(check.errors));
    expect(check.review.request).toEqual({
      title: "Cabin weekend groceries",
      sellerWallet: SELLER,
      totalUnits: "10000000",
      payerCount: 3,
    });
    expect(check.review.tab.spots.map((s) => [s.share.units, s.status, s.wallet])).toEqual([
      ["3333334", "joined", ORGANIZER],
      ["3333333", "open", null],
      ["3333333", "open", null],
    ]);
  });

  it("accepts the smallest splittable total", () => {
    expect(checkDraft({ ...valid, total: "0.000002", payerCount: "2" }, ctx).ok).toBe(true);
  });
});

describe("checkDraft explains each problem in plain words", () => {
  it.each<[Partial<DraftInput>, keyof DraftInput, RegExp]>([
    [{ title: "  " }, "title", /Give the checkout a name/],
    [{ title: "x".repeat(81) }, "title", /80 characters/],
    [{ seller: "" }, "seller", /Enter the seller's Solana wallet address/],
    [{ seller: "not-a-wallet" }, "seller", /isn't a Solana wallet address/],
    [{ seller: ORGANIZER }, "seller", /can't be your own wallet/],
    [{ payerCount: "" }, "payerCount", /Choose 2 or 3 payers/],
    [{ total: "" }, "total", /Enter the total in test USDC/],
    [{ total: "ten" }, "total", /digits and a decimal point/],
    [{ total: "1.0000001" }, "total", /at most 6 decimal places/],
    [{ total: "0" }, "total", /more than zero/],
    [{ total: "0.000002" }, "total", /too small to split.*0\.000001 test USDC/],
  ])("%j fails %s", (patch, field, message) => {
    const check = checkDraft({ ...valid, ...patch }, ctx);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.errors[field]).toMatch(message);
    expect(Object.keys(check.errors)).toEqual([field]);
  });
});

describe("requestIds gives each set of details one ID for the life of the form", () => {
  const counter = () => {
    let n = 0;
    return () => `id-${(n += 1)}` as ClientRequestId;
  };
  const request = (patch: Partial<DraftInput> = {}) => {
    const check = checkDraft({ ...valid, ...patch }, ctx);
    if (!check.ok) throw new Error(JSON.stringify(check.errors));
    return check.review.request;
  };

  it("keeps the ID for the same details, so a retry can't create a second checkout", () => {
    const idFor = requestIds(counter());
    expect(idFor(request())).toBe(idFor(request({ title: "Cabin weekend groceries" })));
  });

  it.each<[string, Partial<DraftInput>]>([
    ["title", { title: "Concert tickets" }],
    ["seller", { seller: SAMPLE_WALLETS.cam }],
    ["total", { total: "12" }],
    ["payer count", { payerCount: "2" }],
  ])("makes a new ID when the %s changes", (_, patch) => {
    const idFor = requestIds(counter());
    expect(idFor(request())).not.toBe(idFor(request(patch)));
  });

  it("returns A's ID for details A, then B, then A again", () => {
    const idFor = requestIds(counter());
    const a = idFor(request());
    const b = idFor(request({ total: "12" }));
    expect(idFor(request())).toBe(a);
    expect(b).not.toBe(a);
  });

  it("mints UUIDs by default", () => {
    expect(requestIds()(request())).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  const cryptoWithoutRandomUuid = (getRandomValues: (bytes: Uint8Array) => Uint8Array) => {
    vi.stubGlobal("crypto", { getRandomValues });
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
  };

  it.each([
    [0x00, "00000000-0000-4000-8000-000000000000"],
    [0xff, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
  ])("mints a version 4 UUID from random bytes of %i where crypto has no randomUUID, as on a plain-http LAN address", (byte, uuid) => {
    cryptoWithoutRandomUuid((bytes) => bytes.fill(byte));
    expect(requestIds()(request())).toBe(uuid);
  });

  it("writes the random bytes in order", () => {
    cryptoWithoutRandomUuid((bytes) => bytes.map((_, i) => i));
    expect(requestIds()(request())).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});
