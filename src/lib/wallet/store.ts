import type { CheckedPayment } from "@/client/payment-check";
import type {
  BridgeResult,
  PaymentApproval,
  Result,
  ServiceResult,
  SignatureBase64,
  SignFailure,
  WalletEnvironment,
} from "./environment";
import { step, type Answer, type Effect, type Gen, type Intent, type SessionEvent, type SessionState } from "./machine";

export type SessionStore = {
  /** useSyncExternalStore's getSnapshot and getServerSnapshot. Stable identity between changes. */
  getSnapshot(): SessionState;
  subscribe(listener: () => void): () => void;
  send(intent: Intent): void;
  start(): () => void;
  signPayment(gen: Gen, payment: CheckedPayment): Promise<Result<PaymentApproval, SignFailure>>;
  approving(): boolean;
  cancelPayment(): void;
};

/** setTimeout's ceiling. A later expiry schedules nothing. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const BRIDGE_THREW: BridgeResult<never> = { ok: false, failure: "failed" };
const SERVICE_THREW: ServiceResult<never> = { ok: false, failure: "unavailable" };
const STALE = { ok: false, failure: "stale" } as const;
const BUSY = { ok: false, failure: "busy" } as const;

type Ended = { readonly ok: false; readonly failure: "rejected" | "stale" };

export function createSessionStore(env: WalletEnvironment, initial: SessionState): SessionStore {
  let state = initial;
  const listeners = new Set<() => void>();
  let signInCallsInOrder: Promise<unknown> = Promise.resolve();
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let paymentPromptOpen = false;
  let waiting: { readonly gen: Gen; readonly end: (answer: Ended) => void } | null = null;
  let approved: { readonly gen: Gen; readonly approval: PaymentApproval } | null = null;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function dispatch(event: SessionEvent): void {
    const result = step(state, event);
    if (result.state === state) return;
    state = result.state;
    if (waiting !== null && waiting.gen !== state.gen) waiting.end(STALE);
    notify();
    for (const effect of result.effects) run(effect, state.gen);
  }

  async function signPayment(gen: Gen, payment: CheckedPayment): Promise<Result<PaymentApproval, SignFailure>> {
    const current = () => state.kind === "signed_in" && state.gen === gen && state.account === payment.account;
    if (!current()) return STALE;
    if (approved?.gen === gen && approved.approval.messageHash === payment.messageHash) return { ok: true, value: approved.approval };
    if (paymentPromptOpen) return BUSY;

    paymentPromptOpen = true;
    let walletAnswer: Promise<BridgeResult<SignatureBase64>>;
    try {
      walletAnswer = env.bridge.signPayment(payment).catch(() => BRIDGE_THREW);
    } catch {
      walletAnswer = Promise.resolve(BRIDGE_THREW);
    }
    void walletAnswer.finally(() => {
      paymentPromptOpen = false;
    });
    const ended = new Promise<Ended>((resolve) => {
      waiting = {
        gen,
        end: (answer) => {
          waiting = null;
          resolve(answer);
        },
      };
    });
    notify();

    const first = await Promise.race([walletAnswer.then((answer) => ({ answer })), ended]);
    if (!("answer" in first)) return first;
    waiting = null;
    notify();
    const { answer } = first;
    if (!current()) return STALE;
    if (!answer.ok) return { ok: false, failure: answer.failure === "rejected" ? "rejected" : "failed" };
    const approval: PaymentApproval = { messageHash: payment.messageHash, signature: answer.value };
    approved = { gen, approval };
    return { ok: true, value: approval };
  }

  function serial<T>(call: () => Promise<T>): Promise<T> {
    const result = signInCallsInOrder.then(call);
    signInCallsInOrder = result.catch(() => undefined);
    return result;
  }

  function answer(gen: Gen, pending: Promise<Answer>): void {
    void pending.then((a) => dispatch({ type: "answer", gen, answer: a }));
  }

  function run(effect: Effect, gen: Gen): void {
    const { bridge, service } = env;
    switch (effect.kind) {
      case "wallet_connect":
        return answer(gen, bridge.connect().catch(() => BRIDGE_THREW).then((result): Answer => ({ kind: "connect", result })));
      case "wallet_sign":
        return answer(
          gen,
          bridge
            .signAuthentication({ account: effect.account, message: effect.message })
            .catch(() => BRIDGE_THREW)
            .then((result): Answer => ({ kind: "signature", result })),
        );
      case "wallet_disconnect":
        void bridge.disconnect().catch(() => undefined);
        return;
      case "read_session":
        return answer(gen, serial(() => service.readSession()).catch(() => SERVICE_THREW).then((result): Answer => ({ kind: "session", result })));
      case "request_challenge":
        return answer(
          gen,
          serial(() => service.requestChallenge(effect.account))
            .catch(() => SERVICE_THREW)
            .then((result): Answer => ({ kind: "challenge", result })),
        );
      case "verify":
        return answer(
          gen,
          serial(() => service.verify({ challengeId: effect.challengeId, signature: effect.signature }))
            .catch(() => SERVICE_THREW)
            .then((result): Answer => ({ kind: "verify", result })),
        );
      case "end_session":
        void serial(() => service.endSession()).catch(() => undefined);
        return;
      case "watch_expiry": {
        clearTimeout(expiryTimer);
        const delay = Date.parse(effect.session.expiresAt) - Date.now();
        if (delay > MAX_TIMER_MS) return;
        expiryTimer = setTimeout(() => dispatch({ type: "expired", session: effect.session }), Math.max(0, delay));
        return;
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send: (intent) => dispatch(intent),
    start() {
      return env.bridge.onAccountChange((account) => dispatch({ type: "account_changed", account }));
    },
    signPayment,
    approving: () => waiting !== null,
    cancelPayment() {
      if (waiting === null) return;
      waiting.end({ ok: false, failure: "rejected" });
      notify();
    },
  };
}
