// The one driver. Holds the current SessionState, runs effects, and turns every result into an
// `answer` stamped with the gen of the state that issued it. No policy lives here: which effect
// runs and whether an answer counts is decided in machine.ts.

import type { BridgeResult, ServiceResult, WalletEnvironment } from "./environment";
import { step, type Answer, type Effect, type Gen, type Intent, type SessionEvent, type SessionState } from "./machine";

export type SessionStore = {
  /** useSyncExternalStore's getSnapshot and getServerSnapshot. Stable identity between changes. */
  getSnapshot(): SessionState;
  subscribe(listener: () => void): () => void;
  send(intent: Intent): void;
  /** Subscribes to the bridge's account changes. Client only (called from useEffect). Returns stop. */
  start(): () => void;
};

/** setTimeout's ceiling. A later expiry (sample data expires in 2099) schedules nothing. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** An adapter that throws anyway is a bug, never a rejection by the user. */
const BRIDGE_THREW: BridgeResult<never> = { ok: false, failure: "failed" };
const SERVICE_THREW: ServiceResult<never> = { ok: false, failure: "unavailable" };

export function createSessionStore(env: WalletEnvironment, initial: SessionState): SessionStore {
  let state = initial;
  const listeners = new Set<() => void>();
  /**
   * Every auth route call chains here, one at a time. The browser has one cookie, so Set-Cookie and
   * DELETE must reach the server in the order the machine issued them.
   */
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
        // A timer for an older session is harmless: the machine ignores `expired` for a session that isn't current.
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
