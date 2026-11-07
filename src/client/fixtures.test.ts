import { describe, expect, it } from "vitest";
import { SITUATIONS, type Situation } from "./catalog";
import { looksLikeAddress, type Phase, type RoomSnapshot } from "./contracts";
import { deriveRoomView } from "./checkout-view";
import { SAMPLE_CONFIG, SAMPLE_WALLETS, hasPaidMarker, type SampleName } from "./fixture-data";
import { FIXTURES, fixtureCases, parseCheckoutRef, parseFixtureFlag, personaParam, sampleIndex } from "./fixtures";

const ENTRIES = Object.entries(FIXTURES);

function contractPhase(s: RoomSnapshot, paidMarker: boolean): Phase {
  const a = s.attempt;
  if (paidMarker || (a?.state === "confirmed" && a.receipt?.confirmationStatus === "finalized")) return "paid";
  if (a && (a.state === "declined" || a.state === "unresolved" || a.state === "failed" || a.state === "expired"))
    return "needs_attention";
  if (a) return "paying";
  const full = s.participants.length === s.checkout.payerCount;
  return full && s.participants.every((p) => p.ready) ? "ready" : "open";
}

describe.each(ENTRIES)("fixture %s is a snapshot the server could send", (name, entry) => {
  const { checkout, participants, attempt } = entry.snapshot;

  it("has the phase contracts.md derives", () => {
    expect(entry.snapshot.phase).toBe(contractPhase(entry.snapshot, hasPaidMarker(name as SampleName)));
  });

  it("splits shares by the spec's remainder rule, organizer in slot 0", () => {
    const total = BigInt(checkout.totalUnits);
    const n = BigInt(checkout.payerCount);
    for (const p of participants) {
      expect(BigInt(p.shareUnits)).toBe(total / n + (BigInt(p.slot) < total % n ? 1n : 0n));
    }
    expect(participants.map((p) => p.slot)).toEqual([...participants.keys()]);
    expect(participants[0]?.wallet).toBe(checkout.organizerWallet);
    expect(new Set(participants.map((p) => p.wallet)).size).toBe(participants.length);
    expect(participants.map((p) => p.wallet)).not.toContain(checkout.sellerWallet);
  });

  it("keeps attempt fields consistent", () => {
    if (attempt === null) return;
    const wallets = participants.map((p) => p.wallet);
    for (const w of attempt.signedWallets) expect(wallets).toContain(w);
    if (attempt.receipt !== null) {
      expect(attempt.state).toBe("confirmed");
      const sum = attempt.receipt.contributions.reduce((acc, c) => acc + BigInt(c.amountUnits), 0n);
      expect(sum).toBe(BigInt(attempt.receipt.totalUnits));
      expect(attempt.receipt.transactionReference).toBe(attempt.transactionReference);
    }
    expect(participants.every((p) => p.ready)).toBe(true);
    expect(participants).toHaveLength(checkout.payerCount);
    if (attempt.state === "unresolved") expect(attempt.canRetry).toBe(false);
  });

  it("shows the situation it was written for", () => {
    const anyCase = fixtureCases().find((c) => c.fixture === name);
    if (!anyCase) throw new Error(`no cases for ${name}`);
    expect(deriveRoomView(anyCase.state).status.situation).toBe(entry.situation);
  });
});

describe("the registry covers the state matrix", () => {
  it("has a fixture for every situation", () => {
    const covered = new Set<Situation>(ENTRIES.map(([, e]) => e.situation));
    expect([...covered].sort()).toEqual(Object.keys(SITUATIONS).sort());
  });

});

const ROOM_ERROR = { code: "INVALID_PAYMENT", message: "Payment attempt did not complete." };

describe("samples are rooms the server can produce", () => {
  const attempts = ENTRIES.flatMap(([name, e]) => (e.snapshot.attempt === null ? [] : [[name, e.snapshot.attempt] as const]));

  it.each(attempts)("%s is safe to replace exactly when it failed or expired, which only safely resolved attempts do", (_, attempt) => {
    expect(attempt.canRetry).toBe(attempt.state === "failed" || attempt.state === "expired");
  });

  it.each(attempts)("%s carries the room's masked error or none", (_, attempt) => {
    if (attempt.error !== null) expect(attempt.error).toEqual(ROOM_ERROR);
  });

  it.each(attempts.filter(([, a]) => a.state === "failed" && a.transactionReference === null))(
    "%s failed while preparing, so nobody approved and it has no expiry height",
    (_, attempt) => {
      expect(attempt.signedWallets).toEqual([]);
      expect(attempt.lastValidBlockHeight).toBeNull();
    },
  );

  it("show a paid room without its attempt only in paid-no-receipt", () => {
    const lost = ENTRIES.filter(([, e]) => e.snapshot.phase === "paid" && e.snapshot.attempt === null).map(([name]) => name);
    expect(lost).toEqual(["paid-no-receipt"]);
  });

  it("include a failure before sending and one after, so both reasons have a sample", () => {
    const failed = attempts.filter(([, a]) => a.state === "failed").map(([, a]) => a.transactionReference !== null);
    expect(new Set(failed)).toEqual(new Set([false, true]));
  });
});

describe("URL selection", () => {
  const realId = FIXTURES.signing.snapshot.checkout.id;

  it("routes a UUID to the live path even when it is a fixture's own checkout id", () => {
    expect(parseCheckoutRef({ id: realId, as: "spot-1", fixturesOn: true })).toEqual({ kind: "live", checkoutId: realId });
  });

  it.each(ENTRIES)("routes the UUID of %s in uppercase to the live path as its lowercase form", (_, entry) => {
    const id = entry.snapshot.checkout.id;
    expect(parseCheckoutRef({ id: id.toUpperCase(), as: "spot-1", fixturesOn: true })).toEqual({ kind: "live", checkoutId: id });
  });

  it.each([
    ["sample-signing", undefined, false],
    ["sample-nope", undefined, true],
    ["sample-ready", "spot-3", true],
    ["sample-open-spots", "spot-3", true],
    ["sample-signing", ["spot-1", "spot-2"], true],
    ["sample-signing", "Spot-1", true],
    ["signing", undefined, true],
  ] as const)("404s %s as %j with fixtures %s", (id, as, fixturesOn) => {
    expect(parseCheckoutRef({ id, as, fixturesOn })).toBeNull();
  });

  it("uses the fixture's default viewer when ?as= is absent", () => {
    expect(parseCheckoutRef({ id: "sample-signing", as: undefined, fixturesOn: true })).toEqual({
      kind: "sample",
      fixture: "signing",
      persona: FIXTURES.signing.defaultPersona,
    });
  });

  it.each(fixtureCases())("round-trips the viewer of $id", (c) => {
    const ref = parseCheckoutRef({ id: `sample-${c.fixture}`, as: personaParam(c.persona), fixturesOn: true });
    expect(ref).toEqual({ kind: "sample", fixture: c.fixture, persona: c.persona });
  });

  it.each([
    ["1", "production", true],
    ["0", "development", false],
    [undefined, "development", true],
    ["", "development", true],
    [undefined, "production", false],
    [undefined, "test", false],
  ] as const)("ONETAB_FIXTURES=%j under NODE_ENV=%s is %s", (flag, nodeEnv, on) => {
    expect(parseFixtureFlag(flag, nodeEnv)).toBe(on);
  });

  it("refuses an unclear ONETAB_FIXTURES value", () => {
    expect(() => parseFixtureFlag("yes", "production")).toThrow(/ONETAB_FIXTURES/);
  });
});

describe("sample addresses can't pass for real ones and tell payers apart", () => {
  const addresses = [...Object.values(SAMPLE_WALLETS), SAMPLE_CONFIG.mint];

  it("start with SAMPLE, are base58 and end in distinct readable characters", () => {
    for (const a of addresses) {
      expect(a.startsWith("SAMPLE")).toBe(true);
      expect(looksLikeAddress(a)).toBe(true);
    }
    expect(addresses.map((a) => a.slice(-4))).toEqual(["org1", "Bea2", "Cam3", "Gst4", "Se11", "Usdc"]);
  });

  it("use a SAMPLE transaction reference with its own ending", () => {
    const ref = FIXTURES.paid.snapshot.attempt?.transactionReference ?? "";
    expect(ref).toMatch(/^SAMPLE[1-9A-HJ-NP-Za-km-z]{78,82}$/);
    expect(addresses.map((a) => a.slice(-4))).not.toContain(ref.slice(-4));
  });
});

describe("the /samples index", () => {
  it("lists every sample once with a link per viewer, the default marked", () => {
    const index = sampleIndex();
    expect(index.map((e) => e.fixture)).toEqual(Object.keys(FIXTURES));
    for (const entry of index) {
      expect(entry.personas.filter((p) => p.isDefault)).toHaveLength(1);
      expect(entry.owner).toBe(SITUATIONS[entry.situation].owner);
    }
    expect(index.flatMap((e) => e.personas)).toHaveLength(fixtureCases().length);
  });
});
