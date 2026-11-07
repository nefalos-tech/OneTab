import { describe, expect, it } from "vitest";
import type { ActionKind } from "./catalog";
import {
  checkoutLinks,
  deriveCreateView,
  deriveResultView,
  deriveReviewActions,
  deriveRoomView,
  type CheckoutState,
  type ClientRequestId,
} from "./checkout-view";
import { SAMPLE_WALLETS } from "./fixture-data";
import { FIXTURES, fixtureCases, sampleCreateState, type FixtureCase } from "./fixtures";

const CASES = fixtureCases();
const caseById = (id: string): FixtureCase => {
  const found = CASES.find((c) => c.id === id);
  if (!found) throw new Error(`No fixture case ${id}`);
  return found;
};

const PRIMARY: readonly (readonly [caseId: string, room: ActionKind | null, result: ActionKind | null])[] = [
  ["open-spots as spot-1", "copy_link", "back_to_checkout"],
  ["open-spots as spot-2", "copy_link", "back_to_checkout"],
  ["open-spots as outsider", "join", "back_to_checkout"],
  ["open-spots as signed-out", "connect_wallet", "back_to_checkout"],
  ["full-not-ready as spot-1", null, "back_to_checkout"],
  ["full-not-ready as spot-3", "mark_ready", "back_to_checkout"],
  ["full-not-ready as outsider", null, "back_to_checkout"],
  ["full-not-ready as signed-out", "connect_wallet", "back_to_checkout"],
  ["ready as spot-1", "start_payment", "back_to_checkout"],
  ["ready as spot-2", null, "back_to_checkout"],
  ["preparing as spot-1", null, "back_to_checkout"],
  ["signing as spot-1", null, "back_to_checkout"],
  ["signing as spot-2", "approve", "back_to_checkout"],
  ["signing as outsider", null, "back_to_checkout"],
  ["signing as signed-out", "connect_wallet", "back_to_checkout"],
  ["submitting as spot-2", "view_status", null],
  ["confirming as spot-1", "view_status", null],
  ["unresolved as spot-1", "view_status", null],
  ["declined-on-hold as spot-1", "view_status", null],
  ["declined-retry as spot-1", "view_status", "retry"],
  ["declined-retry as spot-2", "view_status", null],
  ["failed-on-hold as spot-1", "view_status", null],
  ["failed-retry as spot-1", "view_status", "retry"],
  ["failed-retry as signed-out", "view_status", null],
  ["expired-on-hold as spot-1", "view_status", null],
  ["expired-retry as spot-1", "view_status", "retry"],
  ["expired-retry as outsider", "view_status", null],
  ["paid as spot-2", "view_receipt", null],
];

describe("one primary action per state and viewer", () => {
  it.each(PRIMARY)("%s: room %s, result %s", (id, room, result) => {
    const { state } = caseById(id);
    expect(deriveRoomView(state).actions.primary?.kind ?? null).toBe(room);
    expect(deriveResultView(state).actions.primary?.kind ?? null).toBe(result);
  });
});

const views = (state: CheckoutState) => [deriveRoomView(state), deriveResultView(state)] as const;

describe.each(CASES)("honesty rules hold for $id", (c) => {
  const [room, result] = views(c.state);
  const attempt = c.state.snapshot.attempt;

  it("says paid only for a paid checkout with a receipt", () => {
    for (const v of [room, result]) {
      expect(/\bpaid\b/i.test(`${v.status.label} ${v.status.line}`)).toBe(c.situation === "paid");
    }
    expect(result.body.kind === "paid").toBe(c.situation === "paid");
    expect(result.chrome.flow.every((s) => s.state === "done")).toBe(c.situation === "paid");
  });

  it("never calls approvals revoked or a payment canceled", () => {
    for (const v of [room, result]) expect(v.status.line).not.toMatch(/revok|cancel/i);
  });

  it("offers Try again only to the organizer, only when the server says canRetry", () => {
    const allowed =
      c.persona.kind === "member" &&
      c.persona.slot === 0 &&
      attempt?.canRetry === true &&
      (c.situation === "declined" || c.situation === "failed" || c.situation === "expired");
    expect(result.actions.primary?.kind === "retry").toBe(allowed);
    for (const v of [room, result]) expect(v.actions.secondary.map((a) => a.kind)).not.toContain("retry");
  });

  it("keeps Ready and Approved distinct", () => {
    const signed = new Set(attempt?.signedWallets ?? []);
    for (const spot of room.tab.spots) {
      expect(spot.status === "approved").toBe(spot.wallet !== null && signed.has(spot.wallet));
    }
  });

  it("labels sample data and never links a sample transaction to the explorer", () => {
    for (const v of [room, result]) {
      expect(v.chrome.sample).not.toBeNull();
      expect(v.actions.sample).not.toBeNull();
      expect([v.actions.primary, ...v.actions.secondary].map((a) => a?.kind)).not.toContain("view_on_explorer");
    }
  });

  it("links the screen that doesn't own the state to the one that does", () => {
    const owner = c.situation === "open_spots" || c.situation === "full_not_ready" || c.situation === "ready" ||
      c.situation === "preparing" || c.situation === "signing" ? "room" : "result";
    const back = [result.actions.primary, ...result.actions.secondary].find((a) => a?.kind === "back_to_checkout");
    expect(back).toEqual({ kind: "back_to_checkout", href: c.state.source.links.room });
    if (owner === "result") {
      expect(room.actions.primary).toMatchObject({ href: c.state.source.links.result });
      expect(room.actions.secondary).toEqual([]);
    }
  });
});

describe("status lines speak to the viewer", () => {
  it.each([
    ["signing as spot-1", "You approved. Waiting for 2 more approvals."],
    ["signing as spot-2", "Approve your share in your wallet. Nothing is sent until everyone approves."],
    ["open-spots as spot-1", "Waiting for 1 more payer. Copy the link and send it to them."],
    ["full-not-ready as outsider", "This checkout is full. Waiting for 1 payer to get ready."],
    ["declined-on-hold as spot-1", "A payer declined. Approvals already given aren't withdrawn, so this payment stays on hold until it's safely closed."],
    ["unresolved as spot-1", "We can't confirm the result yet. We keep checking the same transaction, and no new payment will start."],
  ])("%s", (id, line) => {
    expect(deriveRoomView(caseById(id).state).status.line).toBe(line);
  });

  it("shows the viewer's own share and marks their spot", () => {
    const room = deriveRoomView(caseById("open-spots as spot-2").state);
    expect(room.you).toEqual({ share: { units: "3333333", decimals: 6 }, status: "joined", isOrganizer: false });
    expect(room.tab.spots.map((s) => s.isViewer)).toEqual([false, true, false]);
    expect(room.tab.spots.map((s) => s.status)).toEqual(["ready", "joined", "open"]);
    expect(room.tab.progress).toBe("2 of 3 joined, 1 ready");
  });

  it("gives an open spot its exact share before anyone takes it", () => {
    const room = deriveRoomView(caseById("open-spots as outsider").state);
    expect(room.tab.spots[2]).toMatchObject({ wallet: null, status: "open", share: { units: "3333333" } });
    expect(room.you).toBeNull();
  });

  it("marks Paid as current, not done, while the payment is sending", () => {
    const flow = deriveResultView(caseById("submitting as spot-1").state).chrome.flow;
    expect(flow.map((s) => s.state)).toEqual(["done", "done", "done", "current"]);
  });
});

describe("contract-inconsistent snapshots stay honest", () => {
  const paid = caseById("paid as spot-2").state;
  const attempt = paid.snapshot.attempt;
  if (attempt === null) throw new Error("The paid sample lost its attempt");

  it("a confirmed attempt without a receipt is still in progress", () => {
    const state = { ...paid, snapshot: { ...paid.snapshot, attempt: { ...attempt, receipt: null } } };
    expect(deriveResultView(state).status.situation).toBe("confirming");
    expect(deriveResultView(state).body.kind).toBe("in_progress");
  });

  it("a receipt without phase paid is still in progress", () => {
    const state = { ...paid, snapshot: { ...paid.snapshot, phase: "paying" as const } };
    expect(deriveResultView(state).status.situation).toBe("confirming");
  });

  it("a live receipt links to the server's explorer URL", () => {
    const state: CheckoutState = { ...paid, source: { kind: "live", links: paid.source.links } };
    expect(deriveResultView(state).actions.primary).toEqual({
      kind: "view_on_explorer",
      href: attempt.receipt?.explorerUrl,
    });
    expect(deriveResultView(state).chrome.sample).toBeNull();
  });
});

describe("a live room", () => {
  const outsider = caseById("open-spots as outsider").state;
  const live: CheckoutState = {
    ...outsider,
    source: { kind: "live", links: checkoutLinks(outsider.snapshot.checkout.id) },
  };

  it("offers Join with the checkout's own ID, so the action knows which checkout to join", () => {
    expect(deriveRoomView(live).actions.primary).toEqual({ kind: "join", checkoutId: outsider.snapshot.checkout.id });
  });

  it("labels the network from the checkout itself", () => {
    for (const view of [deriveRoomView(live), deriveResultView(live)]) {
      expect(view.chrome.networkLabel).toBe("Test USDC on Solana Devnet");
    }
  });

  it("links the room and the result with no query", () => {
    const id = outsider.snapshot.checkout.id;
    expect(deriveResultView(live).actions.primary).toEqual({ kind: "back_to_checkout", href: `/checkouts/${id}` });
  });
});

describe("the seller", () => {
  const asSeller = (id: string): CheckoutState => {
    const { state } = caseById(id);
    return { ...state, session: { wallet: state.snapshot.checkout.sellerWallet, expiresAt: "2099-01-01T00:00:00.000Z" } };
  };

  it("is told they don't take a spot, and gets no action, while spots are open", () => {
    const room = deriveRoomView(asSeller("open-spots as outsider"));
    expect(room.status.line).toBe("You're the seller, so you don't take a spot.");
    expect(room.actions.primary).toBeNull();
    expect(room.actions.secondary).toEqual([]);
    expect(room.you).toBeNull();
  });

  it("reads like anyone else with the link once the room is full", () => {
    const room = deriveRoomView(asSeller("full-not-ready as outsider"));
    expect(room.status.line).toBe("This checkout is full. Waiting for 1 payer to get ready.");
    expect(room.actions.primary).toBeNull();
  });
});

describe("the create screen", () => {
  it("is unavailable without payment configuration and offers samples only while they are on", () => {
    const off = deriveCreateView({ config: null, session: null, source: { kind: "live", samplesOn: false } });
    expect(off).toMatchObject({ kind: "unavailable", samples: null });
    expect(off.chrome.sample).toBeNull();
    const on = deriveCreateView({ config: null, session: null, source: { kind: "live", samplesOn: true } });
    expect(on).toMatchObject({ kind: "unavailable", samples: { indexHref: "/samples", createHref: "/?sample" } });
  });

  const form = (session: CheckoutState["session"]) => {
    const view = deriveCreateView({ ...sampleCreateState(), session });
    if (view.kind !== "form") throw new Error("The sample create screen isn't a form");
    return view;
  };
  const request = {
    title: "Cabin weekend groceries",
    sellerWallet: SAMPLE_WALLETS.seller,
    totalUnits: FIXTURES["open-spots"].snapshot.checkout.totalUnits,
    payerCount: 3,
  } as const;
  const requestId = "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b" as ClientRequestId;

  it("asks a signed-out organizer to connect a wallet in Create checkout's place", () => {
    const actions = deriveReviewActions(form(null), request, requestId);
    expect(actions.primary).toEqual({ kind: "connect_wallet" });
    expect(actions.secondary).toEqual([{ kind: "edit_details" }]);
  });

  it("offers Create checkout with the reviewed request and its ID once signed in", () => {
    const session = { wallet: SAMPLE_WALLETS.organizer, expiresAt: "2099-01-01T00:00:00.000Z" };
    expect(deriveReviewActions(form(session), request, requestId).primary).toEqual({
      kind: "create_checkout",
      request,
      clientRequestId: requestId,
    });
  });

  it("with sample data, is a labeled form that leads to the open sample room", () => {
    const view = deriveCreateView(sampleCreateState());
    expect(view).toMatchObject({ kind: "form", sampleRoomHref: "/checkouts/sample-open-spots?as=spot-1" });
    expect(view.chrome.sample).not.toBeNull();
    expect(view.chrome.flow.map((s) => s.state)).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
  });
});
