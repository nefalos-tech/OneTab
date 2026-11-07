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

export type SignInStep =
  | { readonly at: "session" }
  | { readonly at: "challenge" }
  | { readonly at: "signature"; readonly challenge: Challenge }
  | { readonly at: "verify"; readonly challengeId: ChallengeId };

export type Stage =
  | { readonly kind: "signed_out"; readonly problem: Problem | null }
  | { readonly kind: "connecting" }
  | { readonly kind: "connected"; readonly account: Address; readonly problem: Problem }
  | { readonly kind: "signing_in"; readonly account: Address; readonly step: SignInStep }
  | { readonly kind: "signed_in"; readonly account: Address; readonly expiresAt: string };

export type SessionState = Stage & { readonly gen: Gen };

export type Intent =
  | { readonly type: "connect" }
  | { readonly type: "cancel" }
  | { readonly type: "disconnect" }
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

export function initialState(seed: { readonly account: Address | null; readonly session: Session | null }): SessionState {
  const gen = 0 as Gen;
  if (seed.account === null) return { kind: "signed_out", problem: null, gen };
  if (seed.session?.wallet === seed.account) {
    return { kind: "signed_in", account: seed.account, expiresAt: seed.session.expiresAt, gen };
  }
  return { kind: "connected", account: seed.account, problem: "account_switched", gen };
}

export function sessionOf(state: SessionState): Session | null {
  return state.kind === "signed_in" ? { wallet: state.account, expiresAt: state.expiresAt } : null;
}

export function step(state: SessionState, event: SessionEvent): Step {
  const stage = transition(state, event);
  if (stage === null) return { state, effects: [] };
  const next: SessionState = { ...stage, gen: (state.gen + 1) as Gen };
  return { state: next, effects: effectsOf(state, event, next) };
}

const SIGNED_OUT: Stage = { kind: "signed_out", problem: null };

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
  if (s.kind === "signed_out" || s.kind === "connecting") return null;
  if (account === s.account) return null;
  if (account === null) return SIGNED_OUT;
  return { kind: "connected", account, problem: "account_switched" };
}

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

function mayHoldCookie(s: Stage): boolean {
  return s.kind === "signed_in" || (s.kind === "signing_in" && (s.step.at === "session" || s.step.at === "verify"));
}

function effectsOf(prev: SessionState, event: SessionEvent, next: SessionState): readonly Effect[] {
  const effects: Effect[] = [];
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
          if (event.type !== "answer" || event.answer.kind !== "signature" || !event.answer.result.ok) {
            throw new Error("The verify step is entered only by a signature");
          }
          return { kind: "verify", challengeId: next.step.challengeId, signature: event.answer.result.value };
      }
  }
}
