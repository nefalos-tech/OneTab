import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { PaymentApproval, PaymentSigner, Result, SignatureBase64, SignFailure } from "@/lib/wallet/environment";
import { checkoutApi, type FetchLike } from "./api";
import { ACTIONS, REQUEST_PROBLEMS, WORDS, type ActionKind, type ProblemWithWords, type Screen } from "./catalog";
import {
  NOTHING_HEARD,
  checkoutLinks,
  deriveResultView,
  deriveRoomView,
  noticeApplies,
  noticeOf,
  ownerOf,
  termsOf,
  type Action,
  type CheckoutState,
  type Said,
} from "./checkout-view";
import type { AttemptId, CheckoutId, ClientRequestId, RoomSnapshot, Session } from "./contracts";
import { SAMPLE_WALLETS } from "./fixture-data";
import { FIXTURES, sampleCheckoutState } from "./fixtures";
import {
  browserPollEnv,
  isLiveAction,
  liveActions,
  moveFor,
  pageMoves,
  pollPlan,
  untracked,
  type Arrival,
  type Intent,
  type LiveAction,
  type LiveKind,
  type Outcome,
  type PollEnv,
  type Scope,
  type Track,
  type TrackerCallbacks,
} from "./live-actions";
import { keyedPayment } from "./keyed-payment-fixture";
import { paymentCheck, type CheckedPayment, type MessageCheck } from "./payment-check";
import { wirePayloadFor } from "./payment-fixture";

type Call = { readonly method: string; readonly path: string; readonly body: unknown };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errorBody = (code: string) => ({ error: { code, message: "Something the browser never shows." } });
const noAnswer = () => Promise.reject(new TypeError("fetch failed"));

function server(...responses: (() => Response | Promise<Response>)[]): { readonly fetch: FetchLike; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (path, init) => {
      calls.push({ method: String(init.method), path, body: init.body ? JSON.parse(String(init.body)) : null });
      const next = responses.shift();
      if (!next) throw new Error(`Unexpected request ${init.method} ${path}`);
      return next();
    },
  };
}

const NO_REQUESTS: FetchLike = (path) => Promise.reject(new Error(`Unexpected request ${path}`));
const UNHEARD: TrackerCallbacks = { show: () => {}, reached: () => {}, acting: () => {} };
const tracker = (show: (snapshot: RoomSnapshot) => void, reached: (answered: boolean) => void = () => {}): Track =>
  liveActions(checkoutApi(NO_REQUESTS)).tracker({ ...UNHEARD, show, reached });

function shownBy(): { readonly track: Track; readonly shown: RoomSnapshot[] } {
  const shown: RoomSnapshot[] = [];
  return { shown, track: tracker((snapshot) => shown.push(snapshot)) };
}

const NO_WALLET: PaymentSigner = {
  keptOrNewApproval: () => {
    throw new Error("A wallet prompt opened");
  },
  forget: () => {},
  isCurrent: () => true,
};
const scope = (track: Track = untracked, signer: PaymentSigner = NO_WALLET): Scope => ({ track, signer });
const stoppedAgain = (room: RoomSnapshot): Outcome => ({ kind: "notice", text: WORDS.retry_stopped, followUp: null, about: room.attempt!.id });
const said = (problem: ProblemWithWords, followUp: Action | null = null): Outcome => ({
  kind: "notice",
  text: REQUEST_PROBLEMS[problem],
  followUp,
  about: null,
});
const requests = (calls: readonly Call[]) => calls.map((c) => [c.method, c.path]);

const OPEN = FIXTURES["open-spots"].snapshot;
const JOINED: RoomSnapshot = {
  ...OPEN,
  participants: [...OPEN.participants, { slot: 2, wallet: SAMPLE_WALLETS.cam, shareUnits: OPEN.participants[1]!.shareUnits, ready: false }],
};
const FULL = FIXTURES["full-not-ready"].snapshot;
const ID = OPEN.checkout.id;
const REQUEST_ID = "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b" as ClientRequestId;
const CREATE: Extract<LiveAction, { kind: "create_checkout" }> = {
  kind: "create_checkout",
  request: {
    title: OPEN.checkout.title,
    sellerWallet: OPEN.checkout.sellerWallet,
    totalUnits: OPEN.checkout.totalUnits,
    payerCount: OPEN.checkout.payerCount,
  },
  clientRequestId: REQUEST_ID,
};
const JOIN: Extract<LiveAction, { kind: "join" }> = { kind: "join", checkoutId: ID };

const PAYER = { wallet: SAMPLE_WALLETS.bea, expiresAt: "2099-01-01T00:00:00.000Z" };
const SIGNING = FIXTURES.signing.snapshot;
const ROOM = SIGNING.checkout.id;
const ATTEMPT = SIGNING.attempt!.id;
const TERMS = termsOf(SIGNING, PAYER)!;
const WIRE = wirePayloadFor(SIGNING);
const APPROVED: RoomSnapshot = { ...SIGNING, attempt: { ...SIGNING.attempt!, signedWallets: [SAMPLE_WALLETS.organizer, PAYER.wallet] } };
const PREPARING: RoomSnapshot = { ...FIXTURES.preparing.snapshot, checkout: SIGNING.checkout };
const DECLINED: RoomSnapshot = {
  ...FIXTURES.declined.snapshot,
  checkout: SIGNING.checkout,
  attempt: { ...FIXTURES.declined.snapshot.attempt!, id: ATTEMPT },
};
const READY = FIXTURES.ready.snapshot;
const DECLINED_ELSEWHERE = FIXTURES.declined.snapshot.attempt!.id;
const SIGNATURE = "c2lnbmVkIGJ5IGJlYQ==" as SignatureBase64;
const APPROVE: Extract<LiveAction, { kind: "approve" }> = { kind: "approve", terms: TERMS };
const DECLINE: Extract<LiveAction, { kind: "decline" }> = { kind: "decline", checkoutId: ROOM, attemptId: ATTEMPT };
const FAILED = FIXTURES["failed-not-sent"].snapshot;
const FAILED_ROOM = FAILED.checkout.id;
const ORGANIZER_SEES = deriveResultView(sampleCheckoutState({ kind: "sample", fixture: "failed-not-sent", persona: { kind: "member", slot: 0 } }));
const liveRoom = (snapshot: RoomSnapshot, session: Session | null): CheckoutState => ({
  snapshot,
  session,
  source: { kind: "live", links: checkoutLinks(snapshot.checkout.id) },
  page: NOTHING_HEARD,
});
const RETRY = ((offered) => {
  if (offered?.kind !== "retry") throw new Error("The organizer of failed-not-sent isn't offered Try again");
  return offered;
})(ORGANIZER_SEES.actions.primary);
const EXAMPLES: { readonly [K in LiveKind]: Extract<LiveAction, { kind: K }> } = {
  create_checkout: CREATE,
  join: JOIN,
  mark_ready: { kind: "mark_ready", checkoutId: ID },
  mark_not_ready: { kind: "mark_not_ready", checkoutId: ID },
  start_payment: { kind: "start_payment", checkoutId: ID },
  approve: APPROVE,
  decline: DECLINE,
  retry: RETRY,
};

function wallet(answer: Result<SignatureBase64, SignFailure>, current = () => true) {
  const prompts: CheckedPayment[] = [];
  const signer: PaymentSigner = {
    keptOrNewApproval: async (payment) => {
      prompts.push(payment);
      return answer.ok ? { ok: true, value: { messageHash: payment.messageHash, signature: answer.value } } : answer;
    },
    forget: () => {},
    isCurrent: () => current(),
  };
  return { prompts, signer };
}

function rememberingWallet() {
  const prompts: CheckedPayment[] = [];
  const approvals = new Map<string, PaymentApproval>();
  const signer: PaymentSigner = {
    keptOrNewApproval: async (payment) => {
      const kept = approvals.get(payment.messageHash);
      if (kept) return { ok: true, value: kept };
      prompts.push(payment);
      const approval = { messageHash: payment.messageHash, signature: SIGNATURE };
      approvals.set(payment.messageHash, approval);
      return { ok: true, value: approval };
    },
    forget: (approval) => {
      if (approvals.get(approval.messageHash)?.signature === approval.signature) approvals.delete(approval.messageHash);
    },
    isCurrent: () => true,
  };
  return { prompts, signer };
}

const KEYED = await keyedPayment();
const validated: MessageCheck = async () => ({ ok: true, value: KEYED.validated });
const bytesMatch = paymentCheck(validated, async () => "match");
const approver = (fetch: FetchLike) => liveActions(checkoutApi(fetch), bytesMatch);
const upload = (approval: PaymentApproval) => ({ messageHash: approval.messageHash, signatureBase64: approval.signature });

describe("live actions", () => {
  it("create opens the new room's link, with no query", async () => {
    const { fetch } = server(() => json(201, { data: OPEN }));
    expect(await liveActions(checkoutApi(fetch)).run(CREATE, scope())).toEqual({ kind: "open", href: `/checkouts/${ID}` });
  });

  it("create with no answer says trying again is safe, and trying again sends the same request ID", async () => {
    const { fetch, calls } = server(noAnswer, () => json(200, { data: OPEN }));
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(CREATE, scope())).toEqual(said("unavailable"));
    expect(await live.run(CREATE, scope())).toEqual({ kind: "open", href: `/checkouts/${ID}` });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", "/api/checkouts", { ...CREATE.request, clientRequestId: REQUEST_ID }],
      ["POST", "/api/checkouts", { ...CREATE.request, clientRequestId: REQUEST_ID }],
    ]);
  });

  it("join puts the room it answers with on screen and has nothing to say", async () => {
    const { fetch, calls } = server(() => json(200, { data: JOINED }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(JOIN, scope(track))).toEqual({ kind: "done" });
    expect(shown).toEqual([JOINED]);
    expect(requests(calls)).toEqual([["POST", `/api/checkouts/${ID}/join`]]);
  });

  it("join to a room that filled first reads the room again and shows it full", async () => {
    const fullRoom = { ...FULL, checkout: { ...FULL.checkout, id: ID } };
    const { fetch, calls } = server(() => json(409, errorBody("ROOM_FULL")), () => json(200, { data: fullRoom }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(JOIN, scope(track))).toEqual({ kind: "done" });
    expect(shown).toEqual([fullRoom]);
    expect(requests(calls)).toEqual([
      ["POST", `/api/checkouts/${ID}/join`],
      ["GET", `/api/checkouts/${ID}`],
    ]);
  });

  it("join to a full room says someone took the last spot when the room can't be read again", async () => {
    const { fetch } = server(() => json(409, errorBody("ROOM_FULL")), () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(JOIN, scope(track))).toEqual(said("room_full"));
    expect(shown).toEqual([]);
  });

  it("an ended sign-in on create or join is signed_out, with no notice and nothing shown", async () => {
    const { fetch } = server(() => json(401, errorBody("UNAUTHENTICATED")), () => json(401, errorBody("UNAUTHENTICATED")));
    const { track, shown } = shownBy();
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(CREATE, scope(track))).toEqual({ kind: "signed_out" });
    expect(await live.run(JOIN, scope(track))).toEqual({ kind: "signed_out" });
    expect(shown).toEqual([]);
  });

  it("a refused or rate-limited join says so and changes nothing", async () => {
    const { fetch } = server(() => json(403, errorBody("ORIGIN_MISMATCH")), () => json(429, errorBody("RATE_LIMITED")));
    const { track, shown } = shownBy();
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(JOIN, scope(track))).toEqual(said("refused"));
    expect(await live.run(JOIN, scope(track))).toEqual(said("rate_limited"));
    expect(shown).toEqual([]);
  });

  it("is live exactly for the actions with a busy label, and each sends its requests, with Start and Try again reading the room after an answer they can't use", async () => {
    expectTypeOf<LiveKind>().toEqualTypeOf<
      "create_checkout" | "join" | "mark_ready" | "mark_not_ready" | "start_payment" | "approve" | "decline" | "retry"
    >();
    for (const kind of Object.keys(ACTIONS) as ActionKind[]) {
      expect(isLiveAction({ kind } as Action), kind).toBe(kind in EXAMPLES);
    }
    const sends: { readonly [K in LiveKind]: number } = {
      create_checkout: 1,
      join: 1,
      mark_ready: 1,
      mark_not_ready: 1,
      start_payment: 2,
      approve: 1,
      decline: 1,
      retry: 2,
    };
    for (const action of Object.values(EXAMPLES)) {
      const { fetch, calls } = server(() => json(200, { data: OPEN }));
      await liveActions(checkoutApi(fetch)).run(action, scope());
      expect(calls, action.kind).toHaveLength(sends[action.kind]);
    }
  });
});

describe("readiness", () => {
  it.each([
    ["I'm ready", true],
    ["Not ready yet", false],
  ] as const)("%s sends the choice and shows the room the server answers", async (_, ready) => {
    const { fetch, calls } = server(() => json(200, { data: READY }));
    const { track, shown } = shownBy();
    const action: LiveAction = ready ? { kind: "mark_ready", checkoutId: READY.checkout.id } : { kind: "mark_not_ready", checkoutId: READY.checkout.id };
    expect(await liveActions(checkoutApi(fetch)).run(action, scope(track))).toEqual({ kind: "done" });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([["PUT", `/api/checkouts/${READY.checkout.id}/readiness`, { ready }]]);
    expect(shown).toEqual([READY]);
  });

  it("after the room moved on, reads it again and says the screen shows the latest", async () => {
    const { fetch, calls } = server(() => json(409, errorBody("ROOM_NOT_READY")), () => json(200, { data: PREPARING }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run({ kind: "mark_not_ready", checkoutId: ROOM }, scope(track))).toEqual(said("room_changed"));
    expect(requests(calls)).toEqual([
      ["PUT", `/api/checkouts/${ROOM}/readiness`],
      ["GET", `/api/checkouts/${ROOM}`],
    ]);
    expect(shown).toEqual([PREPARING]);
  });
});

describe("start payment", () => {
  const START: LiveAction = { kind: "start_payment", checkoutId: ROOM };

  it("starts the attempt, then shows the room read after it, never the attempt itself", async () => {
    const { fetch, calls } = server(() => json(201, { data: PREPARING.attempt }), () => json(200, { data: PREPARING }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(START, scope(track))).toEqual({ kind: "done" });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", `/api/checkouts/${ROOM}/attempts`, { retryOfAttemptId: null }],
      ["GET", `/api/checkouts/${ROOM}`, null],
    ]);
    expect(shown).toEqual([PREPARING]);
  });

  it("a poll sent while the start is in flight never shows, even when it answers last", async () => {
    let answerStart!: () => void;
    let answerPoll!: () => void;
    const { fetch } = server(
      () => new Promise((resolve) => (answerStart = () => resolve(json(201, { data: PREPARING.attempt })))),
      () => new Promise((resolve) => (answerPoll = () => resolve(json(200, { data: { ...PREPARING, attempt: null, phase: "ready" } })))),
      () => json(200, { data: PREPARING }),
    );
    const { track, shown } = shownBy();
    const live = liveActions(checkoutApi(fetch));
    const started = live.run(START, scope(track));
    const poll = track("read", () => checkoutApi(fetch).readRoom(ROOM));
    answerStart();
    expect(await started).toEqual({ kind: "done" });
    answerPoll();
    await poll;
    expect(shown).toEqual([PREPARING]);
  });

  it("a poll sent just before the start never shows, even when it answers while the start is in flight", async () => {
    let answerPoll!: () => void;
    let answerStart!: () => void;
    const { fetch } = server(
      () => new Promise((resolve) => (answerPoll = () => resolve(json(200, { data: { ...PREPARING, attempt: null, phase: "ready" } })))),
      () => new Promise((resolve) => (answerStart = () => resolve(json(201, { data: PREPARING.attempt })))),
      () => json(200, { data: PREPARING }),
    );
    const { track, shown } = shownBy();
    const poll = track("read", () => checkoutApi(fetch).readRoom(ROOM));
    const started = liveActions(checkoutApi(fetch)).run(START, scope(track));
    answerPoll();
    await poll;
    expect(shown).toEqual([]);
    answerStart();
    expect(await started).toEqual({ kind: "done" });
    expect(shown).toEqual([PREPARING]);
  });

  it("a start that lands when the room can't be read is done, and the next poll shows it", async () => {
    const { fetch } = server(() => json(201, { data: PREPARING.attempt }), () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(START, scope(track))).toEqual({ kind: "done" });
    expect(shown).toEqual([]);
  });

  it("after the room moved on, says the screen shows the latest only when the room read again", async () => {
    const { fetch } = server(() => json(409, errorBody("ROOM_NOT_READY")), noAnswer);
    const { track, shown } = shownBy();
    const outcome = await liveActions(checkoutApi(fetch)).run(START, scope(track));
    expect(outcome).toEqual(said("room_changed_unread"));
    expect(outcome.kind === "notice" && outcome.text).not.toMatch(/shows the latest/);
    expect(shown).toEqual([]);
  });

  it.each([
    ["INSUFFICIENT_USDC", "short_usdc"],
    ["INSUFFICIENT_SOL", "short_sol"],
    ["TOKEN_ACCOUNT_MISSING", "no_token_account"],
  ] as const)("a payment refused with %s reads the room again and says why", async (code, cause) => {
    const { fetch, calls } = server(() => json(422, errorBody(code)), () => json(200, { data: SIGNING }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(START, scope(track))).toEqual(said(cause));
    expect(requests(calls).at(-1)).toEqual(["GET", `/api/checkouts/${ROOM}`]);
    expect(shown).toEqual([SIGNING]);
  });
});

describe("try again", () => {
  const replaced = FAILED.attempt!.id;
  const preparing: RoomSnapshot = { ...FAILED, phase: "paying", attempt: { ...FIXTURES.preparing.snapshot.attempt!, id: FIXTURES.signing.snapshot.attempt!.id } };
  const signing: RoomSnapshot = { ...FAILED, phase: "paying", attempt: { ...FIXTURES.signing.snapshot.attempt!, signedWallets: [] } };
  const startPath = `/api/checkouts/${FAILED_ROOM}/attempts`;

  it("names the attempt it replaces, then shows the room read after it, and is done", async () => {
    const { fetch, calls } = server(() => json(201, { data: preparing.attempt }), () => json(200, { data: preparing }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(RETRY, scope(track))).toEqual({ kind: "done" });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", startPath, { retryOfAttemptId: replaced }],
      ["GET", `/api/checkouts/${FAILED_ROOM}`, null],
    ]);
    expect(shown).toEqual([preparing]);
  });

  it("a poll sent while it is in flight never shows, even when it answers last", async () => {
    let answerRetry!: () => void;
    let answerPoll!: () => void;
    const { fetch } = server(
      () => new Promise((resolve) => (answerRetry = () => resolve(json(201, { data: preparing.attempt })))),
      () => new Promise((resolve) => (answerPoll = () => resolve(json(200, { data: FAILED })))),
      () => json(200, { data: preparing }),
    );
    const { track, shown } = shownBy();
    const retried = liveActions(checkoutApi(fetch)).run(RETRY, scope(track));
    const poll = track("read", () => checkoutApi(fetch).readRoom(FAILED_ROOM));
    answerRetry();
    expect(await retried).toEqual({ kind: "done" });
    answerPoll();
    await poll;
    expect(shown).toEqual([preparing]);
  });

  it("for an attempt already replaced, reads the room again and says it shows the latest", async () => {
    const { fetch, calls } = server(() => json(409, errorBody("RETRY_BLOCKED")), () => json(200, { data: preparing }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(RETRY, scope(track))).toEqual(said("room_changed"));
    expect(requests(calls)).toEqual([
      ["POST", startPath],
      ["GET", `/api/checkouts/${FAILED_ROOM}`],
    ]);
    expect(shown).toEqual([preparing]);
  });

  it("with no answer and no room, says it couldn't confirm what happened, and trying again sends the same request", async () => {
    const { fetch, calls } = server(noAnswer, noAnswer, () => json(201, { data: preparing.attempt }), () => json(200, { data: preparing }));
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(RETRY, scope())).toEqual(said("start_unread"));
    expect(await live.run(RETRY, scope())).toEqual({ kind: "done" });
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ retryOfAttemptId: replaced }, { retryOfAttemptId: replaced }]);
  });

  it("leads every payer to Approve the new attempt, with no approval carried over", async () => {
    const { fetch } = server(() => json(201, { data: preparing.attempt }), () => json(200, { data: preparing }));
    const { track, shown } = shownBy();
    await liveActions(checkoutApi(fetch)).run(RETRY, scope(track));
    expect(shown.map((room) => room.attempt?.id)).toEqual([signing.attempt!.id]);
    for (const wallet of [SAMPLE_WALLETS.organizer, SAMPLE_WALLETS.bea, SAMPLE_WALLETS.cam]) {
      const view = deriveRoomView(liveRoom(signing, { wallet, expiresAt: PAYER.expiresAt }));
      expect(view.actions.primary, wallet).toMatchObject({ kind: "approve", terms: { attemptId: signing.attempt!.id } });
      expect(view.tab.progress).toBe("0 of 3 approved");
    }
  });
});

describe("a refused start is explained on the failed attempt it left", () => {
  const START: LiveAction = { kind: "start_payment", checkoutId: FAILED_ROOM };
  const leftBehind = (id: AttemptId): RoomSnapshot => ({ ...FAILED, attempt: { ...FAILED.attempt!, id } });
  const replacement = leftBehind(FIXTURES.signing.snapshot.attempt!.id);
  const noted = (snapshot: RoomSnapshot, cause: string) => [{ attemptId: snapshot.attempt!.id, cause }];
  const held = () => {
    let answer!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => (answer = resolve));
    return { response: () => response, answer: (r: Response) => answer(r) };
  };

  function noting(...responses: (() => Response | Promise<Response>)[]) {
    const { fetch, calls } = server(...responses);
    const live = liveActions(checkoutApi(fetch));
    const notedWhenShown: unknown[] = [];
    const track = live.tracker({ ...UNHEARD, show: () => notedWhenShown.push(live.noted.current()) });
    const poll = () => track("read", () => checkoutApi(fetch).readRoom(FAILED_ROOM));
    return { live, calls, track, poll, notedWhenShown };
  }

  it("after Start, the note names the failed attempt before the room shows it, and nothing more is said", async () => {
    const { live, calls, track, notedWhenShown } = noting(() => json(422, errorBody("INSUFFICIENT_SOL")), () => json(200, { data: FAILED }));
    expect(await live.run(START, scope(track))).toEqual({ kind: "done" });
    expect(requests(calls)).toEqual([
      ["POST", `/api/checkouts/${FAILED_ROOM}/attempts`],
      ["GET", `/api/checkouts/${FAILED_ROOM}`],
    ]);
    expect(notedWhenShown).toEqual([noted(FAILED, "short_sol")]);
    expect(live.noted.current()).toEqual(noted(FAILED, "short_sol"));
  });

  it.each<[string, Response]>([
    ["answers", json(200, { data: FAILED })],
    ["fails", json(503, errorBody("CONFIGURATION_UNAVAILABLE"))],
  ])("a poll sent while Start's own read is in flight never shows, and the cause is noted when the room first shows, when that read %s", async (_, last) => {
    const read = held();
    const { live, calls, track, poll, notedWhenShown } = noting(
      () => json(422, errorBody("INSUFFICIENT_USDC")),
      read.response,
      () => json(200, { data: FAILED }),
      () => json(200, { data: FAILED }),
    );
    const started = live.run(START, scope(track));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await poll();
    expect(notedWhenShown).toEqual([]);
    read.answer(last);
    expect(await started).toEqual(last.ok ? { kind: "done" } : said("short_usdc"));
    await poll();
    expect(notedWhenShown[0]).toEqual(noted(FAILED, "short_usdc"));
  });

  it("Try again refused again while its own read fails leaves its notice on the attempt still on screen, and a poll sent meanwhile never shows", async () => {
    const read = held();
    const { live, calls, track, poll, notedWhenShown } = noting(
      () => json(422, errorBody("INSUFFICIENT_USDC")),
      read.response,
      () => json(200, { data: replacement }),
      () => json(200, { data: replacement }),
    );
    const retried = live.run(RETRY, scope(track));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await poll();
    read.answer(json(503, errorBody("CONFIGURATION_UNAVAILABLE")));
    const outcome = await retried;
    expect(outcome).toEqual(said("short_usdc"));
    expect(notedWhenShown).toEqual([]);
    if (outcome.kind !== "notice") throw new Error("Try again said nothing");
    const stored = noticeOf(outcome, { wallet: SAMPLE_WALLETS.organizer, raisedBy: RETRY });
    expect(noticeApplies(stored, { wallet: SAMPLE_WALLETS.organizer, actions: ORGANIZER_SEES.actions })).toBe(true);
    await poll();
    expect(notedWhenShown).toEqual([noted(replacement, "short_usdc")]);
  });

  it("when Start's own read fails and nothing has shown, says why and notes the cause on the next room shown", async () => {
    const { live, track, poll, notedWhenShown } = noting(
      () => json(422, errorBody("TOKEN_ACCOUNT_MISSING")),
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => json(200, { data: FAILED }),
    );
    expect(await live.run(START, scope(track))).toEqual(said("no_token_account"));
    expect(live.noted.current()).toEqual([]);
    await poll();
    expect(notedWhenShown).toEqual([noted(FAILED, "no_token_account")]);
  });

  it("a waiting cause outlasts rooms with no attempt or with the attempt being replaced, and ends at any other attempt", async () => {
    const ready: RoomSnapshot = { ...FAILED, phase: "ready", attempt: null };
    const signing: RoomSnapshot = { ...SIGNING, checkout: FAILED.checkout };
    const { live, track, poll } = noting(
      () => json(422, errorBody("INSUFFICIENT_SOL")),
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => json(200, { data: ready }),
      () => json(200, { data: FAILED }),
      () => json(200, { data: replacement }),
      () => json(422, errorBody("INSUFFICIENT_USDC")),
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => json(200, { data: signing }),
      () => json(200, { data: leftBehind(FIXTURES.declined.snapshot.attempt!.id) }),
    );
    await live.run(RETRY, scope(track));
    await poll();
    await poll();
    expect(live.noted.current()).toEqual([]);
    await poll();
    expect(live.noted.current()).toEqual(noted(replacement, "short_sol"));
    await live.run(START, scope(track));
    await poll();
    await poll();
    expect(live.noted.current()).toEqual(noted(replacement, "short_sol"));
  });

  it("after Try again, the note names the new failed attempt, never the replaced one, and a notice about that attempt says so", async () => {
    const { live, track, notedWhenShown } = noting(() => json(422, errorBody("TOKEN_ACCOUNT_MISSING")), () => json(200, { data: replacement }));
    expect(await live.run(RETRY, scope(track))).toEqual(stoppedAgain(replacement));
    expect(notedWhenShown).toEqual([noted(replacement, "no_token_account")]);
  });

  it.each<[string, () => Response | Promise<Response>]>([
    ["the room can't be read", () => json(503, errorBody("CONFIGURATION_UNAVAILABLE"))],
    ["the room still shows the attempt being replaced", () => json(200, { data: FAILED })],
    ["the room shows a sent attempt", () => json(200, { data: { ...FIXTURES["failed-on-chain"].snapshot, checkout: FAILED.checkout } })],
    ["the room shows an attempt still collecting approvals", () => json(200, { data: { ...SIGNING, checkout: FAILED.checkout } })],
  ])("when %s after Try again, notes nothing and says why in a notice", async (_, room) => {
    const { live, track } = noting(() => json(422, errorBody("INSUFFICIENT_USDC")), room);
    expect(await live.run(RETRY, scope(track))).toEqual(said("short_usdc"));
    expect(live.noted.current()).toEqual([]);
  });

  it.each<[string, string, number, ProblemWithWords]>([
    ["400 INVALID_PAYMENT", "INVALID_PAYMENT", 400, "refused"],
    ["503 RPC_UNAVAILABLE", "RPC_UNAVAILABLE", 503, "unavailable"],
  ])("a start answered %s reads the room again and lets a failed attempt there explain itself", async (_, code, status, problem) => {
    const failedRoom = noting(() => json(status, errorBody(code)), () => json(200, { data: FAILED }));
    expect(await failedRoom.live.run(START, scope(failedRoom.track))).toEqual({ kind: "done" });
    expect(requests(failedRoom.calls).at(-1)).toEqual(["GET", `/api/checkouts/${FAILED_ROOM}`]);
    expect(failedRoom.notedWhenShown).toEqual([[]]);

    const retried = noting(() => json(status, errorBody(code)), () => json(200, { data: replacement }));
    expect(await retried.live.run(RETRY, scope(retried.track))).toEqual(stoppedAgain(replacement));
    expect(retried.live.noted.current()).toEqual([]);

    const unchanged = noting(() => json(status, errorBody(code)), () => json(200, { data: FAILED }));
    expect(await unchanged.live.run(RETRY, scope(unchanged.track))).toEqual(said(problem));
    const unread = noting(() => json(status, errorBody(code)), noAnswer);
    expect(await unread.live.run(START, scope(unread.track))).toEqual(said("start_unread"));
  });

  it("keeps the first note for an attempt, and tells subscribers only about new ones", async () => {
    const { live, track } = noting(
      () => json(422, errorBody("INSUFFICIENT_SOL")),
      () => json(200, { data: FAILED }),
      () => json(422, errorBody("INSUFFICIENT_USDC")),
      () => json(200, { data: FAILED }),
    );
    let heard = 0;
    const unsubscribe = live.noted.subscribe(() => heard++);
    const before = live.noted.current();
    expect(live.noted.current()).toBe(before);
    await live.run(START, scope(track));
    const first = live.noted.current();
    expect(first).not.toBe(before);
    await live.run(START, scope(track));
    expect(live.noted.current()).toBe(first);
    expect(first).toEqual(noted(FAILED, "short_sol"));
    expect(heard).toBe(1);
    unsubscribe();
  });
});

describe("what Start and Try again say, from how the start was answered and the room read inside it", () => {
  const START: LiveAction = { kind: "start_payment", checkoutId: FAILED_ROOM };
  const ready: RoomSnapshot = { ...FAILED, phase: "ready", attempt: null };
  const preparing: RoomSnapshot = { ...FAILED, phase: "paying", attempt: { ...FIXTURES.preparing.snapshot.attempt!, id: FIXTURES.signing.snapshot.attempt!.id } };
  const replacement: RoomSnapshot = { ...FAILED, attempt: { ...FAILED.attempt!, id: FIXTURES.expired.snapshot.attempt!.id } };
  const started = () => json(201, { data: preparing.attempt });
  const unread = () => json(503, errorBody("CONFIGURATION_UNAVAILABLE"));
  const refusals = [
    ["a funding refusal", () => json(422, errorBody("INSUFFICIENT_USDC")), "short_usdc"],
    ["a 400", () => json(400, errorBody("INVALID_PAYMENT")), "refused"],
    ["a 503", () => json(503, errorBody("RPC_UNAVAILABLE")), "unavailable"],
  ] as const;
  type Row = readonly [
    label: string,
    answer: () => Response,
    rooms: { readonly start: RoomSnapshot | null; readonly retry: RoomSnapshot | null },
    start: Outcome,
    retry: Outcome,
  ];
  const DONE: Outcome = { kind: "done" };
  const leftBehind = { start: FAILED, retry: replacement };

  it.each<Row>([
    ["an answered start whose room shows a new attempt that already stopped, as a replay can", started, leftBehind, DONE, stoppedAgain(replacement)],
    ["an answered start whose room shows anything else", started, { start: preparing, retry: preparing }, DONE, DONE],
    ...refusals.map(([what, answer]): Row => [`${what} whose room shows a new attempt that stopped`, answer, leftBehind, DONE, stoppedAgain(replacement)]),
    ...refusals.map(([what, answer, problem]): Row => [`${what} whose room shows no new attempt`, answer, { start: ready, retry: FAILED }, said(problem), said(problem)]),
    ["an answered start whose room can't be read", started, { start: null, retry: null }, DONE, DONE],
    ["a funding refusal whose room can't be read", refusals[0][1], { start: null, retry: null }, said("short_usdc"), said("short_usdc")],
    ...refusals.slice(1).map(([what, answer]): Row => [`${what} whose room can't be read`, answer, { start: null, retry: null }, said("start_unread"), said("start_unread")]),
  ])("%s", async (_, answer, rooms, start, retry) => {
    for (const [action, room, outcome] of [
      [START, rooms.start, start],
      [RETRY, rooms.retry, retry],
    ] as const) {
      const { fetch, calls } = server(answer, room === null ? unread : () => json(200, { data: room }));
      const live = liveActions(checkoutApi(fetch));
      const shown: [RoomSnapshot, Intent][] = [];
      const track = live.tracker({ ...UNHEARD, show: (snapshot, intent) => shown.push([snapshot, intent]) });
      expect(await live.run(action, scope(track)), action.kind).toEqual(outcome);
      expect(requests(calls), action.kind).toEqual([
        ["POST", `/api/checkouts/${FAILED_ROOM}/attempts`],
        ["GET", `/api/checkouts/${FAILED_ROOM}`],
      ]);
      expect(shown, action.kind).toEqual(room === null ? [] : [[room, "write"]]);
    }
  });

  it("the notice built from a Try again that stopped again applies while Try again is for the new attempt, and not for the replaced one", async () => {
    const { fetch } = server(started, () => json(200, { data: replacement }));
    const outcome = await liveActions(checkoutApi(fetch)).run(RETRY, scope());
    if (outcome.kind !== "notice") throw new Error("Try again said nothing");
    const notice = noticeOf(outcome, { wallet: SAMPLE_WALLETS.organizer, raisedBy: RETRY });
    const offeredFor = (room: RoomSnapshot) => deriveResultView(liveRoom(room, { wallet: SAMPLE_WALLETS.organizer, expiresAt: PAYER.expiresAt })).actions;
    expect(noticeApplies(notice, { wallet: SAMPLE_WALLETS.organizer, actions: offeredFor(replacement) })).toBe(true);
    expect(noticeApplies(notice, { wallet: SAMPLE_WALLETS.organizer, actions: offeredFor(FAILED) })).toBe(false);
  });

  it("a notice outcome always says which attempt it is about, or none, so dropping that fails to type-check", () => {
    expectTypeOf<{ readonly kind: "notice"; readonly text: string; readonly followUp: null }>().not.toExtend<Outcome>();
    expectTypeOf<{ readonly text: string; readonly followUp: null }>().not.toExtend<Said>();
    expectTypeOf<{ readonly text: string; readonly followUp: null; readonly about: null }>().toExtend<Said>();
  });

  it("a Start before any poll answers on a page reached inside the app moves the organizer to the result its room shows", async () => {
    const { fetch } = server(() => json(422, errorBody("INSUFFICIENT_SOL")), () => json(200, { data: FAILED }));
    const live = liveActions(checkoutApi(fetch));
    const shown: { owner: Screen; intent: Intent }[] = [];
    const track = live.tracker({ ...UNHEARD, show: (snapshot, intent) => shown.push({ owner: ownerOf(snapshot), intent }) });
    await live.run(START, scope(track));
    expect(shown.map((room) => moveFor(room, "room", null))).toEqual(["result"]);
  });
});

describe("a funding refusal explains only its own checkout, and only until the next Start or Try again press", () => {
  const OTHER = "5d0c3f1e-8a2b-4c6d-9e7f-1a2b3c4d5e6f" as CheckoutId;
  const otherFailed: RoomSnapshot = {
    ...FAILED,
    checkout: { ...FAILED.checkout, id: OTHER },
    attempt: { ...FAILED.attempt!, id: FIXTURES.expired.snapshot.attempt!.id },
  };
  const startHere: LiveAction = { kind: "start_payment", checkoutId: FAILED_ROOM };
  const reasonFor = (live: ReturnType<typeof liveActions>, room: RoomSnapshot) => {
    const view = deriveResultView({ ...liveRoom(room, null), page: { noted: live.noted.current(), roomUnreachable: false } });
    return view.body.kind === "failed" ? view.body.reason.from : null;
  };

  it("never explains another checkout's failed attempt that a poll shows, and ends there", async () => {
    const { fetch } = server(
      () => json(422, errorBody("INSUFFICIENT_USDC")),
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => json(200, { data: otherFailed }),
      () => json(200, { data: FAILED }),
    );
    const live = liveActions(checkoutApi(fetch));
    const here = live.tracker(UNHEARD);
    const there = live.tracker(UNHEARD);
    expect(await live.run(startHere, scope(here))).toEqual(said("short_usdc"));
    await there("read", () => checkoutApi(fetch).readRoom(OTHER));
    expect(live.noted.current()).toEqual([]);
    expect(reasonFor(live, otherFailed)).toBe("attempt");
    await here("read", () => checkoutApi(fetch).readRoom(FAILED_ROOM));
    expect(live.noted.current()).toEqual([]);
  });

  it("never explains another checkout's attempt left by a Start that Payments answered 503", async () => {
    const { fetch } = server(
      () => json(422, errorBody("INSUFFICIENT_USDC")),
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => json(503, errorBody("RPC_UNAVAILABLE")),
      () => json(200, { data: otherFailed }),
    );
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(startHere, scope(live.tracker(UNHEARD)))).toEqual(said("short_usdc"));
    const startThere: LiveAction = { kind: "start_payment", checkoutId: OTHER };
    expect(await live.run(startThere, scope(live.tracker(UNHEARD)))).toEqual({ kind: "done" });
    expect(live.noted.current()).toEqual([]);
    expect(reasonFor(live, otherFailed)).toBe("attempt");
  });

  it("a later press clears a cause still waiting, so its 400 never picks it up", async () => {
    const { fetch } = server(
      () => json(422, errorBody("INSUFFICIENT_USDC")),
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => json(400, errorBody("INVALID_PAYMENT")),
      () => json(200, { data: FAILED }),
    );
    const live = liveActions(checkoutApi(fetch));
    const track = live.tracker(UNHEARD);
    expect(await live.run(startHere, scope(track))).toEqual(said("short_usdc"));
    expect(await live.run(startHere, scope(track))).toEqual({ kind: "done" });
    expect(live.noted.current()).toEqual([]);
    expect(reasonFor(live, FAILED)).toBe("attempt");
  });
});

describe("approve", () => {
  it("reads the payload, then the room it checks against, opens one prompt with Payments' bytes, uploads only the signature, and shows the room", async () => {
    const { fetch, calls } = server(
      () => json(200, { data: WIRE }),
      () => json(200, { data: SIGNING }),
      () => json(200, { data: APPROVED.attempt }),
      () => json(200, { data: APPROVED }),
    );
    const { track, shown } = shownBy();
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await approver(fetch).run(APPROVE, scope(track, signer))).toEqual({ kind: "done" });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ account: PAYER.wallet, attemptId: ATTEMPT, messageHash: WIRE.messageHash });
    expect(prompts[0]!.transaction).toEqual(Uint8Array.from(KEYED.validated.message.transactionBytes));
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["GET", `/api/attempts/${ATTEMPT}/signing-payload`, null],
      ["GET", `/api/checkouts/${ROOM}`, null],
      ["POST", `/api/attempts/${ATTEMPT}/signatures`, { messageHash: WIRE.messageHash, signatureBase64: SIGNATURE }],
      ["GET", `/api/checkouts/${ROOM}`, null],
    ]);
    expect(shown, "the room the check read shows first").toEqual([SIGNING, APPROVED]);
  });

  it("a room that can't be read before the prompt opens nothing and says the payment couldn't be checked", async () => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }), () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")));
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said("check_unavailable"));
    expect(prompts).toHaveLength(0);
    expect(requests(calls)).toEqual([
      ["GET", `/api/attempts/${ATTEMPT}/signing-payload`],
      ["GET", `/api/checkouts/${ROOM}`],
    ]);
  });

  it.each<[string, RoomSnapshot]>([
    ["has moved on", DECLINED],
    ["already has this payer's approval", APPROVED],
  ])("a room that %s opens no prompt, shows that room and says it moved on", async (_, fresh) => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }), () => json(200, { data: fresh }));
    const { track, shown } = shownBy();
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await approver(fetch).run(APPROVE, scope(track, signer))).toEqual(said("room_changed"));
    expect(prompts).toHaveLength(0);
    expect(shown).toEqual([fresh]);
    expect(calls).toHaveLength(2);
  });

  it("a poll while the wallet's prompt is open still updates the room, and the upload's room shows after it", async () => {
    const camApproved: RoomSnapshot = { ...SIGNING, attempt: { ...SIGNING.attempt!, signedWallets: [SAMPLE_WALLETS.organizer, SAMPLE_WALLETS.cam] } };
    const allApproved: RoomSnapshot = { ...SIGNING, attempt: { ...camApproved.attempt!, signedWallets: [...camApproved.attempt!.signedWallets, PAYER.wallet] } };
    const { fetch } = server(
      () => json(200, { data: WIRE }),
      () => json(200, { data: SIGNING }),
      () => json(200, { data: camApproved }),
      () => json(200, { data: allApproved.attempt }),
      () => json(200, { data: allApproved }),
    );
    const { track, shown } = shownBy();
    let answer!: (approval: PaymentApproval) => void;
    let approving!: Promise<Outcome>;
    const prompted = new Promise<void>((opened) => {
      const signer: PaymentSigner = {
        keptOrNewApproval: () => {
          opened();
          return new Promise((resolve) => (answer = (approval) => resolve({ ok: true, value: approval })));
        },
        forget: () => {},
        isCurrent: () => true,
      };
      approving = approver(fetch).run(APPROVE, scope(track, signer));
    });
    await prompted;
    await track("read", () => checkoutApi(fetch).readRoom(ROOM));
    expect(shown, "the poll's room shows while the prompt is open").toEqual([SIGNING, camApproved]);
    answer({ messageHash: WIRE.messageHash as PaymentApproval["messageHash"], signature: SIGNATURE });
    expect(await approving).toEqual({ kind: "done" });
    expect(shown).toEqual([SIGNING, camApproved, allApproved]);
  });

  it("a payload that differs from the screen opens no prompt and sends nothing more", async () => {
    const tampered = { ...WIRE, payment: { ...(WIRE.payment as object), sellerWallet: SAMPLE_WALLETS.outsider } };
    const { fetch, calls } = server(() => json(200, { data: tampered }), () => json(200, { data: SIGNING }));
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said("mismatch"));
    expect(prompts).toHaveLength(0);
    expect(requests(calls)).toEqual([
      ["GET", `/api/attempts/${ATTEMPT}/signing-payload`],
      ["GET", `/api/checkouts/${ROOM}`],
    ]);
  });

  const payment = WIRE.payment as Record<string, unknown> & { readonly contributions: readonly Record<string, unknown>[] };
  it.each<[string, unknown]>([
    ["names another attempt", { ...WIRE, attemptId: DECLINED_ELSEWHERE }],
    ["is for another network", { ...WIRE, payment: { ...payment, network: "mainnet-beta" } }],
    ["lists the payers out of slot order", { ...WIRE, payment: { ...payment, contributions: [...payment.contributions].reverse() } }],
    ["adds a fourth payer", { ...WIRE, payment: { ...payment, contributions: [...payment.contributions, { ...payment.contributions[2], slot: 3 }] } }],
  ])("a payload that %s opens no prompt and says it doesn't match", async (_, data) => {
    const { fetch, calls } = server(() => json(200, { data }), () => json(200, { data: SIGNING }));
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said("mismatch"));
    expect(prompts).toHaveLength(0);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("the live check opens one prompt for a real payment and none for a byte the screen can't show", async () => {
    const terms = termsOf(KEYED.room, { wallet: KEYED.payers[1]!.address, expiresAt: PAYER.expiresAt })!;
    const approve: LiveAction = { kind: "approve", terms };
    const lastByte = KEYED.payload.transaction.length - 1;
    const tampered = {
      ...KEYED.wirePayload,
      transactionBase64: btoa(String.fromCharCode(...KEYED.payload.transaction.map((b, i) => (i === lastByte ? b ^ 1 : b)))),
    };
    const { fetch } = server(
      () => json(200, { data: tampered }),
      () => json(200, { data: KEYED.wireRoom }),
      () => json(200, { data: KEYED.wirePayload }),
      () => json(200, { data: KEYED.wireRoom }),
    );
    const { prompts, signer } = wallet({ ok: false, failure: "rejected" });
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(approve, scope(untracked, signer))).toEqual(said("mismatch"));
    expect(prompts).toHaveLength(0);
    expect(await live.run(approve, scope(untracked, signer))).toEqual(said("rejected", { kind: "decline", checkoutId: terms.checkoutId, attemptId: terms.attemptId }));
    expect(prompts.map((p) => p.transaction)).toEqual([KEYED.payload.transaction]);
  });

  it("an approval that P3's check can't confirm uploads nothing, says so with no Decline, and isn't reused", async () => {
    const { fetch, calls } = server(
      () => json(200, { data: WIRE }),
      () => json(200, { data: SIGNING }),
      () => json(200, { data: WIRE }),
      () => json(200, { data: SIGNING }),
    );
    const { prompts, signer } = rememberingWallet();
    const live = liveActions(checkoutApi(fetch), paymentCheck(validated, async () => "unsupported"));
    expect(await live.run(APPROVE, scope(untracked, signer))).toEqual(said("unchecked"));
    expect(await live.run(APPROVE, scope(untracked, signer))).toEqual(said("unchecked"));
    expect(prompts, "each Approve asked the wallet").toHaveLength(2);
    expect(calls.filter((c) => c.path.endsWith("/signatures"))).toEqual([]);
  });

  it("an answer that arrives after the sign-in changed uploads nothing and says nothing", async () => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }), () => json(200, { data: SIGNING }));
    const { prompts, signer } = wallet({ ok: false, failure: "stale" });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual({ kind: "done" });
    expect(prompts).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("a refusal in the wallet sends nothing and offers Decline for this attempt", async () => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }), () => json(200, { data: SIGNING }));
    const { signer } = wallet({ ok: false, failure: "rejected" });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said("rejected", DECLINE));
    expect(calls).toHaveLength(2);
  });

  it.each(["busy", "failed"] as const)("a %s wallet sends nothing and says so, with no Decline", async (failure) => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }), () => json(200, { data: SIGNING }));
    const { signer } = wallet({ ok: false, failure });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said(failure));
    expect(calls).toHaveLength(2);
  });

  it("after an upload with no answer, Approve again resends the same approval without a second prompt", async () => {
    const { fetch, calls } = server(
      () => json(200, { data: WIRE }),
      () => json(200, { data: SIGNING }),
      noAnswer,
      () => json(200, { data: WIRE }),
      () => json(200, { data: SIGNING }),
      () => json(200, { data: APPROVED.attempt }),
      () => json(200, { data: APPROVED }),
    );
    const { prompts, signer } = rememberingWallet();
    const live = approver(fetch);
    expect(await live.run(APPROVE, scope(untracked, signer))).toEqual(said("unavailable"));
    expect(await live.run(APPROVE, scope(untracked, signer))).toEqual({ kind: "done" });
    expect(prompts).toHaveLength(1);
    const uploads = calls.filter((c) => c.path.endsWith("/signatures")).map((c) => c.body);
    expect(uploads).toEqual([upload({ messageHash: prompts[0]!.messageHash, signature: SIGNATURE }), uploads[0]]);
  });

  it("when approvals have closed, reads the room again and says the screen shows the latest", async () => {
    const { fetch, calls } = server(() => json(409, errorBody("ATTEMPT_NOT_SIGNABLE")), () => json(200, { data: DECLINED }));
    const { track, shown } = shownBy();
    expect(await approver(fetch).run(APPROVE, scope(track))).toEqual(said("room_changed"));
    expect(requests(calls)).toEqual([
      ["GET", `/api/attempts/${ATTEMPT}/signing-payload`],
      ["GET", `/api/checkouts/${ROOM}`],
    ]);
    expect(shown).toEqual([DECLINED]);
  });

  it.each(["MESSAGE_MISMATCH", "INVALID_SIGNATURE", "INVALID_PAYMENT"])(
    "an approval the server refuses with %s is dropped, so Approve again opens the wallet afresh",
    async (code) => {
      const { fetch, calls } = server(
        () => json(200, { data: WIRE }),
        () => json(200, { data: SIGNING }),
        () => json(400, errorBody(code)),
        () => json(200, { data: WIRE }),
        () => json(200, { data: SIGNING }),
        () => json(200, { data: APPROVED.attempt }),
        () => json(200, { data: APPROVED }),
      );
      const { prompts, signer } = rememberingWallet();
      const live = approver(fetch);
      const refused = await live.run(APPROVE, scope(untracked, signer));
      expect(refused).toEqual(said("approval_refused"));
      expect(refused.kind === "notice" && refused.text).not.toMatch(/trying again is safe|reload/i);
      expect(await live.run(APPROVE, scope(untracked, signer))).toEqual({ kind: "done" });
      expect(prompts, "the second Approve asked the wallet again").toHaveLength(2);
      expect(calls.filter((c) => c.path.endsWith("/signatures"))).toHaveLength(2);
    },
  );

  it("an approval whose sign-in ended before the upload is stale: nothing is uploaded or said", async () => {
    let signedIn = true;
    const { fetch, calls } = server(() => json(200, { data: WIRE }), () => json(200, { data: SIGNING }));
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE }, () => signedIn);
    const switchesDuringTheReturnCheck = paymentCheck(
      validated,
      async () => {
        signedIn = false;
        return "match";
      },
    );
    const live = liveActions(checkoutApi(fetch), switchesDuringTheReturnCheck);
    expect(await live.run(APPROVE, scope(untracked, signer))).toEqual({ kind: "done" });
    expect(prompts).toHaveLength(1);
    expect(requests(calls)).toEqual([
      ["GET", `/api/attempts/${ATTEMPT}/signing-payload`],
      ["GET", `/api/checkouts/${ROOM}`],
    ]);
  });

  it("an ended sign-in at any step is signed_out", async () => {
    for (const responses of [
      [() => json(401, errorBody("UNAUTHENTICATED"))],
      [() => json(200, { data: WIRE }), () => json(200, { data: SIGNING }), () => json(401, errorBody("UNAUTHENTICATED"))],
    ]) {
      const { fetch } = server(...responses);
      const { signer } = wallet({ ok: true, value: SIGNATURE });
      expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual({ kind: "signed_out" });
    }
  });
});

describe("decline", () => {
  it("declines the attempt and shows the room read after it", async () => {
    const { fetch, calls } = server(() => json(200, { data: DECLINED.attempt }), () => json(200, { data: DECLINED }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(DECLINE, scope(track))).toEqual({ kind: "done" });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", `/api/attempts/${ATTEMPT}/decline`, null],
      ["GET", `/api/checkouts/${ROOM}`, null],
    ]);
    expect(shown).toEqual([DECLINED]);
  });

  it("with no answer, says trying again is safe and stays offered", async () => {
    const { fetch } = server(noAnswer);
    expect(await liveActions(checkoutApi(fetch)).run(DECLINE, scope())).toEqual(said("unavailable", DECLINE));
  });

  it("a decline that lands when the room can't be read says it went through, and offers nothing more", async () => {
    const { fetch, calls } = server(() => json(200, { data: DECLINED.attempt }), noAnswer);
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(DECLINE, scope(track))).toEqual({ kind: "noted", text: WORDS.declined });
    expect(requests(calls)).toEqual([
      ["POST", `/api/attempts/${ATTEMPT}/decline`],
      ["GET", `/api/checkouts/${ROOM}`],
    ]);
    expect(shown).toEqual([]);
  });
});

describe("where a shown room takes the viewer", () => {
  it.each<[string, Screen, Intent, Screen, Screen | null, Screen | null]>([
    ["Start's own room, failed, moves the organizer to the result", "result", "write", "room", null, "result"],
    ["Try again's own room, preparing, moves the organizer back to the room", "room", "write", "result", "result", "room"],
    ["a write's room the screen already owns stays put", "room", "write", "room", "room", null],
    ["a polled failure moves a viewer who stood on the room", "result", "read", "room", "room", "result"],
    ["a polled replacement moves a viewer who stood on the result", "room", "read", "result", "result", "room"],
    ["a page opened after the room moved on stays put", "result", "read", "room", "result", null],
    ["a client navigation's first read stays put, so Back never bounces", "result", "read", "room", null, null],
    ["a polled room the screen already owns stays put", "result", "read", "result", "room", null],
  ])("%s", (_, owner, intent, here, before, to) => {
    expect(moveFor({ owner, intent }, here, before)).toBe(to);
  });
});

describe("where a page's move baseline starts, and where its first polled room takes the viewer", () => {
  type Row = readonly [label: string, arrival: Arrival, here: Screen, loaded: Screen, acted: boolean, shown: Screen, to: Screen | null];
  it.each<Row>([
    ["a reload of the result moves the viewer once a read shows the replacement", "loaded", "result", "result", false, "room", "room"],
    ["a page loaded on the screen that doesn't own its room stays put", "loaded", "result", "room", false, "room", null],
    ["a payer moved to the result goes back to the room when its first read already shows a new attempt", "moved", "result", "result", false, "room", "room"],
    ["a payer moved to the room goes on to the result when its first read already shows the new attempt failed", "moved", "room", "room", false, "result", "result"],
    ["a page a move opened stays when its first read shows the room it moved for", "moved", "result", "room", false, "result", null],
    ["Back or Forward stays put when its first read shows the other screen's room, so Back never bounces", "navigated", "result", "result", false, "room", null],
    ["a link stays put when its first read shows the other screen's room", "navigated", "room", "room", false, "result", null],
    ["after Try again on a page reached inside the app, the first read that shows the room moves the organizer", "navigated", "result", "result", true, "room", "room"],
    ["after Start on a page reached inside the app, the first read that shows the failure moves the organizer", "navigated", "room", "room", true, "result", "result"],
    ["an action on a loaded page keeps the room it loaded with", "loaded", "result", "room", true, "room", null],
    ["an action on a page a move opened keeps the screen it moved to", "moved", "room", "result", true, "result", "result"],
  ])("%s", (_, arrival, here, loaded, acted, owner, to) => {
    const moves = pageMoves(arrival, here, loaded);
    if (acted) moves.acting();
    expect(moves.shown({ owner, intent: "read" })).toBe(to);
  });

  it("after the first room shows, an action keeps the baseline that room set", () => {
    const moves = pageMoves("navigated", "result", "result");
    expect(moves.shown({ owner: "room", intent: "read" })).toBe(null);
    moves.acting();
    expect(moves.shown({ owner: "room", intent: "read" })).toBe(null);
    expect(moves.shown({ owner: "result", intent: "read" })).toBe(null);
    expect(moves.shown({ owner: "room", intent: "read" })).toBe("room");
  });

  it("the tracker says this page acted when its write starts, before it answers, and never for a read", async () => {
    const heard: string[] = [];
    const track = liveActions(checkoutApi(NO_REQUESTS)).tracker({ ...UNHEARD, show: () => heard.push("shown"), acting: () => heard.push("acting") });
    await track("read", async () => ({ ok: true, value: OPEN }));
    let answer!: (room: Result<RoomSnapshot, never>) => void;
    const writing = track("write", () => new Promise((resolve) => (answer = resolve)));
    expect(heard).toEqual(["shown", "acting"]);
    answer({ ok: true, value: JOINED });
    await writing;
    expect(heard).toEqual(["shown", "acting", "shown"]);
  });

  it("a Try again whose own read fails, on a result page reached inside the app, moves the organizer when the next poll shows the room", async () => {
    const preparing: RoomSnapshot = { ...FAILED, phase: "paying", attempt: { ...FIXTURES.preparing.snapshot.attempt!, id: FIXTURES.signing.snapshot.attempt!.id } };
    const { fetch } = server(
      () => json(201, { data: preparing.attempt }),
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => json(200, { data: preparing }),
    );
    const live = liveActions(checkoutApi(fetch));
    const moves = pageMoves("navigated", "result", ownerOf(FAILED));
    const taken: (Screen | null)[] = [];
    const track = live.tracker({
      ...UNHEARD,
      show: (snapshot, intent) => taken.push(moves.shown({ owner: ownerOf(snapshot), intent })),
      acting: moves.acting,
    });
    expect(await live.run(RETRY, scope(track))).toEqual({ kind: "done" });
    await track("read", () => checkoutApi(fetch).readRoom(FAILED_ROOM));
    expect(taken).toEqual(["room"]);
  });
});

describe("which page a move opened, given the paths the app commits after the move", () => {
  const { room, result } = checkoutLinks(ROOM);
  type Row = readonly [label: string, committed: readonly string[], moved: boolean];
  it.each<Row>([
    ["the destination rendering with its own path is the move's arrival", [], true],
    ["the destination rendering after its loading skeleton is the move's arrival", [result], true],
    ["a link elsewhere while the destination loads ends the move, so Back to it later is not the arrival", [result, "/"], false],
    ["a link elsewhere before the destination's path commits ends the move", ["/"], false],
    ["Back while the destination loads ends the move, so Forward to it later is not the arrival", [result, room], false],
    ["Back to the destination after a link elsewhere is not the arrival", [result, "/", result], false],
  ])("%s", (_, committed, moved) => {
    const { arrivals } = liveActions(checkoutApi(NO_REQUESTS));
    arrivals.moveTo(result);
    for (const pathname of committed) arrivals.seen(pathname);
    expect(arrivals.movedTo(result)).toBe(moved);
  });

  it("the page a move opened is its arrival once, and a later page with the same address is not", () => {
    const { arrivals } = liveActions(checkoutApi(NO_REQUESTS));
    arrivals.moveTo(result);
    arrivals.seen(result);
    expect(arrivals.movedTo(result)).toBe(true);
    arrivals.landed();
    expect(arrivals.movedTo(result)).toBe(false);
  });

  it("a move after one that ended is its own arrival", () => {
    const { arrivals } = liveActions(checkoutApi(NO_REQUESTS));
    arrivals.moveTo(result);
    arrivals.seen("/");
    arrivals.moveTo(room);
    arrivals.seen(room);
    expect([arrivals.movedTo(result), arrivals.movedTo(room)]).toEqual([false, true]);
  });
});

describe("what each poll sends", () => {
  const as = (wallet: string): Session => ({ wallet: wallet as Session["wallet"], expiresAt: PAYER.expiresAt });
  const PAID = FIXTURES.paid.snapshot;
  const NOT_YET_PAID: RoomSnapshot = { ...PAID, phase: "paying" };
  const TAMPERED: RoomSnapshot = { ...PAID, attempt: { ...PAID.attempt!, receipt: { ...PAID.attempt!.receipt!, sellerWallet: SAMPLE_WALLETS.outsider } } };
  const attemptOf = (name: keyof typeof FIXTURES) => FIXTURES[name].snapshot.attempt!.id;

  it.each<[string, RoomSnapshot, Session | null, ReturnType<typeof pollPlan>]>([
    ["an open room, signed out", OPEN, null, { stop: false, refresh: null }],
    ["approvals open, to a payer", SIGNING, PAYER, { stop: false, refresh: ATTEMPT }],
    ["approvals open, to a payer who approved", SIGNING, as(SAMPLE_WALLETS.organizer), { stop: false, refresh: ATTEMPT }],
    ["approvals open, to someone with the link", SIGNING, as(SAMPLE_WALLETS.outsider), { stop: false, refresh: null }],
    ["approvals open, to the seller", SIGNING, as(SAMPLE_WALLETS.seller), { stop: false, refresh: null }],
    ["approvals open, signed out", SIGNING, null, { stop: false, refresh: null }],
    ["a payment being prepared, to a payer", FIXTURES.preparing.snapshot, PAYER, { stop: false, refresh: attemptOf("preparing") }],
    ["a payment being sent, to a payer", FIXTURES.submitting.snapshot, PAYER, { stop: false, refresh: attemptOf("submitting") }],
    ["an unresolved payment, to a payer", FIXTURES.unresolved.snapshot, PAYER, { stop: false, refresh: attemptOf("unresolved") }],
    ["a decline on hold, to a payer", FIXTURES.declined.snapshot, PAYER, { stop: false, refresh: attemptOf("declined") }],
    ["an expiry that is safe to retry, to a payer", FIXTURES.expired.snapshot, PAYER, { stop: false, refresh: null }],
    ["a failure before sending that is safe to retry, to a payer", FIXTURES["failed-not-sent"].snapshot, PAYER, { stop: false, refresh: null }],
    ["a failure on the network that is safe to retry, to a payer", FIXTURES["failed-on-chain"].snapshot, PAYER, { stop: false, refresh: null }],
    ["a paid checkout whose room lost the attempt, to a payer", FIXTURES["paid-no-receipt"].snapshot, PAYER, { stop: false, refresh: null }],
    ["a confirmed payment in a room not yet paid, to a payer", NOT_YET_PAID, PAYER, { stop: false, refresh: null }],
    ["a paid checkout whose receipt names another seller, to a payer", TAMPERED, PAYER, { stop: false, refresh: null }],
    ["a paid checkout, to a payer", FIXTURES.paid.snapshot, as(SAMPLE_WALLETS.organizer), { stop: true, refresh: null }],
  ])("%s", (_, room, session, plan) => {
    expect(pollPlan(room, session)).toEqual(plan);
  });
});

describe("the poller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function polling(respond: (method: string, path: string) => Response | Promise<Response>, first: { snapshot: RoomSnapshot; session: Session | null }) {
    vi.useFakeTimers();
    let visible = true;
    let wake = () => {};
    const env: PollEnv = {
      wait: browserPollEnv.wait,
      visible: () => visible,
      onResume: (w) => {
        wake = w;
        return () => (wake = () => {});
      },
    };
    const calls: string[] = [];
    const fetch: FetchLike = async (path, init) => {
      calls.push(`${init.method} ${path}`);
      return respond(String(init.method), path);
    };
    const shown: RoomSnapshot[] = [];
    const reports: boolean[] = [];
    const track = tracker((snapshot) => shown.push(snapshot), (answered) => reports.push(answered));
    const ended: Session[] = [];
    const room = { now: first };
    const stop = liveActions(checkoutApi(fetch), undefined, env).watch({
      id: first.snapshot.checkout.id,
      track,
      now: () => room.now,
      signedOut: (session) => ended.push(session),
    });
    return {
      calls,
      shown,
      reports,
      ended,
      stop,
      room,
      hide: () => (visible = false),
      show: () => {
        visible = true;
        wake();
      },
      resume: () => wake(),
      after: (ms: number) => vi.advanceTimersByTimeAsync(ms),
    };
  }

  const read = (room: RoomSnapshot) => `GET /api/checkouts/${room.checkout.id}`;
  const refresh = `POST /api/attempts/${ATTEMPT}/refresh`;
  const answers = (room: RoomSnapshot) => (method: string) => json(200, { data: method === "GET" ? room : room.attempt });

  it("reads at once, then every two seconds, and shows each room", async () => {
    const p = polling(answers(OPEN), { snapshot: OPEN, session: null });
    await p.after(0);
    expect(p.calls).toEqual([read(OPEN)]);
    await p.after(1999);
    expect(p.calls).toHaveLength(1);
    await p.after(1);
    expect(p.calls).toEqual([read(OPEN), read(OPEN)]);
    expect(p.shown).toEqual([OPEN, OPEN]);
  });

  it("asks the server to advance the attempt with each read for its payer, and only reads for anyone else", async () => {
    const p = polling(answers(SIGNING), { snapshot: SIGNING, session: null });
    await p.after(0);
    p.room.now = { snapshot: SIGNING, session: PAYER };
    await p.after(2000);
    expect(p.calls).toEqual([read(SIGNING), read(SIGNING), refresh]);
  });

  it("waits for a slow poll before sending another, however long it takes", async () => {
    let answer!: () => void;
    const p = polling(() => new Promise((resolve) => (answer = () => resolve(json(200, { data: OPEN })))), { snapshot: OPEN, session: null });
    await p.after(60_000);
    p.resume();
    await p.after(0);
    expect(p.calls).toHaveLength(1);
    answer();
    await p.after(2000);
    expect(p.calls).toHaveLength(2);
  });

  it("after each failure waits twice as long, up to 30 seconds, and two seconds again after a success", async () => {
    let failures = 5;
    const p = polling(() => (failures-- > 0 ? json(503, errorBody("CONFIGURATION_UNAVAILABLE")) : json(200, { data: OPEN })), {
      snapshot: OPEN,
      session: null,
    });
    await p.after(0);
    for (const wait of [4000, 8000, 16_000, 30_000, 30_000, 2000]) {
      const before = p.calls.length;
      await p.after(wait - 1);
      expect(p.calls, `no poll before ${wait} ms`).toHaveLength(before);
      await p.after(1);
      expect(p.calls, `a poll at ${wait} ms`).toHaveLength(before + 1);
    }
  });

  it("through an outage, keeps advancing the same attempt and says whether the room answered", async () => {
    let down = true;
    const p = polling(
      (method) => (method === "POST" ? json(200, { data: SIGNING.attempt }) : down ? json(503, errorBody("CONFIGURATION_UNAVAILABLE")) : json(200, { data: SIGNING })),
      { snapshot: SIGNING, session: PAYER },
    );
    await p.after(0);
    expect(p.reports).toEqual([false]);
    await p.after(4000);
    expect(p.reports).toEqual([false, false]);
    down = false;
    p.resume();
    await p.after(0);
    expect(p.reports).toEqual([false, false, true]);
    expect(p.calls).toEqual([read(SIGNING), refresh, read(SIGNING), refresh, read(SIGNING), refresh]);
    expect(p.shown).toEqual([SIGNING]);
  });

  it("backs off when the server rate-limits a refresh", async () => {
    const p = polling((method) => (method === "POST" ? json(429, errorBody("RATE_LIMITED")) : json(200, { data: SIGNING })), {
      snapshot: SIGNING,
      session: PAYER,
    });
    await p.after(2000);
    expect(p.calls).toEqual([read(SIGNING), refresh]);
    await p.after(2000);
    expect(p.calls).toEqual([read(SIGNING), refresh, read(SIGNING), refresh]);
  });

  it("sends nothing while the page is hidden, and polls at once when it shows", async () => {
    const p = polling(answers(OPEN), { snapshot: OPEN, session: null });
    await p.after(0);
    p.hide();
    await p.after(60_000);
    expect(p.calls).toHaveLength(1);
    p.show();
    await p.after(0);
    expect(p.calls).toHaveLength(2);
    await p.after(2000);
    expect(p.calls).toHaveLength(3);
  });

  it("hands over a session the refresh says has ended", async () => {
    const p = polling((method) => (method === "POST" ? json(401, errorBody("UNAUTHENTICATED")) : json(200, { data: SIGNING })), {
      snapshot: SIGNING,
      session: PAYER,
    });
    await p.after(0);
    expect(p.ended).toEqual([PAYER]);
  });

  it("stops once the checkout on screen is paid", async () => {
    const sending = FIXTURES.submitting.snapshot;
    const p = polling(answers(sending), { snapshot: sending, session: null });
    await p.after(0);
    p.room.now = { snapshot: FIXTURES.paid.snapshot, session: null };
    await p.after(60_000);
    p.resume();
    await p.after(0);
    expect(p.calls).toEqual([read(sending)]);
  });

  it("reads the room at once for a payer, without waiting for the attempt's refresh", async () => {
    const p = polling((method) => (method === "POST" ? new Promise<Response>(() => {}) : json(200, { data: SIGNING })), {
      snapshot: SIGNING,
      session: PAYER,
    });
    await p.after(0);
    expect(p.calls).toContain(read(SIGNING));
    expect(p.shown).toEqual([SIGNING]);
  });

  it("sends nothing after it is stopped, even when the attempt's refresh answers later", async () => {
    let answer!: () => void;
    const p = polling(
      (method) => (method === "POST" ? new Promise((resolve) => (answer = () => resolve(json(200, { data: SIGNING.attempt })))) : json(200, { data: SIGNING })),
      { snapshot: SIGNING, session: PAYER },
    );
    await p.after(0);
    const sentBeforeStop = [...p.calls];
    p.stop();
    answer();
    await p.after(60_000);
    p.resume();
    await p.after(0);
    expect(p.calls).toEqual(sentBeforeStop);
  });

  it("keeps one refresh in flight per page when the page remounts its watch", async () => {
    vi.useFakeTimers();
    const env: PollEnv = { wait: browserPollEnv.wait, visible: () => true, onResume: () => () => {} };
    const answers: (() => void)[] = [];
    let inFlight = 0;
    let most = 0;
    const calls: string[] = [];
    const fetch: FetchLike = async (path, init) => {
      calls.push(`${init.method} ${path}`);
      if (init.method !== "POST") return json(200, { data: SIGNING });
      most = Math.max(most, ++inFlight);
      await new Promise<void>((resolve) => answers.push(resolve));
      inFlight -= 1;
      return json(200, { data: SIGNING.attempt });
    };
    const live = liveActions(checkoutApi(fetch), undefined, env);
    const room = { id: ROOM, now: () => ({ snapshot: SIGNING, session: PAYER }), signedOut: () => {} };
    const stopRoomPage = live.watch({ ...room, track: shownBy().track });
    await vi.advanceTimersByTimeAsync(0);
    stopRoomPage();
    const stopResultPage = live.watch({ ...room, track: shownBy().track });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c === refresh)).toHaveLength(1);
    answers.shift()!();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.filter((c) => c === refresh), "the next poll refreshes once the first refresh answered").toHaveLength(2);
    expect(most).toBe(1);
    stopResultPage();
  });

  it("sends nothing after it is stopped, even when a poll was still in flight", async () => {
    const p = polling(answers(OPEN), { snapshot: OPEN, session: null });
    await p.after(0);
    p.stop();
    p.resume();
    await p.after(60_000);
    expect(p.calls).toHaveLength(1);

    let answer!: () => void;
    const slow = polling(() => new Promise((resolve) => (answer = () => resolve(json(200, { data: OPEN })))), { snapshot: OPEN, session: null });
    await slow.after(0);
    slow.stop();
    answer();
    await slow.after(60_000);
    expect(slow.calls).toHaveLength(1);
  });
});

type Request = { readonly intent: "read" | "write"; readonly ok: boolean };
type Step = { readonly kind: "send" | "answer"; readonly index: number };

function interleavings(count: number): Step[][] {
  const orders: Step[][] = [];
  const walk = (sent: number, answered: ReadonlySet<number>, steps: Step[]) => {
    if (steps.length === 2 * count) {
      orders.push(steps);
      return;
    }
    if (sent < count) walk(sent + 1, answered, [...steps, { kind: "send", index: sent }]);
    for (let i = 0; i < sent; i++) {
      if (!answered.has(i)) walk(sent, new Set([...answered, i]), [...steps, { kind: "answer", index: i }]);
    }
  };
  walk(0, new Set(), []);
  return orders;
}

function scenarios(): Request[][] {
  const options: Request[] = [
    { intent: "read", ok: true },
    { intent: "read", ok: false },
    { intent: "write", ok: true },
    { intent: "write", ok: false },
  ];
  const grow = (lists: Request[][]) => lists.flatMap((list) => options.map((r) => [...list, r]));
  const one = options.map((r) => [r]);
  const two = grow(one);
  return [...one, ...two, ...grow(two)];
}

const SNAPSHOTS = [OPEN, FULL, FIXTURES.ready.snapshot];
const label = (requests: Request[]) => requests.map((r) => `${r.intent} ${r.ok ? "ok" : "fails"}`).join(", ");

describe("the tracker's report of whether the room answered", () => {
  const settle = <T,>() => {
    let release!: (value: T) => void;
    const promise = new Promise<T>((resolve) => (release = resolve));
    return { promise, release };
  };
  const failed: Result<RoomSnapshot, "unavailable"> = { ok: false, failure: "unavailable" };

  it("reports a failed read, then the next answered one", async () => {
    const reports: boolean[] = [];
    const track = tracker(() => {}, (answered) => reports.push(answered));
    await track("read", async () => failed);
    await track("read", async () => ({ ok: true, value: OPEN }));
    expect(reports).toEqual([false, true]);
  });

  it("ignores a read that answers after a newer one, and writes", async () => {
    const reports: boolean[] = [];
    const track = tracker(() => {}, (answered) => reports.push(answered));
    const older = settle<Result<RoomSnapshot, "unavailable">>();
    const stale = track("read", () => older.promise);
    await track("read", async () => ({ ok: true, value: OPEN }));
    older.release(failed);
    await stale;
    await track("write", async () => failed);
    expect(reports).toEqual([true]);
  });

  it("reports that the room answered when a write shows a room, after reads that failed", async () => {
    const reports: boolean[] = [];
    const track = tracker(() => {}, (answered) => reports.push(answered));
    await track("read", async () => failed);
    await track("write", async () => ({ ok: true, value: JOINED }));
    expect(reports).toEqual([false, true]);
  });

  it("ignores a failed read sent while a write was in flight, and reports the room the write shows", async () => {
    const reports: boolean[] = [];
    const track = tracker(() => {}, (answered) => reports.push(answered));
    const write = settle<Result<RoomSnapshot, "unavailable">>();
    const writing = track("write", () => write.promise);
    await track("read", async () => failed);
    write.release({ ok: true, value: OPEN });
    await writing;
    expect(reports).toEqual([true]);
  });
});

describe("the tracker, in every order of sends and answers", () => {
  it.each(scenarios().map((requests) => [label(requests), requests] as const))("%s", async (_, requests) => {
    for (const order of interleavings(requests.length)) {
      const shown: number[] = [];
      const reports: [index: number, answered: boolean][] = [];
      let answering = -1;
      const track = tracker(
        (snapshot) => shown.push(SNAPSHOTS.indexOf(snapshot)),
        (answered) => reports.push([answering, answered]),
      );
      const answers = requests.map((r, i): Result<RoomSnapshot, "unavailable"> =>
        r.ok ? { ok: true, value: SNAPSHOTS[i]! } : { ok: false, failure: "unavailable" },
      );
      const release: (() => void)[] = [];
      const pending: Promise<Result<RoomSnapshot, "unavailable">>[] = [];
      const writesOpen = new Set<number>();
      const readsOpen = new Set<number>();
      const straddles = new Set<number>();
      const where = order.map((s) => `${s.kind} ${s.index}`).join(", ");

      for (const step of order) {
        const request = requests[step.index]!;
        if (step.kind === "send") {
          if (request.intent === "read" && writesOpen.size > 0) straddles.add(step.index);
          if (request.intent === "write") {
            writesOpen.add(step.index);
            for (const i of readsOpen) straddles.add(i);
          }
          if (request.intent === "read") readsOpen.add(step.index);
          pending[step.index] = track(request.intent, () => new Promise((resolve) => (release[step.index] = () => resolve(answers[step.index]!))));
          continue;
        }
        const newestBefore = Math.max(-1, ...shown);
        const reportsBefore = reports.length;
        const newestKnown = Math.max(newestBefore, ...reports.map(([i]) => i));
        answering = step.index;
        release[step.index]!();
        expect(await pending[step.index], where).toBe(answers[step.index]);
        writesOpen.delete(step.index);
        readsOpen.delete(step.index);
        const shows = request.ok && !straddles.has(step.index) && step.index > newestBefore;
        expect(shown.at(-1) ?? -1, `${where}: answer ${step.index}`).toBe(shows ? step.index : newestBefore);
        const reported = (request.ok || request.intent === "read") && !straddles.has(step.index) && step.index > newestKnown;
        expect(reports.slice(reportsBefore), `${where}: reach of answer ${step.index}`).toEqual(reported ? [[step.index, request.ok]] : []);
      }
      expect(reports.map(([i]) => i), `${where}: reports in send order`).toEqual(reports.map(([i]) => i).sort((a, b) => a - b));
      const eligible = requests.flatMap((r, i) => (r.ok && !straddles.has(i) ? [i] : []));
      expect(shown.at(-1) ?? -1, `${where}: last shown`).toBe(Math.max(-1, ...eligible));
      expect(shown, `${where}: never older after newer`).toEqual([...shown].sort((a, b) => a - b));
    }
  });
});
