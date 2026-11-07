import type { PaymentSigner, Result } from "@/lib/wallet/environment";
import { checkoutApi, type CheckoutApi, type RequestProblem, type RoomReadProblem } from "./api";
import { ACTIONS, FUNDING_CAUSES, REQUEST_PROBLEMS, WORDS, type ActionKind, type FundingCause, type ProblemWithWords, type Screen } from "./catalog";
import { NOTHING_HEARD, checkoutLinks, situationOf, type Action, type ActionOf, type ApprovalTerms, type NotedCause } from "./checkout-view";
import type { AttemptId, AttemptSummary, CheckoutId, RoomSnapshot, Session } from "./contracts";
import { checkPayment, type PaymentCheck } from "./payment-check";

export type LiveKind = {
  [K in ActionKind]: (typeof ACTIONS)[K] extends { readonly busy: string } ? K : never;
}[ActionKind];
export type LiveAction = ActionOf<LiveKind>;

export function isLiveAction(action: Action): action is LiveAction {
  return "busy" in ACTIONS[action.kind];
}

export type Outcome =
  | { readonly kind: "done" }
  | { readonly kind: "noted"; readonly text: string }
  | { readonly kind: "open"; readonly href: string }
  | { readonly kind: "signed_out" }
  | { readonly kind: "notice"; readonly text: string; readonly followUp: Action | null; readonly about?: AttemptId };

export type Intent = "read" | "write";

export type Track = <F extends string>(intent: Intent, request: () => Promise<Result<RoomSnapshot, F>>) => Promise<Result<RoomSnapshot, F>>;

export const untracked: Track = (_intent, request) => request();

type Show = (snapshot: RoomSnapshot, intent: Intent) => void;

function roomTracker(show: Show, reached: (answered: boolean) => void): Track {
  let sent = 0;
  let shown = 0;
  let reported = 0;
  let writesInFlight = 0;
  let lastWrite = 0;
  return async (intent, request) => {
    sent += 1;
    const ticket = sent;
    const sentDuringWrite = writesInFlight > 0;
    if (intent === "write") {
      writesInFlight += 1;
      lastWrite = ticket;
    }
    try {
      const answer = await request();
      const overlapsWrite = intent === "read" && (sentDuringWrite || lastWrite > ticket);
      const current = !overlapsWrite && ticket > shown;
      if (answer.ok && current) {
        shown = ticket;
        show(answer.value, intent);
      }
      if (current && ticket > reported && (answer.ok || intent === "read")) {
        reported = ticket;
        reached(answer.ok);
      }
      return answer;
    } finally {
      if (intent === "write") writesInFlight -= 1;
    }
  };
}

export type Scope = { readonly track: Track; readonly signer: PaymentSigner };

type RoomContext = { readonly api: CheckoutApi; readonly track: Track };
type StartContext = RoomContext & { readonly expect: (refused: Refused) => void };
/** Approve alone also reaches the wallet's signer and the payment check. */
type ApproveContext = RoomContext & { readonly signer: PaymentSigner; readonly check: PaymentCheck };
type Contexts = {
  readonly [K in LiveKind]: K extends "approve" ? ApproveContext : K extends "start_payment" | "retry" ? StartContext : RoomContext;
};
type Run<K extends LiveKind> = (action: ActionOf<K>, context: Contexts[K]) => Promise<Outcome>;

const DONE: Outcome = { kind: "done" };
const DECLINED_UNSEEN: Outcome = { kind: "noted", text: WORDS.declined };
const SIGNED_OUT: Outcome = { kind: "signed_out" };

const RUN: { readonly [K in LiveKind]: Run<K> } = {
  create_checkout: async ({ request, clientRequestId }, { api }) => {
    const created = await api.create(request, clientRequestId);
    return created.ok ? { kind: "open", href: checkoutLinks(created.value.checkout.id).room } : said(created.failure);
  },
  join: ({ checkoutId }, c) => roomWrite(c, checkoutId, () => c.api.join(checkoutId)),
  mark_ready: ({ checkoutId }, c) => roomWrite(c, checkoutId, () => c.api.setReady(checkoutId, true)),
  mark_not_ready: ({ checkoutId }, c) => roomWrite(c, checkoutId, () => c.api.setReady(checkoutId, false)),
  start_payment: ({ checkoutId }, c) => startAttempt(c, checkoutId, null),
  retry: ({ checkoutId, retryOfAttemptId }, c) => startAttempt(c, checkoutId, retryOfAttemptId),
  approve: ({ terms }, c) => approve(terms, c),
  decline: async (action, c) => {
    const outcome = await writeThenShowRoom(c, action.checkoutId, () => c.api.decline(action.attemptId), DECLINED_UNSEEN);
    return outcome.kind === "notice" ? { ...outcome, followUp: action } : outcome;
  },
};

async function approve(terms: ApprovalTerms, c: ApproveContext): Promise<Outcome> {
  const payload = await c.api.signingPayload(terms.attemptId);
  if (!payload.ok) return payload.failure === "mismatch" ? notice("mismatch") : settle(c, terms.checkoutId, payload.failure);
  const checked = await c.check.payload(payload.value, terms);
  if (!checked.ok) return notice(checked.failure);
  const approval = await c.signer.keptOrNewApproval(checked.value);
  if (!approval.ok) {
    if (approval.failure === "stale") return DONE;
    return approval.failure === "rejected"
      ? notice("rejected", { kind: "decline", checkoutId: terms.checkoutId, attemptId: terms.attemptId })
      : notice(approval.failure);
  }
  const returned = await c.check.returned(checked.value, approval.value);
  if (!returned.ok) {
    c.signer.forget(approval.value);
    return notice(returned.failure);
  }
  if (!c.signer.isCurrent(checked.value)) return DONE;
  const uploaded = await writeThenReadRoom(c, terms.checkoutId, () => c.api.uploadApproval(terms.attemptId, returned.value));
  if (!uploaded.ok && uploaded.failure === "refused") {
    c.signer.forget(returned.value);
    return notice("approval_refused");
  }
  return outcomeOfWrite(c, terms.checkoutId, uploaded);
}

async function startAttempt(c: StartContext, id: CheckoutId, retryOf: AttemptId | null): Promise<Outcome> {
  const answer = await writeThenReadRoom(c, id, async () => {
    const started = await c.api.startAttempt(id, retryOf);
    if (!started.ok && isFundingCause(started.failure)) c.expect({ cause: started.failure, replacing: retryOf });
    return started;
  });
  if (answer.ok || answer.failure === "unseen") return DONE;
  if (!mayLeaveFailed(answer.failure)) return settle(c, id, answer.failure);
  const read = await readRoomAgain(c, id);
  const left = read.ok ? read.value.attempt : null;
  if (!stoppedUnsent(left, retryOf)) return notice(answer.failure);
  return retryOf === null ? DONE : { kind: "notice", text: WORDS.retry_stopped, followUp: null, about: left.id };
}

const isFundingCause = (problem: RequestProblem): problem is FundingCause => (FUNDING_CAUSES as readonly string[]).includes(problem);

/** Payments may have stored the new attempt as failed before it answered a start with one of these. */
const mayLeaveFailed = (problem: RequestProblem): problem is FundingCause | "refused" | "unavailable" =>
  isFundingCause(problem) || problem === "refused" || problem === "unavailable";

const stoppedUnsent = (attempt: AttemptSummary | null, replacing: AttemptId | null): attempt is AttemptSummary =>
  attempt !== null && attempt.state === "failed" && attempt.transactionReference === null && attempt.id !== replacing;

async function roomWrite(c: RoomContext, id: CheckoutId, write: () => Promise<Result<RoomSnapshot, RequestProblem>>): Promise<Outcome> {
  const answer = await c.track("write", write);
  return answer.ok ? DONE : settle(c, id, answer.failure);
}

/** For a write that answers with an attempt: the screen shows only rooms, so the room is read after it. */
async function writeThenShowRoom(
  c: RoomContext,
  id: CheckoutId,
  write: () => Promise<Result<unknown, RequestProblem>>,
  landedUnseen: Outcome = DONE,
): Promise<Outcome> {
  return outcomeOfWrite(c, id, await writeThenReadRoom(c, id, write), landedUnseen);
}

function writeThenReadRoom(
  c: RoomContext,
  id: CheckoutId,
  write: () => Promise<Result<unknown, RequestProblem>>,
): Promise<Result<RoomSnapshot, RequestProblem | "unseen">> {
  return c.track<RequestProblem | "unseen">("write", async () => {
    const wrote = await write();
    if (!wrote.ok) return wrote;
    const room = await c.api.readRoom(id);
    return room.ok ? room : { ok: false, failure: "unseen" };
  });
}

function outcomeOfWrite(
  c: RoomContext,
  id: CheckoutId,
  answer: Result<RoomSnapshot, RequestProblem | "unseen">,
  landedUnseen: Outcome = DONE,
): Promise<Outcome> | Outcome {
  if (answer.ok) return DONE;
  if (answer.failure === "unseen") return landedUnseen;
  return settle(c, id, answer.failure);
}

/**
 * What a failed request leaves on screen. A problem that means the room moved on reads it again, then
 * says `ifShown` when the room read shows the latest (null says nothing), and `ifUnread` when it can't.
 */
type After =
  | { readonly readAgain: false }
  | { readonly readAgain: true; readonly ifShown: ProblemWithWords | null; readonly ifUnread: ProblemWithWords };

const SAY: After = { readAgain: false };

const AFTER: { readonly [P in Exclude<RequestProblem, "signed_out">]: After } = {
  room_full: { readAgain: true, ifShown: null, ifUnread: "room_full" },
  room_changed: { readAgain: true, ifShown: "room_changed", ifUnread: "room_changed_unread" },
  short_usdc: { readAgain: true, ifShown: "short_usdc", ifUnread: "short_usdc" },
  short_sol: { readAgain: true, ifShown: "short_sol", ifUnread: "short_sol" },
  no_token_account: { readAgain: true, ifShown: "no_token_account", ifUnread: "no_token_account" },
  rate_limited: SAY,
  refused: SAY,
  unavailable: SAY,
};

async function settle(c: RoomContext, id: CheckoutId, problem: RequestProblem): Promise<Outcome> {
  if (problem === "signed_out") return SIGNED_OUT;
  const after = AFTER[problem];
  if (!after.readAgain) return notice(problem);
  const read = await readRoomAgain(c, id);
  const words = read.ok ? after.ifShown : after.ifUnread;
  return words === null ? DONE : notice(words);
}

function said(problem: RequestProblem): Outcome {
  return problem === "signed_out" ? SIGNED_OUT : notice(problem);
}

function notice(problem: ProblemWithWords, followUp: Action | null = null): Outcome {
  return { kind: "notice", text: REQUEST_PROBLEMS[problem], followUp };
}

function readRoomAgain(c: RoomContext, id: CheckoutId): Promise<Result<RoomSnapshot, RoomReadProblem>> {
  return c.track("read", () => c.api.readRoom(id));
}

/**
 * The screen a shown room takes the viewer to, or null to stay. This page's own write moves the viewer to
 * whichever screen owns its room. A polled room moves the viewer only when its owner changed from the one
 * before, so a page opened on the other screen, or restored there by Back, stays put.
 */
export function moveFor(shown: { readonly owner: Screen; readonly intent: Intent }, here: Screen, before: Screen | null): Screen | null {
  if (shown.owner === here) return null;
  return shown.intent === "write" || (before !== null && shown.owner !== before) ? shown.owner : null;
}

export const POLL_MS = 2_000;
export const MAX_BACKOFF_MS = 30_000;

export type PollPlan = {
  readonly stop: boolean;
  readonly refresh: AttemptId | null;
};

export function pollPlan(snapshot: RoomSnapshot, session: Session | null): PollPlan {
  const a = snapshot.attempt;
  const payer = session !== null && snapshot.participants.some((p) => p.wallet === session.wallet);
  return {
    stop: situationOf(snapshot) === "paid",
    refresh: payer && a !== null && blocksNewAttempt(a) ? a.id : null,
  };
}

/** An attempt that is neither confirmed nor safe to retry, so no new attempt can start until it settles. */
const blocksNewAttempt = (attempt: AttemptSummary): boolean => attempt.state !== "confirmed" && !attempt.canRetry;

export type Watched = {
  readonly id: CheckoutId;
  readonly track: Track;
  readonly now: () => { readonly snapshot: RoomSnapshot; readonly session: Session | null };
  readonly signedOut: (session: Session) => void;
};

export type PollEnv = {
  readonly wait: (ms: number, then: () => void) => () => void;
  readonly visible: () => boolean;
  readonly onResume: (wake: () => void) => () => void;
};

export const browserPollEnv: PollEnv = {
  wait: (ms, then) => {
    const timer = setTimeout(then, ms);
    return () => clearTimeout(timer);
  },
  visible: () => document.visibilityState === "visible",
  onResume: (wake) => {
    const shown = () => {
      if (document.visibilityState === "visible") wake();
    };
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  },
};

type RefreshOnce = (id: AttemptId) => Promise<Result<AttemptSummary, RequestProblem>> | null;

function watch(api: CheckoutApi, env: PollEnv, room: Watched, refreshOnce: RefreshOnce): () => void {
  let stopped = false;
  let polling = false;
  let delay = POLL_MS;
  let cancel = () => {};

  const poll = async () => {
    if (stopped || polling || !env.visible()) return;
    const { snapshot, session } = room.now();
    const plan = pollPlan(snapshot, session);
    if (plan.stop) return;
    polling = true;
    const [read, refreshed] = await Promise.all([
      room.track("read", () => api.readRoom(room.id)),
      plan.refresh === null ? null : refreshOnce(plan.refresh),
    ]);
    polling = false;
    if (stopped) return;
    if (refreshed?.ok === false && refreshed.failure === "signed_out" && session !== null) room.signedOut(session);
    delay = read.ok && refreshed?.ok !== false ? POLL_MS : Math.min(delay * 2, MAX_BACKOFF_MS);
    cancel = env.wait(delay, poll);
  };

  const unsubscribe = env.onResume(() => {
    cancel();
    delay = POLL_MS;
    void poll();
  });
  void poll();
  return () => {
    stopped = true;
    cancel();
    unsubscribe();
  };
}

/** For `useSyncExternalStore`: `current` keeps its identity until a new note lands. */
export type NotedCauses = {
  subscribe(listener: () => void): () => void;
  current(): readonly NotedCause[];
};

export type Live = {
  run(action: LiveAction, scope: Scope): Promise<Outcome>;
  watch(room: Watched): () => void;
  tracker(show: Show, reached: (answered: boolean) => void): Track;
  readonly noted: NotedCauses;
  readonly arrivals: Arrivals;
};

/** A move unmounts the page that made it, so the page it opens learns of the move from here. */
export type Arrivals = {
  moveTo(href: string): void;
  movedTo(href: string): boolean;
  landed(): void;
};

function arrivals(): Arrivals {
  let target: string | null = null;
  return {
    moveTo(href) {
      target = href;
    },
    movedTo: (href) => target === href,
    landed() {
      target = null;
    },
  };
}

type Refused = { readonly cause: FundingCause; readonly replacing: AttemptId | null };

/**
 * A funding refusal names no attempt, so the cause waits for the next room shown with an attempt other
 * than the one being replaced, and is noted on it only if that attempt stopped before it was sent.
 */
function notedMemory(): NotedCauses & { expect(refused: Refused): void; observe(snapshot: RoomSnapshot): void } {
  let noted: readonly NotedCause[] = NOTHING_HEARD.noted;
  let pending: Refused | null = null;
  const listeners = new Set<() => void>();
  return {
    expect(refused) {
      pending = refused;
    },
    observe({ attempt }) {
      if (pending === null || attempt === null || attempt.id === pending.replacing) return;
      const { cause } = pending;
      pending = null;
      if (!stoppedUnsent(attempt, null) || noted.some((n) => n.attemptId === attempt.id)) return;
      noted = [...noted, { attemptId: attempt.id, cause }];
      for (const listener of listeners) listener();
    },
    current: () => noted,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function liveActions(api: CheckoutApi, check: PaymentCheck = checkPayment, env: PollEnv = browserPollEnv): Live {
  const memory = notedMemory();
  let refreshing = false;
  const refreshOnce: RefreshOnce = (id) => {
    if (refreshing) return null;
    refreshing = true;
    return api.refreshAttempt(id).finally(() => {
      refreshing = false;
    });
  };
  return {
    run: (action, scope) => run(action, { ...scope, api, check, expect: memory.expect }),
    watch: (room) => watch(api, env, room, refreshOnce),
    tracker: (show, reached) =>
      roomTracker((snapshot, intent) => {
        memory.observe(snapshot);
        show(snapshot, intent);
      }, reached),
    noted: { subscribe: memory.subscribe, current: memory.current },
    arrivals: arrivals(),
  };
}

function run<K extends LiveKind>(action: ActionOf<K>, context: ApproveContext & StartContext): Promise<Outcome> {
  return RUN[action.kind](action, context);
}

export const live: Live = liveActions(checkoutApi((path, init) => globalThis.fetch(path, init)));
