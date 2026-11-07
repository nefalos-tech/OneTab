import { describe, expect, it } from "vitest";
import { looksLikeAddress, type Address } from "./contracts";
import { checkDraft, type DraftInput } from "./create-draft";
import { SAMPLE_CONFIG } from "./fixture-data";

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
