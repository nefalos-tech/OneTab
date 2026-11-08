import { describe, expect, it } from "vitest";
import { roomFixtures } from "@/fixtures";
import { REQUEST_PROBLEMS, STOP_REASONS, WALLET_WAITING, WORDS, type ActionKind, type Situation } from "./catalog";
import {
  NOTHING_HEARD,
  checkoutLinks,
  deriveCreateView,
  deriveResultView,
  deriveReviewActions,
  deriveRoomView,
  busyShown,
  noticeApplies,
  noticeOf,
  ownerOf,
  termsOf,
  type ActionsView,
  type CheckoutState,
  type ClientRequestId,
  type Notice,
  type PageFacts,
  type ResultView,
  type RoomView,
} from "./checkout-view";
import {
  ATTEMPT_STATES,
  PHASES,
  parseRoomSnapshot,
  type Address,
  type AttemptSummary,
  type Receipt,
  type RoomSnapshot,
  type Session,
  type TokenUnits,
} from "./contracts";
import { SAMPLE_WALLETS } from "./fixture-data";
import { FIXTURES, fixtureCases, sampleCreateState, type FixtureCase } from "./fixtures";
import { pollPlan } from "./live-actions";

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
  ["paid-no-receipt as spot-1", "view_status", null],
  ["submitting as signed-out", "view_status", "connect_wallet"],
  ["paid-no-receipt as signed-out", "view_status", "connect_wallet"],
  ["unresolved as spot-1", "view_status", null],
  ["unresolved as outsider", "view_status", null],
  ["unresolved as signed-out", "view_status", "connect_wallet"],
  ["declined as signed-out", "view_status", "connect_wallet"],
  ["declined as spot-1", "view_status", null],
  ["declined as spot-2", "view_status", null],
  ["failed-not-sent as spot-1", "view_status", "retry"],
  ["failed-not-sent as spot-2", "view_status", null],
  ["failed-not-sent as signed-out", "view_status", "connect_wallet"],
  ["failed-on-chain as spot-1", "view_status", "retry"],
  ["expired as spot-1", "view_status", "retry"],
  ["expired as outsider", "view_status", null],
  ["expired as signed-out", "view_status", "connect_wallet"],
  ["paid as spot-2", "view_receipt", null],
  ["paid as signed-out", "view_receipt", null],
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

  it("never says an approval was withdrawn, revoked or canceled", () => {
    for (const v of [room, result]) expect(v.status.line).not.toMatch(/revok|cancel|withdr/i);
  });

  it("offers Try again only to the organizer, only when the server says canRetry", () => {
    const allowed =
      c.persona.kind === "member" &&
      c.persona.slot === 0 &&
      attempt?.canRetry === true &&
      (c.situation === "failed" || c.situation === "expired");
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
    ["signing as spot-2", "Check the payment, then approve it in your wallet. Nothing is sent until everyone approves."],
    ["full-not-ready as spot-3", "Everyone has joined. Check your share, then tell the group you're ready, which moves no money."],
    ["ready as spot-1", "Everyone is ready. Start the payment to ask each payer to approve it."],
    ["open-spots as spot-1", "You're ready. Waiting for 1 more payer, so copy the link and send it to them."],
    ["open-spots as spot-2", "You joined. Waiting for 1 more payer."],
    ["full-not-ready as outsider", "This checkout is full. Waiting for 1 payer to get ready."],
    ["declined as spot-1", "A payer declined, so this payment stays on hold until it's safely closed."],
    ["unresolved as spot-1", "We can't confirm the result yet, so this page keeps checking the same transaction and no new payment will start."],
    [
      "unresolved as outsider",
      "We can't confirm the result yet, so OneTab keeps checking the same transaction while a payer has this checkout open, and no new payment will start.",
    ],
    [
      "unresolved as signed-out",
      "We can't confirm the result yet, so OneTab keeps checking the same transaction while a payer has this checkout open, and no new payment will start. Sign in with your wallet if you hold a spot.",
    ],
    ["failed-not-sent as signed-out", "No share reached the seller, and the organizer can start a new payment that everyone approves again. Sign in with your wallet if you hold a spot."],
    ["failed-not-sent as spot-1", "No share reached the seller. Try again to ask everyone to approve a new payment."],
    [
      "expired as spot-2",
      "This payment expired before reaching the seller, and the organizer can start a new payment that everyone approves again.",
    ],
  ])("%s", (id, line) => {
    expect(deriveRoomView(caseById(id).state).status.line).toBe(line);
  });

  it.each<[string, string, boolean, string]>([
    ["the organizer", "open-spots as spot-1", false, "Waiting for 1 more payer, so copy the link and send it to them."],
    ["a payer", "open-spots as spot-2", true, "You're ready. Waiting for 1 more payer."],
  ])("while a spot is open, the line says when %s turns ready or not, so the status region announces it", (_, id, ready, line) => {
    const { state } = caseById(id);
    const wallet = state.session!.wallet;
    const toggled = { ...state.snapshot, participants: state.snapshot.participants.map((p) => (p.wallet === wallet ? { ...p, ready } : p)) };
    const before = deriveRoomView(state);
    const after = deriveRoomView({ ...state, snapshot: toggled });
    expect(after.status.line).toBe(line);
    expect(after.status.line).not.toBe(before.status.line);
    expect(after.actions.secondary.map((a) => a.kind)).toEqual([ready ? "mark_not_ready" : "mark_ready"]);
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

describe("the screen that owns the room", () => {
  it.each([
    ["full-not-ready", "room"],
    ["ready", "room"],
    ["preparing", "room"],
    ["signing", "room"],
    ["submitting", "result"],
    ["declined", "result"],
    ["unresolved", "result"],
    ["paid", "result"],
  ] as const)("is the %s room's %s", (name, screen) => {
    expect(ownerOf(FIXTURES[name].snapshot)).toBe(screen);
  });
});

describe("a receipt shows only when the room proves this checkout's payment", () => {
  const paid = caseById("paid as spot-2").state;
  const attempt = paid.snapshot.attempt!;
  const receipt = attempt.receipt!;
  const shares = receipt.contributions;
  const live = (snapshot: RoomSnapshot): CheckoutState => ({ ...paid, snapshot, source: { kind: "live", links: checkoutLinks(snapshot.checkout.id) } });
  const withAttempt = (changes: Partial<AttemptSummary>): RoomSnapshot => ({ ...paid.snapshot, attempt: { ...attempt, ...changes } });
  const withReceipt = (changes: Partial<Receipt>): RoomSnapshot => withAttempt({ receipt: { ...receipt, ...changes } });
  const unsigned = (reference: string) => withAttempt({ transactionReference: reference, receipt: { ...receipt, transactionReference: reference } });
  const spotsAre = (spots: readonly { readonly slot: number; readonly units: string }[]): RoomSnapshot => {
    const participants = spots.map(({ slot, units }, i) => ({ ...paid.snapshot.participants[i]!, slot, shareUnits: units as TokenUnits }));
    const contributions = participants.map((p) => ({ slot: p.slot, wallet: p.wallet, amountUnits: p.shareUnits }));
    return { ...withReceipt({ contributions }), participants };
  };

  function sameWallet(): RoomSnapshot {
    const twin = paid.snapshot.participants[0]!.wallet;
    const participants = paid.snapshot.participants.map((p) => (p.slot === 1 ? { ...p, wallet: twin } : p));
    const contributions = shares.map((c) => (c.slot === 1 ? { ...c, wallet: twin } : c));
    return { ...withReceipt({ contributions }), participants };
  }

  it("shows the receipt for the paid sample, so the rows below each break one thing", () => {
    expect(deriveResultView(live(paid.snapshot)).body.kind).toBe("paid");
  });

  it.each<[string, RoomSnapshot]>([
    ["names a reference other than the attempt's", withReceipt({ transactionReference: receipt.transactionReference.replace(/Txn5$/, "Txn6") })],
    ["names a reference that isn't base58", unsigned("0".repeat(88))],
    ["names a reference too short to be a signature", unsigned("1".repeat(63))],
    ["names a base58 reference that decodes to 47 bytes", unsigned("2".repeat(64))],
    ["names a base58 reference that decodes to 65 bytes", unsigned("z".repeat(88))],
    ["names the old 88-character sample reference, 65 bytes", unsigned(`SAMPLEtransaction${"1".repeat(67)}Txn5`)],
    ["names B1's confirmed fixture reference, 63 bytes", unsigned(roomFixtures.data.confirmed.attempt!.transactionReference!)],
    ["comes from a room missing a spot, listing only the spots it names", spotsAre([{ slot: 0, units: "30000000" }])],
    ["comes from a room with no one in it", spotsAre([])],
    ["comes from a room that lists spot 1 twice", spotsAre([{ slot: 0, units: "30000000" }, { slot: 0, units: "30000000" }])],
    ["comes from a room whose shares add up to a third of the total", spotsAre([{ slot: 0, units: "10000000" }, { slot: 1, units: "10000000" }])],
    ["comes from a room listing one payer who holds the whole total", spotsAre([{ slot: 0, units: paid.snapshot.checkout.totalUnits }])],
    ["comes from a room that gives two spots the same wallet", sameWallet()],
    ["comes from an attempt a payer never approved", withAttempt({ signedWallets: attempt.signedWallets.filter((w) => w !== paid.snapshot.participants[1]!.wallet) })],
    ["names another seller", withReceipt({ sellerWallet: SAMPLE_WALLETS.outsider })],
    ["names another total", withReceipt({ totalUnits: "1" as TokenUnits })],
    ["sends a share to another wallet", withReceipt({ contributions: shares.map((c) => (c.slot === 1 ? { ...c, wallet: SAMPLE_WALLETS.outsider } : c)) })],
    ["gives a share another amount", withReceipt({ contributions: shares.map((c) => (c.slot === 1 ? { ...c, amountUnits: "1" as TokenUnits } : c)) })],
    ["lists the shares out of spot order", withReceipt({ contributions: [...shares].reverse() })],
    ["leaves a share out", withReceipt({ contributions: shares.slice(0, -1) })],
    ["adds a share", withReceipt({ contributions: [...shares, { ...shares[0]!, slot: shares.length }] })],
    ["belongs to a room that isn't paid", { ...paid.snapshot, phase: "paying" }],
    ["belongs to an attempt that isn't confirmed", withAttempt({ state: "submitting" })],
    ["is missing", withAttempt({ receipt: null })],
    ["is in a paid room that lost its attempt", { ...paid.snapshot, attempt: null }],
  ])("a receipt that %s reads Finalizing, links nowhere, and the page keeps checking", (_, snapshot) => {
    const state = live(snapshot);
    for (const view of [deriveRoomView(state), deriveResultView(state)]) {
      expect(view.status.situation).toBe("confirming");
      expect([view.actions.primary, ...view.actions.secondary].map((a) => a?.kind)).not.toContain("view_on_explorer");
    }
    expect(deriveResultView(state).body.kind).toBe("in_progress");
    expect(pollPlan(snapshot, state.session).stop).toBe(false);
  });

  it("links the explorer from the checked reference, never from the server's URL", () => {
    const snapshot = withReceipt({ explorerUrl: "javascript:alert('the server URL')" });
    const state = live(snapshot);
    expect(deriveResultView(state).actions.primary).toEqual({
      kind: "view_on_explorer",
      href: `https://explorer.solana.com/tx/${receipt.transactionReference}?cluster=devnet`,
    });
    expect(JSON.stringify([deriveRoomView(state), deriveResultView(state)])).not.toContain("the server URL");
    expect(deriveResultView(state).chrome.sample).toBeNull();
    expect(pollPlan(snapshot, state.session).stop).toBe(true);
  });

  it("a paid room that lost its attempt offers no Start to the organizer on either screen", () => {
    const organizer = { ...caseById("paid-no-receipt as spot-1").state };
    for (const view of [deriveRoomView(organizer), deriveResultView(organizer)]) {
      expect(view.status.situation).toBe("confirming");
      expect([view.actions.primary, ...view.actions.secondary].map((a) => a?.kind)).not.toContain("start_payment");
    }
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

describe("a notice applies while its wallet is signed in and its action is offered", () => {
  const offering = (primary: ActionsView["primary"], secondary: ActionsView["secondary"] = []): ActionsView => ({
    primary,
    secondary,
    sample: null,
  });
  const join = offering({ kind: "join", checkoutId: FIXTURES["open-spots"].snapshot.checkout.id });
  const notice: Notice = noticeOf({ text: "Wait a few seconds, then try again.", followUp: null, wallet: SAMPLE_WALLETS.bea, raisedBy: join.primary! });

  it("applies to the wallet that raised it while the action is the primary or a secondary one", () => {
    expect(noticeApplies(notice, { wallet: SAMPLE_WALLETS.bea, actions: join })).toBe(true);
    expect(noticeApplies({ ...notice, raisedBy: { kind: "edit_details" } }, { wallet: SAMPLE_WALLETS.bea, actions: offering(null, [{ kind: "edit_details" }]) })).toBe(
      true,
    );
  });

  it.each([
    ["another wallet", SAMPLE_WALLETS.cam],
    ["no wallet", null],
  ])("ends when %s is signed in", (_, wallet) => {
    expect(noticeApplies(notice, { wallet, actions: join })).toBe(false);
  });

  it("ends when its action is no longer offered", () => {
    expect(noticeApplies(notice, { wallet: SAMPLE_WALLETS.bea, actions: offering({ kind: "connect_wallet" }) })).toBe(false);
    expect(noticeApplies(notice, { wallet: SAMPLE_WALLETS.bea, actions: offering(null) })).toBe(false);
  });

  describe("about an attempt", () => {
    const bea = { wallet: SAMPLE_WALLETS.bea, expiresAt: "2099-01-01T00:00:00.000Z" };
    const first = FIXTURES.signing.snapshot;
    const next = { ...first, attempt: { ...first.attempt!, id: FIXTURES.declined.snapshot.attempt!.id } };
    const approve = (room: typeof first) => offering({ kind: "approve", terms: termsOf(room, bea)! });
    const rejected: Notice = noticeOf({
      text: REQUEST_PROBLEMS.rejected,
      followUp: { kind: "decline", checkoutId: first.checkout.id, attemptId: first.attempt!.id },
      wallet: bea.wallet,
      raisedBy: approve(first).primary!,
    });

    it("lasts while Approve is offered for the attempt the payer rejected", () => {
      expect(noticeApplies(rejected, { wallet: bea.wallet, actions: approve(first) })).toBe(true);
    });

    it("ends, with its Decline, once the screen shows another attempt", () => {
      expect(next.attempt.id).not.toBe(first.attempt!.id);
      expect(noticeApplies(rejected, { wallet: bea.wallet, actions: approve(next) })).toBe(false);
    });

    it("from Try again lasts while Try again is for the same attempt, and ends once it is for a newer one", () => {
      const organizerSees = (room: RoomSnapshot) =>
        deriveResultView({ ...caseById("failed-not-sent as spot-1").state, snapshot: room, source: { kind: "live", links: checkoutLinks(room.checkout.id) } }).actions;
      const failed = FIXTURES["failed-not-sent"].snapshot;
      const newer = { ...failed, attempt: { ...failed.attempt!, id: FIXTURES["failed-on-chain"].snapshot.attempt!.id } };
      const refused = noticeOf({ text: REQUEST_PROBLEMS.short_usdc, followUp: null, wallet: SAMPLE_WALLETS.organizer, raisedBy: organizerSees(failed).primary! });
      expect(refused.raisedBy.kind).toBe("retry");
      expect(noticeApplies(refused, { wallet: SAMPLE_WALLETS.organizer, actions: organizerSees(failed) })).toBe(true);
      expect(organizerSees(newer).primary?.kind).toBe("retry");
      expect(noticeApplies(refused, { wallet: SAMPLE_WALLETS.organizer, actions: organizerSees(newer) })).toBe(false);

      const stoppedAgain = noticeOf({ ...refused, text: WORDS.retry_stopped }, newer.attempt.id);
      expect(noticeApplies(stoppedAgain, { wallet: SAMPLE_WALLETS.organizer, actions: organizerSees(failed) })).toBe(false);
      expect(noticeApplies(stoppedAgain, { wallet: SAMPLE_WALLETS.organizer, actions: organizerSees(newer) })).toBe(true);
      const third = { ...failed, attempt: { ...failed.attempt!, id: FIXTURES.expired.snapshot.attempt!.id } };
      expect(noticeApplies(stoppedAgain, { wallet: SAMPLE_WALLETS.organizer, actions: organizerSees(third) })).toBe(false);
    });
  });
});

describe("Try again is offered only when the server says the attempt is safely replaceable", () => {
  const failed = caseById("failed-not-sent as spot-1").state;
  const live = (changes: Partial<AttemptSummary>, wallet: Address | null = SAMPLE_WALLETS.organizer): CheckoutState => ({
    snapshot: { ...failed.snapshot, attempt: { ...failed.snapshot.attempt!, ...changes } },
    session: wallet === null ? null : { wallet, expiresAt: "2099-01-01T00:00:00.000Z" },
    source: { kind: "live", links: checkoutLinks(failed.snapshot.checkout.id) },
    page: NOTHING_HEARD,
  });
  const retryIn = (state: CheckoutState) =>
    [deriveRoomView(state), deriveResultView(state)].flatMap((v) => [v.actions.primary, ...v.actions.secondary]).filter((a) => a?.kind === "retry");

  it.each(["failed", "expired"] as const)("to the organizer of a %s attempt with canRetry, naming this checkout and that attempt", (state) => {
    const attempt = failed.snapshot.attempt!;
    expect(retryIn(live({ state, canRetry: true }))).toEqual([{ kind: "retry", checkoutId: failed.snapshot.checkout.id, retryOfAttemptId: attempt.id }]);
  });

  it.each([
    ["a failed attempt without canRetry", { state: "failed", canRetry: false }],
    ["a declined attempt that claims canRetry, which the schema forbids", { state: "declined", canRetry: true }],
    ["an unresolved attempt that claims canRetry", { state: "unresolved", canRetry: true }],
    ["a submitting attempt that claims canRetry", { state: "submitting", canRetry: true }],
  ] as const)("never for %s", (_, changes) => {
    expect(retryIn(live(changes))).toEqual([]);
  });

  it.each([
    ["a payer", SAMPLE_WALLETS.bea],
    ["the seller", SAMPLE_WALLETS.seller],
    ["someone with the link", SAMPLE_WALLETS.outsider],
    ["someone signed out", null],
  ] as const)("never to %s", (_, wallet) => {
    expect(retryIn(live({ state: "failed", canRetry: true }, wallet))).toEqual([]);
  });
});

describe("approvals that arrive out of spot order", () => {
  const room = FIXTURES.signing.snapshot;
  const withApprovals = (...wallets: Address[]) => ({ ...room, attempt: { ...room.attempt!, signedWallets: wallets } });
  const viewOf = (snapshot: typeof room, wallet: Address) =>
    deriveRoomView({ snapshot, session: { wallet, expiresAt: "2099-01-01T00:00:00.000Z" }, source: { kind: "live", links: checkoutLinks(room.checkout.id) }, page: NOTHING_HEARD });

  it.each<[string, Address[], string[]]>([
    ["the last spot first", [SAMPLE_WALLETS.cam], ["ready", "ready", "approved"]],
    ["the last and first spots, listed last first", [SAMPLE_WALLETS.cam, SAMPLE_WALLETS.organizer], ["approved", "ready", "approved"]],
  ])("mark Approved exactly the spots whose wallets approved: %s", (_, wallets, spots) => {
    for (const viewer of [SAMPLE_WALLETS.organizer, SAMPLE_WALLETS.bea, SAMPLE_WALLETS.cam, SAMPLE_WALLETS.outsider]) {
      const view = viewOf(withApprovals(...wallets), viewer);
      expect(view.tab.spots.map((s) => s.status), viewer).toEqual(spots);
      expect(view.tab.progress, viewer).toBe(`${wallets.length} of 3 approved`);
    }
  });

  it("offer Approve to the payer still waiting, and not to one who approved first", () => {
    const camFirst = withApprovals(SAMPLE_WALLETS.cam);
    expect(viewOf(camFirst, SAMPLE_WALLETS.cam).actions.primary).toBeNull();
    expect(viewOf(camFirst, SAMPLE_WALLETS.bea).actions.primary?.kind).toBe("approve");
  });
});

describe("Approve is offered only to a member with the payment's terms", () => {
  const room = FIXTURES.signing.snapshot;
  const seller = room.checkout.sellerWallet;
  const sellerInASpot = { ...room, participants: room.participants.map((p) => (p.slot === 2 ? { ...p, wallet: seller } : p)) };
  const as = (wallet: Address) => ({ wallet, expiresAt: "2099-01-01T00:00:00.000Z" });
  const live = (snapshot: typeof room, wallet: Address): CheckoutState => ({
    snapshot,
    session: as(wallet),
    source: { kind: "live", links: checkoutLinks(room.checkout.id) },
    page: NOTHING_HEARD,
  });

  it("never to the seller, even in a room that lists the seller in a spot", () => {
    expect(termsOf(sellerInASpot, as(seller))).toBeNull();
    const view = deriveRoomView(live(sellerInASpot, seller));
    expect(view.actions.primary).toBeNull();
    expect(view.approval).toBeNull();
  });

  it("never to someone outside the room", () => {
    expect(termsOf(room, as(SAMPLE_WALLETS.outsider))).toBeNull();
    expect(deriveRoomView(live(room, SAMPLE_WALLETS.outsider)).actions.primary).toBeNull();
  });

  it("to a payer who hasn't approved, with the approval summary beside it", () => {
    const view = deriveRoomView(live(room, SAMPLE_WALLETS.bea));
    expect(view.actions.primary?.kind).toBe("approve");
    expect(view.approval).not.toBeNull();
  });
});

describe("Approve shows as busy", () => {
  const bea = { wallet: SAMPLE_WALLETS.bea, expiresAt: "2099-01-01T00:00:00.000Z" };
  const room = FIXTURES.signing.snapshot;
  const actions: ActionsView = { primary: { kind: "approve", terms: termsOf(room, bea)! }, secondary: [], sample: null };
  const other = FIXTURES.declined.snapshot.attempt!.id;

  it("while this page waits on the wallet's prompt for the attempt Approve is for", () => {
    expect(busyShown(null, room.attempt!.id, actions)).toBe("approve");
  });

  it("not while the prompt is for another checkout's attempt, nor with no prompt open", () => {
    expect(busyShown(null, other, actions)).toBeNull();
    expect(busyShown(null, null, actions)).toBeNull();
  });

  it("the action that is running is busy whatever the prompt", () => {
    expect(busyShown("mark_ready", other, actions)).toBe("mark_ready");
  });
});

describe("the payment a payer approves", () => {
  const termsFor = (id: string) => {
    const { state } = caseById(id);
    return termsOf(state.snapshot, state.session);
  };

  it("is the whole frozen payment, in spot order, for a payer who hasn't approved", () => {
    const { snapshot } = caseById("signing as spot-2").state;
    expect(termsFor("signing as spot-2")).toEqual({
      checkoutId: snapshot.checkout.id,
      attemptId: snapshot.attempt!.id,
      network: "devnet",
      mint: snapshot.checkout.mint,
      tokenDecimals: 6,
      totalUnits: "10000000",
      payerCount: 3,
      seller: SAMPLE_WALLETS.seller,
      feePayer: SAMPLE_WALLETS.organizer,
      contributions: [
        { slot: 0, wallet: SAMPLE_WALLETS.organizer, amountUnits: "3333334" },
        { slot: 1, wallet: SAMPLE_WALLETS.bea, amountUnits: "3333333" },
        { slot: 2, wallet: SAMPLE_WALLETS.cam, amountUnits: "3333333" },
      ],
      payer: SAMPLE_WALLETS.bea,
      lastValidBlockHeight: "312345678",
    });
  });

  it("exists while the payment is being prepared, before it has an expiry height", () => {
    expect(termsFor("preparing as spot-1")).toMatchObject({ payer: SAMPLE_WALLETS.organizer, lastValidBlockHeight: null });
  });

  it("keeps spot order when the server lists payers in another order", () => {
    const { state } = caseById("signing as spot-2");
    const shuffled = { ...state.snapshot, participants: [...state.snapshot.participants].reverse() };
    expect(termsOf(shuffled, state.session)?.contributions.map((c) => c.slot)).toEqual([0, 1, 2]);
  });

  it.each([
    "signing as spot-1",
    "signing as outsider",
    "signing as signed-out",
    "ready as spot-1",
    "submitting as spot-2",
    "declined as spot-2",
  ])("doesn't exist for %s", (id) => {
    expect(termsFor(id)).toBeNull();
  });

  it("doesn't exist for the seller or for a room missing a payer", () => {
    const { state } = caseById("signing as spot-2");
    expect(termsOf(state.snapshot, { ...state.session!, wallet: SAMPLE_WALLETS.seller })).toBeNull();
    expect(termsOf({ ...state.snapshot, participants: state.snapshot.participants.slice(0, 2) }, state.session)).toBeNull();
  });
});

describe("the approval summary", () => {
  const roomFor = (id: string) => deriveRoomView(caseById(id).state);

  it("shows a payer who hasn't approved their share, the full seller, the total, the network and who pays the fee", () => {
    expect(roomFor("signing as spot-2").approval).toEqual({
      share: { units: "3333333", decimals: 6 },
      seller: SAMPLE_WALLETS.seller,
      total: { units: "10000000", decimals: 6 },
      network: "Test USDC on Solana Devnet",
      fee: "The organizer pays the network fee, even if your wallet shows one.",
    });
  });

  it("tells the organizer they pay the network fee, while the payment is prepared", () => {
    expect(roomFor("preparing as spot-1").approval).toMatchObject({
      share: { units: "3333334" },
      fee: "You pay the network fee in SOL, because you're the organizer.",
    });
  });

  it("is drawn from the same terms that Approve in wallet checks the payment against", () => {
    const { state } = caseById("signing as spot-2");
    const room = deriveRoomView(state);
    const terms = termsOf(state.snapshot, state.session)!;
    expect(room.actions.primary).toEqual({ kind: "approve", terms });
    expect(room.approval).toMatchObject({ seller: terms.seller, total: { units: terms.totalUnits } });
    expect(room.approval?.share.units).toBe(terms.contributions.find((c) => c.wallet === terms.payer)?.amountUnits);
  });

  it.each(["signing as spot-1", "signing as outsider", "signing as signed-out", "ready as spot-1", "full-not-ready as spot-3"])(
    "doesn't show for %s, who keeps the plain view",
    (id) => {
      expect(roomFor(id).approval).toBeNull();
    },
  );

  it("speaks of approving, never of signing", () => {
    const words = [
      ...Object.values(REQUEST_PROBLEMS),
      WALLET_WAITING.payment_prompt.line,
      WORDS.fee_you_pay,
      WORDS.fee_organizer_pays,
      WORDS.approval_covers,
      ...CASES.flatMap((c) => (c.situation === "preparing" || c.situation === "signing" ? [deriveRoomView(c.state).status.line] : [])),
    ];
    for (const text of words) expect(text).not.toMatch(/\bsign(s|ed|ing)?\b(?! in\b)|authori[sz]e/i);
  });
});

describe("every viewer sees the same room at every step", () => {
  const base = FIXTURES.signing.snapshot;
  const { organizer, bea, cam } = SAMPLE_WALLETS;
  const attempt = (state: "preparing" | "signing" | "submitting", approved: readonly Address[]) => ({
    ...base.attempt!,
    state,
    signedWallets: approved,
  });
  const STEPS = [
    {
      room: { ...base, phase: "open", attempt: null, participants: base.participants.map((p) => ({ ...p, ready: p.slot === 0 })) },
      progress: "3 of 3 joined, 1 ready",
      spots: ["ready", "joined", "joined"],
    },
    { room: { ...base, phase: "ready", attempt: null }, progress: "3 of 3 joined, 3 ready", spots: ["ready", "ready", "ready"] },
    { room: { ...base, phase: "paying", attempt: attempt("preparing", []) }, progress: "0 of 3 approved", spots: ["ready", "ready", "ready"] },
    { room: { ...base, attempt: attempt("signing", [organizer]) }, progress: "1 of 3 approved", spots: ["approved", "ready", "ready"] },
    {
      room: { ...base, attempt: attempt("signing", [organizer, bea]) },
      progress: "2 of 3 approved",
      spots: ["approved", "approved", "ready"],
    },
    {
      room: { ...base, attempt: attempt("submitting", [organizer, bea, cam]) },
      progress: "3 of 3 approved",
      spots: ["approved", "approved", "approved"],
    },
  ] as const;
  const VIEWERS = [organizer, bea, cam, SAMPLE_WALLETS.outsider, null] as const;

  it.each(STEPS.map((step, index) => [index, step] as const))("step %i", (_, step) => {
    const views = VIEWERS.map((wallet) =>
      deriveRoomView({
        snapshot: step.room as CheckoutState["snapshot"],
        session: wallet === null ? null : { wallet, expiresAt: "2099-01-01T00:00:00.000Z" },
        source: { kind: "live", links: checkoutLinks(base.checkout.id) },
        page: NOTHING_HEARD,
      }),
    );
    for (const view of views) {
      expect(view.tab.progress).toBe(step.progress);
      expect(view.tab.spots.map((s) => s.status)).toEqual(step.spots);
      expect(view.status.label).toBe(views[0]!.status.label);
    }
  });
});

describe("B1's room fixtures, read with the parser the server uses for rooms", () => {
  const SITUATION_OF: { readonly [K in keyof typeof roomFixtures.data]: Situation } = {
    open: "open_spots",
    fullNotReady: "full_not_ready",
    ready: "ready",
    preparing: "preparing",
    signing: "signing",
    submitting: "submitting",
    unresolved: "unresolved",
    declined: "declined",
    confirmed: "confirming",
    failedBlocked: "failed",
    failedRetry: "failed",
    expired: "expired",
  };
  const viewers = (room: RoomSnapshot): readonly (Session | null)[] => [
    ...[...room.participants.map((p) => p.wallet), room.checkout.sellerWallet, SAMPLE_WALLETS.outsider].map((wallet) => ({
      wallet,
      expiresAt: "2099-01-01T00:00:00.000Z",
    })),
    null,
  ];

  it("include an attempt whose error carries a message, so the check below that no view shows it can fail", () => {
    expect(Object.values(roomFixtures.data).some((room) => room.attempt?.error?.message)).toBe(true);
  });

  it.each(Object.entries(SITUATION_OF))("%s parses and every viewer sees %s", (name, situation) => {
    const room = parseRoomSnapshot(roomFixtures.data[name as keyof typeof SITUATION_OF]);
    if (room === null) throw new Error(`B1's ${name} fixture doesn't parse, so the server would fail every read of such a room`);
    for (const session of viewers(room)) {
      const state: CheckoutState = { snapshot: room, session, source: { kind: "live", links: checkoutLinks(room.checkout.id) }, page: NOTHING_HEARD };
      const [roomView, result] = [deriveRoomView(state), deriveResultView(state)];
      expect(roomView.status.situation).toBe(situation);
      expect(result.status.situation).toBe(situation);
      if (room.attempt?.error) expect(JSON.stringify([roomView, result])).not.toContain(room.attempt.error.message);
      const organizer = session?.wallet === room.checkout.organizerWallet;
      const replaceable = room.attempt !== null && room.attempt.canRetry && (situation === "failed" || situation === "expired");
      expect(result.actions.primary?.kind === "retry", session?.wallet ?? "signed out").toBe(organizer && replaceable);
    }
  });
});

const SENTINEL = "a server message the screens never show";
const offeredKinds = (v: RoomView | ResultView) => [v.actions.primary, ...v.actions.secondary].flatMap((a) => (a === null ? [] : [a.kind]));

describe("why a failed payment stopped", () => {
  const failed = FIXTURES["failed-not-sent"].snapshot;
  const attempt = failed.attempt!;
  const other = FIXTURES["failed-on-chain"].snapshot.attempt!.id;
  const resultOf = (changes: Partial<AttemptSummary>, noted: PageFacts["noted"] = []) =>
    deriveResultView({
      snapshot: { ...failed, attempt: { ...attempt, ...changes } },
      session: null,
      source: { kind: "live", links: checkoutLinks(failed.checkout.id) },
      page: { noted, roomUnreachable: false },
    });
  const reasonOf = (changes: Partial<AttemptSummary>, noted: PageFacts["noted"] = []) => {
    const body = resultOf(changes, noted).body;
    return body.kind === "failed" ? { key: body.reason.key, from: body.reason.from } : body.kind === "stopped" ? null : "no reason slot";
  };
  const masked = { code: "INVALID_PAYMENT", message: SENTINEL } as const;
  const sent = "SAMPLEtransaction".padEnd(83, "1") + "Txn5";

  it.each<[string, Partial<AttemptSummary>, PageFacts["noted"], { key: string; from: string } | null]>([
    ["sent, whatever the room or this page says", { transactionReference: sent, error: { code: "INSUFFICIENT_SOL", message: SENTINEL } }, [{ attemptId: attempt.id, cause: "short_usdc" }], { key: "network_rejected", from: "attempt" }],
    ["never sent, the room names the cause", { error: { code: "INSUFFICIENT_SOL", message: SENTINEL } }, [{ attemptId: attempt.id, cause: "short_usdc" }], { key: "short_sol", from: "room" }],
    ["never sent, the room masks it, this page heard it for this attempt", { error: masked }, [{ attemptId: attempt.id, cause: "short_usdc" }], { key: "short_usdc", from: "this_page" }],
    ["never sent, the room masks it, this page heard it for another attempt", { error: masked }, [{ attemptId: other, cause: "short_usdc" }], { key: "not_sent", from: "attempt" }],
    ["never sent, nobody knows why", { error: null }, [], { key: "not_sent", from: "attempt" }],
    ["never sent, this page heard twice for this attempt: the first note stands", { error: masked }, [{ attemptId: attempt.id, cause: "short_sol" }, { attemptId: attempt.id, cause: "short_usdc" }], { key: "short_sol", from: "this_page" }],
    ["expired: the status line says why", { state: "expired" }, [{ attemptId: attempt.id, cause: "short_usdc" }], null],
    ["declined: the status line says why", { state: "declined", canRetry: false }, [{ attemptId: attempt.id, cause: "short_usdc" }], null],
  ])("%s", (_, changes, noted, expected) => {
    expect(reasonOf(changes, noted)).toEqual(expected);
  });

  it("states the reason in the stop table's words, what happened then what to do next", () => {
    const body = resultOf({ error: masked }, [{ attemptId: attempt.id, cause: "no_token_account" }]).body;
    expect(body).toMatchObject({ reason: { ...STOP_REASONS.no_token_account } });
  });

  it("says a network fee may have been paid only for a payment that was sent, and no fee for every other stop", () => {
    for (const [key, words] of Object.entries(STOP_REASONS)) {
      if (key === "network_rejected") expect(words.happened).toMatch(/may have paid a small network fee/);
      else expect(words.happened, key).toMatch(/no network fee was paid/);
    }
    for (const c of CASES) expect(deriveResultView(c.state).status.line, c.id).not.toMatch(/network fee/);
  });

  it("shows the organizer of the sample the cause their Start heard, and everyone else the plain reason", () => {
    const organizer = deriveResultView(caseById("failed-not-sent as spot-1").state).body;
    const payer = deriveResultView(caseById("failed-not-sent as spot-2").state).body;
    expect(organizer).toMatchObject({ reason: { key: "short_usdc", from: "this_page" } });
    expect(payer).toMatchObject({ reason: { key: "not_sent", from: "attempt" } });
  });

  it("never shows the server's message, on either screen, for any sample or viewer", () => {
    for (const c of CASES) {
      const snapshot = c.state.snapshot;
      const state = snapshot.attempt?.error ? { ...c.state, snapshot: { ...snapshot, attempt: { ...snapshot.attempt, error: { ...snapshot.attempt.error, message: SENTINEL } } } } : c.state;
      expect(JSON.stringify([deriveRoomView(state), deriveResultView(state)]), c.id).not.toContain(SENTINEL);
    }
  });
});

describe("the result screen before and after sending", () => {
  it.each([
    ["preparing as spot-1", "preparing"],
    ["signing as spot-2", "signing"],
    ["signing as signed-out", "signing"],
  ] as const)("%s says where approvals stand, with Back first", (id, stage) => {
    const view = deriveResultView(caseById(id).state);
    expect(view.body).toEqual({ kind: "approvals", stage });
    expect(view.actions.primary?.kind).toBe("back_to_checkout");
  });

  it.each(["open-spots as spot-1", "ready as spot-1"])("%s says no payment has started", (id) => {
    expect(deriveResultView(caseById(id).state).body).toEqual({ kind: "not_started" });
  });

  it.each(CASES.filter((c) => c.situation === "submitting" || c.situation === "confirming" || c.situation === "unresolved"))(
    "$id offers only Connect when signed out, and Back",
    (c) => {
      const view = deriveResultView(c.state);
      expect(offeredKinds(view)).toEqual(c.state.session === null ? ["connect_wallet", "back_to_checkout"] : ["back_to_checkout"]);
    },
  );

  it.each(CASES)("names the attempt on screen for $id", (c) => {
    const expected = c.state.snapshot.attempt?.id ?? null;
    expect(deriveRoomView(c.state).status.attempt).toBe(expected);
    expect(deriveResultView(c.state).status.attempt).toBe(expected);
  });
});

describe("page facts change words, never actions", () => {
  const variants = (state: CheckoutState): readonly PageFacts[] => {
    const id = state.snapshot.attempt?.id;
    const elsewhere = FIXTURES.signing.snapshot.attempt!.id;
    return [
      { noted: [], roomUnreachable: false },
      { noted: [], roomUnreachable: true },
      ...(id === undefined ? [] : (["short_usdc", "short_sol", "no_token_account"] as const).map((cause) => ({ noted: [{ attemptId: id, cause }], roomUnreachable: true }))),
      { noted: [{ attemptId: elsewhere, cause: "short_sol" }], roomUnreachable: false },
    ];
  };
  const choices = (state: CheckoutState) => {
    const views = [deriveRoomView(state), deriveResultView(state)];
    const wallet = state.session?.wallet ?? null;
    return views.map((v) => ({
      actions: v.actions,
      situation: v.status.situation,
      attempt: v.status.attempt,
      busy: busyShown(null, state.snapshot.attempt?.id ?? null, v.actions),
      notices: offeredKinds(v).map((kind) =>
        views.map((w) => noticeApplies(noticeOf({ text: "", followUp: null, wallet, raisedBy: [v.actions.primary, ...v.actions.secondary].find((a) => a?.kind === kind)! }), { wallet, actions: w.actions })),
      ),
    }));
  };

  it.each(CASES)("for $id on both screens", (c) => {
    const plain = choices({ ...c.state, page: NOTHING_HEARD });
    for (const page of variants(c.state)) expect(choices({ ...c.state, page })).toEqual(plain);
  });

  it("puts the connection line on both screens exactly while the room can't be read", () => {
    const { state } = caseById("unresolved as spot-2");
    for (const roomUnreachable of [false, true]) {
      const page = { noted: [], roomUnreachable };
      const expected = roomUnreachable ? WORDS.room_unreachable : null;
      expect(deriveRoomView({ ...state, page }).connection).toBe(expected);
      expect(deriveResultView({ ...state, page }).connection).toBe(expected);
    }
  });
});

describe("every room the generator builds keeps the honesty rules", () => {
  const base = FIXTURES.submitting.snapshot;
  const REFERENCE = base.attempt!.transactionReference!;
  const receiptFor = (variant: "valid" | "other_seller" | "other_reference") => ({
    transactionReference: variant === "other_reference" ? REFERENCE.replace(/Txn5$/, "Txn6") : REFERENCE,
    confirmationStatus: "finalized" as const,
    sellerWallet: variant === "other_seller" ? SAMPLE_WALLETS.outsider : base.checkout.sellerWallet,
    totalUnits: base.checkout.totalUnits,
    contributions: base.participants.map((p) => ({ slot: p.slot, wallet: p.wallet, amountUnits: p.shareUnits })),
    observedAt: "2026-11-07T14:05:00.000Z",
    explorerUrl: `javascript:${SENTINEL}`,
  });
  const ERRORS = [null, { code: "INVALID_PAYMENT", message: SENTINEL }, { code: "INSUFFICIENT_SOL", message: SENTINEL }] as const;
  const RECEIPTS = ["none", "valid", "other_seller", "other_reference"] as const;
  const SESSIONS = [SAMPLE_WALLETS.organizer, SAMPLE_WALLETS.bea, SAMPLE_WALLETS.seller, SAMPLE_WALLETS.outsider, null].map((wallet) =>
    wallet === null ? null : { wallet, expiresAt: "2099-01-01T00:00:00.000Z" },
  );
  const attemptId = base.attempt!.id;
  const PAGES: readonly PageFacts[] = [
    NOTHING_HEARD,
    { noted: [{ attemptId, cause: "short_usdc" }], roomUnreachable: false },
    { noted: [{ attemptId: FIXTURES.signing.snapshot.attempt!.id, cause: "short_sol" }], roomUnreachable: true },
  ];

  type Built = {
    readonly snapshot: RoomSnapshot;
    readonly session: Session | null;
    readonly provesPayment: boolean;
    readonly views: readonly { readonly page: PageFacts; readonly room: RoomView; readonly result: ResultView }[];
  };
  const rooms: { snapshot: RoomSnapshot; provesPayment: boolean }[] = [];
  for (const phase of PHASES) {
    rooms.push({ snapshot: { ...base, phase, attempt: null }, provesPayment: false });
    for (const state of ATTEMPT_STATES)
      for (const canRetry of [false, true])
        for (const reference of [null, REFERENCE])
          for (const error of ERRORS)
            for (const receipt of RECEIPTS) {
              const attempt = { ...base.attempt!, state, canRetry, transactionReference: reference, error, receipt: receipt === "none" ? null : receiptFor(receipt) };
              const provesPayment = phase === "paid" && state === "confirmed" && receipt === "valid" && reference !== null;
              rooms.push({ snapshot: { ...base, phase, attempt }, provesPayment });
            }
  }
  const built: Built[] = rooms.flatMap(({ snapshot, provesPayment }) =>
    SESSIONS.map((session) => ({
      snapshot,
      session,
      provesPayment,
      views: PAGES.map((page) => {
        const state: CheckoutState = { snapshot, session, source: { kind: "live", links: checkoutLinks(snapshot.checkout.id) }, page };
        return { page, room: deriveRoomView(state), result: deriveResultView(state) };
      }),
    })),
  );

  const label = (b: Built) =>
    `${b.snapshot.phase} ${b.snapshot.attempt?.state ?? "no attempt"} retry=${b.snapshot.attempt?.canRetry} ref=${b.snapshot.attempt?.transactionReference !== null} error=${b.snapshot.attempt?.error?.code} receipt=${b.snapshot.attempt?.receipt?.sellerWallet.slice(-4)}/${b.snapshot.attempt?.receipt?.transactionReference.slice(-4)} as ${b.session?.wallet.slice(-4) ?? "signed out"}`;
  const breaking = (holds: (b: Built) => boolean) => built.filter((b) => !holds(b)).slice(0, 5).map(label);

  it(`builds every combination (${built.length} rooms and viewers)`, () => {
    expect(built.length).toBe(PHASES.length * (1 + ATTEMPT_STATES.length * 2 * 2 * ERRORS.length * RECEIPTS.length) * SESSIONS.length);
    expect(built.filter((b) => b.provesPayment).length).toBeGreaterThan(0);
  });

  it("says paid, shows a receipt and links the explorer only when the room proves the payment", () => {
    const paidIn = (v: Built["views"][number]) =>
      [v.room.status.situation === "paid", v.result.status.situation === "paid", v.result.body.kind === "paid", offeredKinds(v.result).includes("view_on_explorer")];
    expect(breaking((b) => b.views.every((v) => paidIn(v).every((paid) => paid === b.provesPayment)))).toEqual([]);
  });

  it("stops polling exactly when the screen shows a receipt", () => {
    expect(breaking((b) => pollPlan(b.snapshot, b.session).stop === b.provesPayment)).toEqual([]);
  });

  it("offers nothing but Connect and Back while a payment is in progress or unresolved", () => {
    const allowed = (b: Built) => (b.session === null ? ["connect_wallet", "back_to_checkout"] : ["back_to_checkout"]).join();
    const settled = (kind: ResultView["body"]["kind"]) => kind !== "in_progress" && kind !== "unresolved";
    expect(breaking((b) => b.views.every((v) => settled(v.result.body.kind) || offeredKinds(v.result).join() === allowed(b)))).toEqual([]);
  });

  it("never shows the server's message or explorer URL", () => {
    expect(breaking((b) => b.views.every((v) => !JSON.stringify([v.room, v.result]).includes(SENTINEL)))).toEqual([]);
  });

  it("offers Try again only to the organizer of a failed or expired attempt the server calls safe to replace, in an unpaid room", () => {
    const allowed = (b: Built) => {
      const a = b.snapshot.attempt;
      const organizer = b.session?.wallet === b.snapshot.checkout.organizerWallet;
      return organizer && b.snapshot.phase !== "paid" && a !== null && a.canRetry && (a.state === "failed" || a.state === "expired");
    };
    const retries = (v: Built["views"][number]) => [...offeredKinds(v.room), ...offeredKinds(v.result)].filter((k) => k === "retry").length;
    expect(breaking((b) => b.views.every((v) => retries(v) === (allowed(b) ? 1 : 0)))).toEqual([]);
  });

  it("gives a reason exactly for a failed attempt, and mentions a paid fee only when it was sent", () => {
    const honest = (b: Built, result: ResultView) => {
      const reason = result.body.kind === "failed" ? result.body.reason : null;
      if ((reason !== null) !== (result.status.situation === "failed")) return false;
      return reason === null || /may have paid/.test(reason.happened) === ((b.snapshot.attempt?.transactionReference ?? null) !== null);
    };
    expect(breaking((b) => b.views.every((v) => honest(b, v.result)))).toEqual([]);
  });

  it("changes words only with page facts, and shows the connection line exactly while the room is unreachable", () => {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    expect(
      breaking((b) => b.views.every((v) => same(v.room.actions, b.views[0]!.room.actions) && same(v.result.actions, b.views[0]!.result.actions))),
    ).toEqual([]);
    expect(breaking((b) => b.views.every((v) => (v.room.connection !== null && v.result.connection !== null) === v.page.roomUnreachable))).toEqual([]);
  });
});

describe("every explanation is at most two sentences", () => {
  const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== "");
  const atMostTwo = (where: string, text: string) => expect(sentences(text).length, `${where}: ${text}`).toBeLessThanOrEqual(2);

  it.each(CASES)("for $id on both screens", (c) => {
    const [room, result] = views(c.state);
    atMostTwo("room line", room.status.line);
    atMostTwo("result line", result.status.line);
    const reason = result.body.kind === "failed" ? result.body.reason : null;
    if (reason) {
      expect(sentences(reason.happened), reason.happened).toHaveLength(1);
      if (reason.next) expect(sentences(reason.next), reason.next).toHaveLength(1);
    }
  });

  it("for every stop reason, request problem and word", () => {
    for (const [key, r] of Object.entries(STOP_REASONS)) {
      expect(sentences(r.happened), key).toHaveLength(1);
      if (r.next) expect(sentences(r.next), key).toHaveLength(1);
    }
    for (const [key, text] of Object.entries(REQUEST_PROBLEMS)) atMostTwo(key, text);
    for (const [key, text] of Object.entries(WORDS)) atMostTwo(key, text);
  });
});
