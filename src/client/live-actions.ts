import type { PaymentSigner, Result } from "@/lib/wallet/environment";
import { checkoutApi, type CheckoutApi, type RequestProblem, type RoomReadProblem } from "./api";
import { ACTIONS, REQUEST_PROBLEMS, type ActionKind, type ProblemWithWords } from "./catalog";
import { checkoutLinks, type Action, type ActionOf, type ApprovalTerms } from "./checkout-view";
import type { AttemptId, CheckoutId, RoomSnapshot, Session } from "./contracts";
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
  | { readonly kind: "open"; readonly href: string }
  | { readonly kind: "signed_out" }
  | { readonly kind: "notice"; readonly text: string; readonly followUp: Action | null };

export type Track = <F extends string>(
  intent: "read" | "write",
  request: () => Promise<Result<RoomSnapshot, F>>,
) => Promise<Result<RoomSnapshot, F>>;

export const untracked: Track = (_intent, request) => request();

export function roomTracker(show: (snapshot: RoomSnapshot) => void): Track {
  let sent = 0;
  let shown = 0;
  let writesInFlight = 0;
  return async (intent, request) => {
    sent += 1;
    const ticket = sent;
    const straddlesWrite = intent === "read" && writesInFlight > 0;
    if (intent === "write") writesInFlight += 1;
    try {
      const answer = await request();
      if (answer.ok && !straddlesWrite && ticket > shown) {
        shown = ticket;
        show(answer.value);
      }
      return answer;
    } finally {
      if (intent === "write") writesInFlight -= 1;
    }
  };
}

export type Scope = { readonly track: Track; readonly signer: PaymentSigner };

type Context = Scope & { readonly api: CheckoutApi; readonly check: PaymentCheck };
type Run<K extends LiveKind> = (action: ActionOf<K>, context: Context) => Promise<Outcome>;

const DONE: Outcome = { kind: "done" };
const SIGNED_OUT: Outcome = { kind: "signed_out" };

const RUN: { readonly [K in LiveKind]: Run<K> } = {
  create_checkout: async ({ request, clientRequestId }, { api }) => {
    const created = await api.create(request, clientRequestId);
    return created.ok ? { kind: "open", href: checkoutLinks(created.value.checkout.id).room } : said(created.failure);
  },
  join: ({ checkoutId }, c) => roomWrite(c, checkoutId, () => c.api.join(checkoutId)),
  mark_ready: ({ checkoutId }, c) => roomWrite(c, checkoutId, () => c.api.setReady(checkoutId, true)),
  mark_not_ready: ({ checkoutId }, c) => roomWrite(c, checkoutId, () => c.api.setReady(checkoutId, false)),
  start_payment: ({ checkoutId }, c) => attemptWrite(c, checkoutId, () => c.api.startAttempt(checkoutId)),
  approve: ({ terms }, c) => approve(terms, c),
  decline: ({ checkoutId, attemptId }, c) => attemptWrite(c, checkoutId, () => c.api.decline(attemptId)),
};

async function approve(terms: ApprovalTerms, c: Context): Promise<Outcome> {
  const payload = await c.api.signingPayload(terms.attemptId);
  if (!payload.ok) return settle(c, terms.checkoutId, payload.failure);
  const checked = await c.check(payload.value, terms);
  if (!checked.ok) return notice(checked.failure);
  const approval = await c.signer.sign(checked.value);
  if (approval.ok) return attemptWrite(c, terms.checkoutId, () => c.api.uploadApproval(terms.attemptId, approval.value));
  if (approval.failure === "stale") return DONE;
  return approval.failure === "rejected"
    ? notice("rejected", { kind: "decline", checkoutId: terms.checkoutId, attemptId: terms.attemptId })
    : notice(approval.failure);
}

async function roomWrite(c: Context, id: CheckoutId, write: () => Promise<Result<RoomSnapshot, RequestProblem>>): Promise<Outcome> {
  const answer = await c.track("write", write);
  return answer.ok ? DONE : settle(c, id, answer.failure);
}

async function attemptWrite(c: Context, id: CheckoutId, write: () => Promise<Result<unknown, RequestProblem>>): Promise<Outcome> {
  const answer = await c.track<RequestProblem | "unseen">("write", async () => {
    const wrote = await write();
    if (!wrote.ok) return wrote;
    const room = await c.api.readRoom(id);
    return room.ok ? room : { ok: false, failure: "unseen" };
  });
  if (answer.ok || answer.failure === "unseen") return DONE;
  return settle(c, id, answer.failure);
}

const AFTER: { readonly [P in Exclude<RequestProblem, "signed_out">]: "say" | "reread" | "reread_and_say" } = {
  room_full: "reread",
  room_changed: "reread_and_say",
  not_funded: "reread_and_say",
  rate_limited: "say",
  refused: "say",
  unavailable: "say",
};

async function settle(c: Context, id: CheckoutId, problem: RequestProblem): Promise<Outcome> {
  if (problem === "signed_out" || AFTER[problem] === "say") return said(problem);
  const read = await reread(c, id);
  return AFTER[problem] === "reread" && read.ok ? DONE : notice(problem);
}

function said(problem: RequestProblem): Outcome {
  return problem === "signed_out" ? SIGNED_OUT : notice(problem);
}

function notice(problem: ProblemWithWords, followUp: Action | null = null): Outcome {
  return { kind: "notice", text: REQUEST_PROBLEMS[problem], followUp };
}

function reread(c: Pick<Context, "api" | "track">, id: CheckoutId): Promise<Result<RoomSnapshot, RoomReadProblem>> {
  return c.track("read", () => c.api.readRoom(id));
}

export const POLL_MS = 2_000;
export const MAX_BACKOFF_MS = 30_000;

export type PollPlan = {
  readonly read: boolean;
  readonly refresh: AttemptId | null;
};

export function pollPlan(snapshot: RoomSnapshot, session: Session | null): PollPlan {
  const a = snapshot.attempt;
  const payer = session !== null && snapshot.participants.some((p) => p.wallet === session.wallet);
  return {
    read: snapshot.phase !== "paid",
    refresh: payer && a !== null && a.state !== "confirmed" && !a.canRetry ? a.id : null,
  };
}

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

function watch(api: CheckoutApi, env: PollEnv, room: Watched): () => void {
  let stopped = false;
  let polling = false;
  let delay = POLL_MS;
  let cancel = () => {};

  const poll = async () => {
    if (stopped || polling || !env.visible()) return;
    polling = true;
    const { snapshot, session } = room.now();
    const plan = pollPlan(snapshot, session);
    let ok = true;
    if (plan.refresh !== null) {
      const refreshed = await api.refreshAttempt(plan.refresh);
      if (!refreshed.ok && refreshed.failure === "signed_out" && session !== null) room.signedOut(session);
      ok = refreshed.ok;
    }
    if (plan.read) ok = (await room.track("read", () => api.readRoom(room.id))).ok && ok;
    polling = false;
    if (stopped || !plan.read) return;
    delay = ok ? POLL_MS : Math.min(delay * 2, MAX_BACKOFF_MS);
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

export type Live = {
  run(action: LiveAction, scope: Scope): Promise<Outcome>;
  watch(room: Watched): () => void;
};

export function liveActions(api: CheckoutApi, check: PaymentCheck = checkPayment, env: PollEnv = browserPollEnv): Live {
  return {
    run: (action, scope) => run(action, { ...scope, api, check }),
    watch: (room) => watch(api, env, room),
  };
}

function run<K extends LiveKind>(action: ActionOf<K>, context: Context): Promise<Outcome> {
  return RUN[action.kind](action, context);
}

export const live: Live = liveActions(checkoutApi((path, init) => globalThis.fetch(path, init)));
