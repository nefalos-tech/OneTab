// Pure. No I/O, no clock, no React. The store (store.ts) is the only caller of `step`.
//
// Identity rule, held by shape: `signed_in` has one address field, `account`, which is the wallet's
// current account. The verify answer's wallet is compared with it and dropped. `sessionOf` derives the
// Session from that single field, so a signed-in wallet that differs from the account can't be written.
// Every account change leaves `signed_in`.
//
// Stale-answer rule, held by one comparison: every transition bumps `gen`, every async result arrives
// as an `answer` stamped with the gen of the state that issued it, and `transition` drops any answer
// whose gen is not the current one. Compare generations, not addresses, so A -> B -> A still drops.

import type { Address, Session } from "@/client/contracts";
import type {
  AuthMessage,
  BridgeFailure,
  BridgeResult,
  Challenge,
  ChallengeId,
  ServiceFailure,
  ServiceResult,
  SignatureBase64,
} from "./environment";

export type Gen = number & { readonly __brand: "Gen" };

/** Every visible problem. Copy and the one fixing action live in catalog.ts WALLET_PROBLEMS. */
export type Problem =
  | "no_wallet"
  | "wrong_network"
  | "connect_rejected"
  | "sign_rejected"
  | "cannot_sign"
  | "challenge_stale"
  | "unavailable"
  | "account_switched"
  | "session_expired";

/** The one outstanding operation while signing in. The signature itself is never stored. */
export type SignInStep =
  /** GET session: a cookie for this account skips the signature prompt. */
  | { readonly at: "session" }
  | { readonly at: "challenge" }
  /** Wallet prompt 2 is open. */
  | { readonly at: "signature"; readonly challenge: Challenge }
  /** POST verify. The server may set a cookie. */
  | { readonly at: "verify"; readonly challengeId: ChallengeId };

export type Stage =
  | { readonly kind: "signed_out"; readonly problem: Problem | null }
  /** Wallet prompt 1 is open. */
  | { readonly kind: "connecting" }
  /** Connected but not signed in. Always carries a problem, so there is always a fix to offer. */
  | { readonly kind: "connected"; readonly account: Address; readonly problem: Problem }
  | { readonly kind: "signing_in"; readonly account: Address; readonly step: SignInStep }
  | { readonly kind: "signed_in"; readonly account: Address; readonly expiresAt: string };

export type SessionState = Stage & { readonly gen: Gen };

export type Intent =
  | { readonly type: "connect" }
  | { readonly type: "cancel" }
  | { readonly type: "disconnect" }
  /** The server ended `session` (401 UNAUTHENTICATED, the expiry timer, or the sample panel). */
  | { readonly type: "expired"; readonly session: Session };

export type Answer =
  | { readonly kind: "connect"; readonly result: BridgeResult<Address> }
  | { readonly kind: "signature"; readonly result: BridgeResult<SignatureBase64> }
  | { readonly kind: "session"; readonly result: ServiceResult<Session | null> }
  | { readonly kind: "challenge"; readonly result: ServiceResult<Challenge> }
  | { readonly kind: "verify"; readonly result: ServiceResult<Session> };

export type SessionEvent =
  | Intent
  | { readonly type: "account_changed"; readonly account: Address | null }
  | { readonly type: "answer"; readonly gen: Gen; readonly answer: Answer };

/** I/O the store performs. No payment operation exists here, so sign-in can't request one. */
export type Effect =
  | { readonly kind: "wallet_connect" }
  | { readonly kind: "wallet_sign"; readonly account: Address; readonly message: AuthMessage }
  | { readonly kind: "wallet_disconnect" }
  | { readonly kind: "read_session" }
  | { readonly kind: "request_challenge"; readonly account: Address }
  | { readonly kind: "verify"; readonly challengeId: ChallengeId; readonly signature: SignatureBase64 }
  | { readonly kind: "end_session" }
  | { readonly kind: "watch_expiry"; readonly session: Session };

export type Step = { readonly state: SessionState; readonly effects: readonly Effect[] };

/**
 * The first state, computed identically on the server and the client so hydration matches.
 * Live pages pass `{ account: null, session: null }`. Sample pages pass the persona's wallet and session.
 */
export function initialState(seed: { readonly account: Address | null; readonly session: Session | null }): SessionState {
  const gen = 0 as Gen;
  if (seed.account === null) return { kind: "signed_out", problem: null, gen };
  if (seed.session?.wallet === seed.account) {
    return { kind: "signed_in", account: seed.account, expiresAt: seed.session.expiresAt, gen };
  }
  return { kind: "connected", account: seed.account, problem: "account_switched", gen };
}

/** The identity every screen derives from. The only producer of a viewer Session in the app. */
export function sessionOf(state: SessionState): Session | null {
  return state.kind === "signed_in" ? { wallet: state.account, expiresAt: state.expiresAt } : null;
}

/** The store's only entry point. Same state object back means "ignored": no render, no effects. */
export function step(state: SessionState, event: SessionEvent): Step {
  const stage = transition(state, event);
  if (stage === null) return { state, effects: [] };
  const next: SessionState = { ...stage, gen: (state.gen + 1) as Gen };
  return { state: next, effects: effectsOf(state, event, next) };
}

const SIGNED_OUT: Stage = { kind: "signed_out", problem: null };

/** The transition table. `null` = ignore. Reads gen only for the one stale check. */
function transition(s: SessionState, e: SessionEvent): Stage | null {
  switch (e.type) {
    case "answer":
      return e.gen === s.gen ? onAnswer(s, e.answer) : null;
    case "account_changed":
      return onAccountChanged(s, e.account);
    case "connect":
      if (s.kind === "signed_out") return { kind: "connecting" };
      if (s.kind === "connected") return { kind: "signing_in", account: s.account, step: { at: "session" } };
      return null;
    case "cancel":
      return s.kind === "connecting" || s.kind === "signing_in" ? SIGNED_OUT : null;
    case "disconnect":
      return s.kind === "signed_out" ? null : SIGNED_OUT;
    case "expired":
      return s.kind === "signed_in" && s.account === e.session.wallet && s.expiresAt === e.session.expiresAt
        ? { kind: "connected", account: s.account, problem: "session_expired" }
        : null;
  }
}

function onAccountChanged(s: SessionState, account: Address | null): Stage | null {
  // The bridge reports changes only after connect resolves. While connecting, the connect answer
  // carries the account the user approved in the prompt.
  if (s.kind === "signed_out" || s.kind === "connecting") return null;
  if (account === s.account) return null;
  if (account === null) return SIGNED_OUT;
  // No branch opens a prompt: a switch always waits for the user's Sign in again.
  return { kind: "connected", account, problem: "account_switched" };
}

/** Accepts only the answer kind the current state is waiting for. */
function onAnswer(s: SessionState, a: Answer): Stage | null {
  if (s.kind === "connecting" && a.kind === "connect") {
    return a.result.ok
      ? { kind: "signing_in", account: a.result.value, step: { at: "session" } }
      : { kind: "signed_out", problem: CONNECT_PROBLEM[a.result.failure] };
  }
  if (s.kind !== "signing_in") return null;
  const { account, step } = s;
  const stop = (problem: Problem): Stage => ({ kind: "connected", account, problem });
  const signedIn = (session: Session): Stage => ({ kind: "signed_in", account, expiresAt: session.expiresAt });

  switch (step.at) {
    case "session":
      if (a.kind !== "session") return null;
      if (!a.result.ok) return stop("unavailable");
      // A cookie for another wallet is ended by the cookie rule before the new challenge.
      return a.result.value?.wallet === account ? signedIn(a.result.value) : { kind: "signing_in", account, step: { at: "challenge" } };
    case "challenge":
      if (a.kind !== "challenge") return null;
      return a.result.ok
        ? { kind: "signing_in", account, step: { at: "signature", challenge: a.result.value } }
        : stop(SERVICE_PROBLEM[a.result.failure]);
    case "signature":
      if (a.kind !== "signature") return null;
      if (a.result.ok) return { kind: "signing_in", account, step: { at: "verify", challengeId: step.challenge.id } };
      return stop(a.result.failure === "rejected" ? "sign_rejected" : "unavailable");
    case "verify":
      if (a.kind !== "verify") return null;
      if (!a.result.ok) return stop(SERVICE_PROBLEM[a.result.failure]);
      // A session for another wallet never signs anyone in. The cookie rule ends it.
      return a.result.value.wallet === account ? signedIn(a.result.value) : stop("unavailable");
  }
}

const CONNECT_PROBLEM = {
  rejected: "connect_rejected",
  no_wallet: "no_wallet",
  wrong_network: "wrong_network",
  cannot_sign: "cannot_sign",
  failed: "unavailable",
} as const satisfies Record<BridgeFailure, Problem>;

const SERVICE_PROBLEM = {
  stale_challenge: "challenge_stale",
  unsupported_wallet: "cannot_sign",
  unavailable: "unavailable",
} as const satisfies Record<ServiceFailure, Problem>;

/** Stages where the browser may hold a server session cookie. */
function mayHoldCookie(s: Stage): boolean {
  return s.kind === "signed_in" || (s.kind === "signing_in" && (s.step.at === "session" || s.step.at === "verify"));
}

/**
 * Effects are derived from the transition, never written per case. Exit rules first, then entry,
 * so an end_session queues ahead of the next challenge.
 */
function effectsOf(prev: SessionState, event: SessionEvent, next: SessionState): readonly Effect[] {
  const effects: Effect[] = [];
  // The cookie rule. The store serializes server calls, so this DELETE runs after an in-flight
  // verify settles, which removes a cookie a late verify set for the old wallet.
  if (mayHoldCookie(prev) && next.kind !== "signed_in") effects.push({ kind: "end_session" });
  if ("account" in prev && next.kind === "signed_out") effects.push({ kind: "wallet_disconnect" });
  const entry = entryEffect(event, next);
  if (entry) effects.push(entry);
  return effects;
}

function entryEffect(event: SessionEvent, next: SessionState): Effect | null {
  switch (next.kind) {
    case "signed_out":
    case "connected":
      return null;
    case "connecting":
      return { kind: "wallet_connect" };
    case "signed_in":
      return { kind: "watch_expiry", session: { wallet: next.account, expiresAt: next.expiresAt } };
    case "signing_in":
      switch (next.step.at) {
        case "session":
          return { kind: "read_session" };
        case "challenge":
          return { kind: "request_challenge", account: next.account };
        case "signature":
          return { kind: "wallet_sign", account: next.account, message: next.step.challenge.message };
        case "verify":
          // The signature is read from the answer that entered this step and never stored in state.
          if (event.type !== "answer" || event.answer.kind !== "signature" || !event.answer.result.ok) {
            throw new Error("The verify step is entered only by a signature");
          }
          return { kind: "verify", challengeId: next.step.challengeId, signature: event.answer.result.value };
      }
  }
}
