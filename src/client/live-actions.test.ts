import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { PaymentApproval, PaymentSigner, Result, SignatureBase64, SignFailure } from "@/lib/wallet/environment";
import { checkoutApi, type FetchLike } from "./api";
import { ACTIONS, REQUEST_PROBLEMS, WORDS, type ActionKind, type ProblemWithWords } from "./catalog";
import { termsOf, type Action } from "./checkout-view";
import type { ClientRequestId, RoomSnapshot, Session } from "./contracts";
import { SAMPLE_WALLETS } from "./fixture-data";
import { FIXTURES } from "./fixtures";
import {
  browserPollEnv,
  isLiveAction,
  liveActions,
  pollPlan,
  roomTracker,
  untracked,
  type LiveAction,
  type LiveKind,
  type Outcome,
  type PollEnv,
  type Scope,
  type Track,
} from "./live-actions";
import { paymentCheck, type CheckedPayment } from "./payment-check";
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

function shownBy(): { readonly track: Track; readonly shown: RoomSnapshot[] } {
  const shown: RoomSnapshot[] = [];
  return { shown, track: roomTracker((snapshot) => shown.push(snapshot)) };
}

const NO_WALLET: PaymentSigner = {
  keptOrNewApproval: () => {
    throw new Error("A wallet prompt opened");
  },
  forget: () => {},
  isCurrent: () => true,
};
const scope = (track: Track = untracked, signer: PaymentSigner = NO_WALLET): Scope => ({ track, signer });
const said = (problem: ProblemWithWords, followUp: Action | null = null): Outcome => ({
  kind: "notice",
  text: REQUEST_PROBLEMS[problem],
  followUp,
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
  ...FIXTURES["declined-on-hold"].snapshot,
  checkout: SIGNING.checkout,
  attempt: { ...FIXTURES["declined-on-hold"].snapshot.attempt!, id: ATTEMPT },
};
const READY = FIXTURES.ready.snapshot;
const DECLINED_ELSEWHERE = FIXTURES["declined-on-hold"].snapshot.attempt!.id;
const SIGNATURE = "c2lnbmVkIGJ5IGJlYQ==" as SignatureBase64;
const APPROVE: Extract<LiveAction, { kind: "approve" }> = { kind: "approve", terms: TERMS };
const DECLINE: Extract<LiveAction, { kind: "decline" }> = { kind: "decline", checkoutId: ROOM, attemptId: ATTEMPT };
const EXAMPLES: { readonly [K in LiveKind]: Extract<LiveAction, { kind: K }> } = {
  create_checkout: CREATE,
  join: JOIN,
  mark_ready: { kind: "mark_ready", checkoutId: ID },
  mark_not_ready: { kind: "mark_not_ready", checkoutId: ID },
  start_payment: { kind: "start_payment", checkoutId: ID },
  approve: APPROVE,
  decline: DECLINE,
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

const bytesMatch = paymentCheck(async () => "match", async () => "match");
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

  it("is live exactly for the actions with a busy label, and runs each of them", async () => {
    expectTypeOf<LiveKind>().toEqualTypeOf<
      "create_checkout" | "join" | "mark_ready" | "mark_not_ready" | "start_payment" | "approve" | "decline"
    >();
    for (const kind of Object.keys(ACTIONS) as ActionKind[]) {
      expect(isLiveAction({ kind } as Action), kind).toBe(kind in EXAMPLES);
    }
    for (const action of Object.values(EXAMPLES)) {
      const { fetch, calls } = server(() => json(200, { data: OPEN }));
      await liveActions(checkoutApi(fetch)).run(action, scope());
      expect(calls, action.kind).toHaveLength(1);
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

  it("a payment that can't be funded reads the room again and says why", async () => {
    const { fetch, calls } = server(() => json(422, errorBody("INSUFFICIENT_USDC")), () => json(200, { data: SIGNING }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(START, scope(track))).toEqual(said("not_funded"));
    expect(requests(calls).at(-1)).toEqual(["GET", `/api/checkouts/${ROOM}`]);
    expect(shown).toEqual([SIGNING]);
  });
});

describe("approve", () => {
  it("checks the payment, opens one prompt with its exact bytes, uploads only the signature, and shows the room", async () => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }), () => json(200, { data: APPROVED.attempt }), () => json(200, { data: APPROVED }));
    const { track, shown } = shownBy();
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await approver(fetch).run(APPROVE, scope(track, signer))).toEqual({ kind: "done" });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ account: PAYER.wallet, attemptId: ATTEMPT, messageHash: WIRE.messageHash });
    expect(Buffer.from(prompts[0]!.transaction).toString("base64")).toBe(WIRE.transactionBase64);
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["GET", `/api/attempts/${ATTEMPT}/signing-payload`, null],
      ["POST", `/api/attempts/${ATTEMPT}/signatures`, { messageHash: WIRE.messageHash, signatureBase64: SIGNATURE }],
      ["GET", `/api/checkouts/${ROOM}`, null],
    ]);
    expect(shown).toEqual([APPROVED]);
  });

  it("a poll while the wallet's prompt is open still updates the room, and the upload's room shows after it", async () => {
    const camApproved: RoomSnapshot = { ...SIGNING, attempt: { ...SIGNING.attempt!, signedWallets: [SAMPLE_WALLETS.organizer, SAMPLE_WALLETS.cam] } };
    const allApproved: RoomSnapshot = { ...SIGNING, attempt: { ...camApproved.attempt!, signedWallets: [...camApproved.attempt!.signedWallets, PAYER.wallet] } };
    const { fetch } = server(
      () => json(200, { data: WIRE }),
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
    expect(shown, "the poll's room shows while the prompt is open").toEqual([camApproved]);
    answer({ messageHash: WIRE.messageHash as PaymentApproval["messageHash"], signature: SIGNATURE });
    expect(await approving).toEqual({ kind: "done" });
    expect(shown).toEqual([camApproved, allApproved]);
  });

  it("a payload that differs from the screen opens no prompt and sends nothing more", async () => {
    const tampered = { ...WIRE, payment: { ...(WIRE.payment as object), sellerWallet: SAMPLE_WALLETS.outsider } };
    const { fetch, calls } = server(() => json(200, { data: tampered }));
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said("mismatch"));
    expect(prompts).toHaveLength(0);
    expect(requests(calls)).toEqual([["GET", `/api/attempts/${ATTEMPT}/signing-payload`]]);
  });

  const payment = WIRE.payment as Record<string, unknown> & { readonly contributions: readonly Record<string, unknown>[] };
  it.each<[string, unknown]>([
    ["names another attempt", { ...WIRE, attemptId: DECLINED_ELSEWHERE }],
    ["is for another network", { ...WIRE, payment: { ...payment, network: "mainnet-beta" } }],
    ["lists the payers out of slot order", { ...WIRE, payment: { ...payment, contributions: [...payment.contributions].reverse() } }],
    ["adds a fourth payer", { ...WIRE, payment: { ...payment, contributions: [...payment.contributions, { ...payment.contributions[2], slot: 3 }] } }],
  ])("a payload that %s opens no prompt and says it doesn't match", async (_, data) => {
    const { fetch, calls } = server(() => json(200, { data }));
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said("mismatch"));
    expect(prompts).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("opens no prompt until Payments' byte check is wired", async () => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }));
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE });
    expect(await liveActions(checkoutApi(fetch)).run(APPROVE, scope(untracked, signer))).toEqual(said("unsupported"));
    expect(prompts).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("an approval that P3's check can't confirm uploads nothing, says so with no Decline, and isn't reused", async () => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }), () => json(200, { data: WIRE }));
    const { prompts, signer } = rememberingWallet();
    const live = liveActions(checkoutApi(fetch), paymentCheck(async () => "match", async () => "unsupported"));
    expect(await live.run(APPROVE, scope(untracked, signer))).toEqual(said("unchecked"));
    expect(await live.run(APPROVE, scope(untracked, signer))).toEqual(said("unchecked"));
    expect(prompts, "each Approve asked the wallet").toHaveLength(2);
    expect(calls.filter((c) => c.path.endsWith("/signatures"))).toEqual([]);
  });

  it("an answer that arrives after the sign-in changed uploads nothing and says nothing", async () => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }));
    const { prompts, signer } = wallet({ ok: false, failure: "stale" });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual({ kind: "done" });
    expect(prompts).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("a refusal in the wallet sends nothing and offers Decline for this attempt", async () => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }));
    const { signer } = wallet({ ok: false, failure: "rejected" });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said("rejected", DECLINE));
    expect(calls).toHaveLength(1);
  });

  it.each(["busy", "failed"] as const)("a %s wallet sends nothing and says so, with no Decline", async (failure) => {
    const { fetch, calls } = server(() => json(200, { data: WIRE }));
    const { signer } = wallet({ ok: false, failure });
    expect(await approver(fetch).run(APPROVE, scope(untracked, signer))).toEqual(said(failure));
    expect(calls).toHaveLength(1);
  });

  it("after an upload with no answer, Approve again resends the same approval without a second prompt", async () => {
    const { fetch, calls } = server(
      () => json(200, { data: WIRE }),
      noAnswer,
      () => json(200, { data: WIRE }),
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
        () => json(400, errorBody(code)),
        () => json(200, { data: WIRE }),
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
    const { fetch, calls } = server(() => json(200, { data: WIRE }));
    const { prompts, signer } = wallet({ ok: true, value: SIGNATURE }, () => signedIn);
    const switchesDuringTheReturnCheck = paymentCheck(
      async () => "match",
      async () => {
        signedIn = false;
        return "match";
      },
    );
    const live = liveActions(checkoutApi(fetch), switchesDuringTheReturnCheck);
    expect(await live.run(APPROVE, scope(untracked, signer))).toEqual({ kind: "done" });
    expect(prompts).toHaveLength(1);
    expect(requests(calls)).toEqual([["GET", `/api/attempts/${ATTEMPT}/signing-payload`]]);
  });

  it("an ended sign-in at any step is signed_out", async () => {
    for (const responses of [
      [() => json(401, errorBody("UNAUTHENTICATED"))],
      [() => json(200, { data: WIRE }), () => json(401, errorBody("UNAUTHENTICATED"))],
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

describe("what each poll sends", () => {
  const as = (wallet: string): Session => ({ wallet: wallet as Session["wallet"], expiresAt: PAYER.expiresAt });
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
    ["a decline on hold, to a payer", FIXTURES["declined-on-hold"].snapshot, PAYER, { stop: false, refresh: attemptOf("declined-on-hold") }],
    ["a decline that is safe to retry, to a payer", FIXTURES["declined-retry"].snapshot, PAYER, { stop: false, refresh: null }],
    ["an expiry that is safe to retry, to a payer", FIXTURES["expired-retry"].snapshot, PAYER, { stop: false, refresh: null }],
    ["a failure on hold, to a payer", FIXTURES["failed-on-hold"].snapshot, PAYER, { stop: false, refresh: attemptOf("failed-on-hold") }],
    ["a confirmed payment awaiting its receipt, to a payer", FIXTURES.confirming.snapshot, PAYER, { stop: false, refresh: null }],
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
    const { track, shown } = shownBy();
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

describe("roomTracker, in every order of sends and answers", () => {
  it.each(scenarios().map((requests) => [label(requests), requests] as const))("%s", async (_, requests) => {
    for (const order of interleavings(requests.length)) {
      const shown: number[] = [];
      const track = roomTracker((snapshot) => shown.push(SNAPSHOTS.indexOf(snapshot)));
      const answers = requests.map((r, i): Result<RoomSnapshot, "unavailable"> =>
        r.ok ? { ok: true, value: SNAPSHOTS[i]! } : { ok: false, failure: "unavailable" },
      );
      const release: (() => void)[] = [];
      const pending: Promise<Result<RoomSnapshot, "unavailable">>[] = [];
      const writesOpen = new Set<number>();
      const straddles = new Set<number>();
      const where = order.map((s) => `${s.kind} ${s.index}`).join(", ");

      for (const step of order) {
        const request = requests[step.index]!;
        if (step.kind === "send") {
          if (request.intent === "read" && writesOpen.size > 0) straddles.add(step.index);
          if (request.intent === "write") writesOpen.add(step.index);
          pending[step.index] = track(request.intent, () => new Promise((resolve) => (release[step.index] = () => resolve(answers[step.index]!))));
          continue;
        }
        const newestBefore = Math.max(-1, ...shown);
        release[step.index]!();
        expect(await pending[step.index], where).toBe(answers[step.index]);
        writesOpen.delete(step.index);
        const shows = request.ok && !straddles.has(step.index) && step.index > newestBefore;
        expect(shown.at(-1) ?? -1, `${where}: answer ${step.index}`).toBe(shows ? step.index : newestBefore);
      }
      const eligible = requests.flatMap((r, i) => (r.ok && !straddles.has(i) ? [i] : []));
      expect(shown.at(-1) ?? -1, `${where}: last shown`).toBe(Math.max(-1, ...eligible));
      expect(shown, `${where}: never older after newer`).toEqual([...shown].sort((a, b) => a - b));
    }
  });
});
