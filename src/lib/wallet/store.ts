import type { BridgeResult, ServiceResult, WalletEnvironment } from "./environment";
import { step, type Answer, type Effect, type Gen, type Intent, type SessionEvent, type SessionState } from "./machine";

export type SessionStore = {
  /** useSyncExternalStore's getSnapshot and getServerSnapshot. Stable identity between changes. */
  getSnapshot(): SessionState;
  subscribe(listener: () => void): () => void;
  send(intent: Intent): void;
  start(): () => void;
};

/** setTimeout's ceiling. A later expiry schedules nothing. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const BRIDGE_THREW: BridgeResult<never> = { ok: false, failure: "failed" };
const SERVICE_THREW: ServiceResult<never> = { ok: false, failure: "unavailable" };

export function createSessionStore(env: WalletEnvironment, initial: SessionState): SessionStore {
  let state = initial;
  const listeners = new Set<() => void>();
  let server: Promise<unknown> = Promise.resolve();
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  function dispatch(event: SessionEvent): void {
    const result = step(state, event);
    if (result.state === state) return;
    state = result.state;
    for (const listener of listeners) listener();
    for (const effect of result.effects) run(effect, state.gen);
  }

  function serial<T>(call: () => Promise<T>): Promise<T> {
    const result = server.then(call);
    server = result.catch(() => undefined);
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
  };
}
