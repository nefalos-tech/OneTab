import { describe, expect, it } from "vitest";
import { REQUEST_PROBLEMS, WALLET_WAITING, WORDS, type ActionKind } from "./catalog";
import {
  checkoutLinks,
  deriveCreateView,
  deriveResultView,
  deriveReviewActions,
  deriveRoomView,
  busyShown,
  noticeApplies,
  ownerOf,
  termsOf,
  type ActionsView,
  type CheckoutState,
  type ClientRequestId,
  type Notice,
} from "./checkout-view";
import type { Address } from "./contracts";
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

  it("never says an approval was withdrawn, revoked or canceled", () => {
    for (const v of [room, result]) expect(v.status.line).not.toMatch(/revok|cancel|(?<!aren't )withdr/i);
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
    ["signing as spot-2", "Check the payment, then approve it in your wallet. Nothing is sent until everyone approves."],
    ["full-not-ready as spot-3", "Everyone has joined. Check your share, then tell the group you're ready, which moves no money."],
    ["ready as spot-1", "Everyone is ready. Start the payment to ask each payer to approve it."],
    ["open-spots as spot-1", "You're ready. Waiting for 1 more payer. Copy the link and send it to them."],
    ["open-spots as spot-2", "You joined. Waiting for 1 more payer."],
    ["full-not-ready as outsider", "This checkout is full. Waiting for 1 payer to get ready."],
    ["declined-on-hold as spot-1", "A payer declined. Approvals already given aren't withdrawn, so this payment stays on hold until it's safely closed."],
    ["unresolved as spot-1", "We can't confirm the result yet. We keep checking the same transaction, and no new payment will start."],
  ])("%s", (id, line) => {
    expect(deriveRoomView(caseById(id).state).status.line).toBe(line);
  });

  it.each<[string, string, boolean, string]>([
    ["the organizer", "open-spots as spot-1", false, "Waiting for 1 more payer. Copy the link and send it to them."],
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
    ["declined-on-hold", "result"],
    ["unresolved", "result"],
    ["paid", "result"],
  ] as const)("is the %s room's %s", (name, screen) => {
    expect(ownerOf(FIXTURES[name].snapshot)).toBe(screen);
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

describe("a notice applies while its wallet is signed in and its action is offered", () => {
  const offering = (primary: ActionsView["primary"], secondary: ActionsView["secondary"] = []): ActionsView => ({
    primary,
    secondary,
    sample: null,
  });
  const join = offering({ kind: "join", checkoutId: FIXTURES["open-spots"].snapshot.checkout.id });
  const notice: Notice = { text: "Wait a few seconds, then try again.", followUp: null, wallet: SAMPLE_WALLETS.bea, raisedBy: join.primary! };

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
    const next = { ...first, attempt: { ...first.attempt!, id: FIXTURES["declined-on-hold"].snapshot.attempt!.id } };
    const approve = (room: typeof first) => offering({ kind: "approve", terms: termsOf(room, bea)! });
    const rejected: Notice = {
      text: REQUEST_PROBLEMS.rejected,
      followUp: { kind: "decline", checkoutId: first.checkout.id, attemptId: first.attempt!.id },
      wallet: bea.wallet,
      raisedBy: approve(first).primary!,
    };

    it("lasts while Approve is offered for the attempt the payer rejected", () => {
      expect(noticeApplies(rejected, { wallet: bea.wallet, actions: approve(first) })).toBe(true);
    });

    it("ends, with its Decline, once the screen shows another attempt", () => {
      expect(next.attempt.id).not.toBe(first.attempt!.id);
      expect(noticeApplies(rejected, { wallet: bea.wallet, actions: approve(next) })).toBe(false);
    });
  });
});

describe("approvals that arrive out of spot order", () => {
  const room = FIXTURES.signing.snapshot;
  const withApprovals = (...wallets: Address[]) => ({ ...room, attempt: { ...room.attempt!, signedWallets: wallets } });
  const viewOf = (snapshot: typeof room, wallet: Address) =>
    deriveRoomView({ snapshot, session: { wallet, expiresAt: "2099-01-01T00:00:00.000Z" }, source: { kind: "live", links: checkoutLinks(room.checkout.id) } });

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
  const other = FIXTURES["declined-on-hold"].snapshot.attempt!.id;

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
    "declined-retry as spot-2",
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
      }),
    );
    for (const view of views) {
      expect(view.tab.progress).toBe(step.progress);
      expect(view.tab.spots.map((s) => s.status)).toEqual(step.spots);
      expect(view.status.label).toBe(views[0]!.status.label);
    }
  });
});
