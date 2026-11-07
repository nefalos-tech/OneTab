import { describe, expect, it } from "vitest";
import type { Address } from "@/client/contracts";
import { authMessage, type Challenge, type ChallengeId, type SignatureBase64 } from "./environment";
import {
  initialState,
  sessionOf,
  step,
  type Answer,
  type Effect,
  type Gen,
  type SessionEvent,
  type SessionState,
} from "./machine";

const A = "SAMPLEpayerBea1111111111111111111111111Bea2" as Address;
const B = "SAMPLEpayerCam1111111111111111111111111Cam3" as Address;
const EXP_1 = "2099-01-01T00:00:00.000Z";
const EXP_2 = "2099-06-01T00:00:00.000Z";
const SIGNATURE = "c2FtcGxlLXNpZ25hdHVyZQ==" as SignatureBase64;
const MESSAGE = authMessage(new TextEncoder().encode("Sign in to OneTab. Signing in can't move money."))!;
const CHALLENGE: Challenge = { id: "challenge-1" as ChallengeId, message: MESSAGE };
const DEPTH = 8;

type World = { readonly wallet: Address | null };
type Move = { readonly event: SessionEvent; readonly world: World };

const SEEDS: readonly { readonly state: SessionState; readonly world: World }[] = [
  { state: initialState({ account: null, session: null }), world: { wallet: null } },
  { state: initialState({ account: A, session: { wallet: A, expiresAt: EXP_1 } }), world: { wallet: A } },
  { state: initialState({ account: A, session: { wallet: B, expiresAt: EXP_1 } }), world: { wallet: A } },
];

const ANY_ANSWER: readonly Answer[] = [
  { kind: "connect", result: { ok: true, value: A } },
  { kind: "connect", result: { ok: true, value: B } },
  { kind: "connect", result: { ok: false, failure: "rejected" } },
  { kind: "session", result: { ok: true, value: null } },
  { kind: "session", result: { ok: true, value: { wallet: A, expiresAt: EXP_1 } } },
  { kind: "session", result: { ok: true, value: { wallet: B, expiresAt: EXP_1 } } },
  { kind: "challenge", result: { ok: true, value: CHALLENGE } },
  { kind: "challenge", result: { ok: false, failure: "unavailable" } },
  { kind: "signature", result: { ok: true, value: SIGNATURE } },
  { kind: "signature", result: { ok: false, failure: "rejected" } },
  { kind: "verify", result: { ok: true, value: { wallet: A, expiresAt: EXP_2 } } },
  { kind: "verify", result: { ok: true, value: { wallet: B, expiresAt: EXP_2 } } },
  { kind: "verify", result: { ok: false, failure: "stale_challenge" } },
];

function moves(s: SessionState, w: World): readonly Move[] {
  const at = (event: SessionEvent, world: World = w): Move => ({ event, world });
  const session = sessionOf(s);
  return [
    at({ type: "connect" }),
    at({ type: "cancel" }),
    at({ type: "disconnect" }),
    at({ type: "account_changed", account: A }, { wallet: A }),
    at({ type: "account_changed", account: B }, { wallet: B }),
    at({ type: "account_changed", account: null }, { wallet: null }),
    at({ type: "expired", session: { wallet: A, expiresAt: EXP_1 } }),
    ...(session ? [at({ type: "expired", session })] : []),
    ...ANY_ANSWER.map((answer) =>
      at(
        { type: "answer", gen: s.gen, answer },
        answer.kind === "connect" && answer.result.ok && s.kind === "connecting" ? { wallet: answer.result.value } : w,
      ),
    ),
    ...ANY_ANSWER.map((answer) => at({ type: "answer", gen: (s.gen - 1) as Gen, answer })),
  ];
}

function memoKeyIgnoringGen(s: SessionState, w: World): string {
  return JSON.stringify([{ ...s, gen: undefined }, w.wallet]);
}

const kinds = (effects: readonly Effect[]): readonly string[] => effects.map((e) => e.kind);

describe("session machine, every sequence up to DEPTH events", () => {
  it("keeps the identity rule and the stale-answer rule after every step", () => {
    const seen = new Set<string>();
    const reached = new Set<string>();
    let steps = 0;

    const explore = (s: SessionState, w: World, remaining: number): void => {
      const k = `${memoKeyIgnoringGen(s, w)}|${remaining}`;
      if (remaining === 0 || seen.has(k)) return;
      seen.add(k);
      for (const { event, world } of moves(s, w)) {
        const { state: next, effects } = step(s, event);
        steps++;
        const trail = `${JSON.stringify(event)} from ${memoKeyIgnoringGen(s, w)}`;

        const identity = sessionOf(next);
        expect(identity === null || identity.wallet === world.wallet, `identity rule: ${trail}`).toBe(true);

        if (event.type === "answer" && event.gen !== s.gen) {
          expect(next, `stale answer changed state: ${trail}`).toBe(s);
          expect(effects, `stale answer had effects: ${trail}`).toEqual([]);
        }

        const prompts = effects.filter((e) => e.kind === "wallet_connect" || e.kind === "wallet_sign");
        if (event.type === "account_changed") expect(prompts, `a switch opened a prompt: ${trail}`).toEqual([]);
        if (prompts.length > 0) {
          expect(event.type === "connect" || (event.type === "answer" && event.gen === s.gen), `unasked prompt: ${trail}`).toBe(true);
        }

        if (s.kind === "signed_in" && next !== s && next.kind !== "signed_in") {
          expect(kinds(effects), `left signed in without ending the session: ${trail}`).toContain("end_session");
        }
        const order = kinds(effects);
        if (order.includes("end_session") && order.includes("request_challenge")) {
          expect(order.indexOf("end_session"), `challenge before end_session: ${trail}`).toBeLessThan(order.indexOf("request_challenge"));
        }

        expect(JSON.stringify(next), `signature stored in state: ${trail}`).not.toContain(SIGNATURE);

        reached.add(next.kind === "signing_in" ? `signing_in.${next.step.at}` : next.kind);
        explore(next, world, remaining - 1);
      }
    };
    const started = performance.now();
    for (const seed of SEEDS) explore(seed.state, seed.world, DEPTH);
    console.info(`exhaustive machine check: ${seen.size} visits, ${steps} steps, ${Math.round(performance.now() - started)} ms`);

    expect([...reached].sort()).toEqual(
      [
        "connected",
        "connecting",
        "signed_in",
        "signed_out",
        "signing_in.challenge",
        "signing_in.session",
        "signing_in.signature",
        "signing_in.verify",
      ].sort(),
    );
  });
});

type Play = SessionEvent | ((s: SessionState) => SessionEvent);

function play(start: SessionState, ...events: readonly Play[]): { readonly state: SessionState; readonly effects: readonly Effect[] } {
  let current: { state: SessionState; effects: readonly Effect[] } = { state: start, effects: [] };
  for (const e of events) current = step(current.state, typeof e === "function" ? e(current.state) : e);
  return current;
}

const reply =
  (answer: Answer) =>
  (s: SessionState): SessionEvent => ({ type: "answer", gen: s.gen, answer });
const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const signedOut = initialState({ account: null, session: null });
const signedInA = initialState({ account: A, session: { wallet: A, expiresAt: EXP_1 } });
const switchTo = (account: Address | null): SessionEvent => ({ type: "account_changed", account });

function signingIn(account: Address, until: "session" | "challenge" | "signature" | "verify"): SessionState {
  const path: Play[] = [{ type: "connect" }, reply({ kind: "connect", result: ok(account) })];
  if (until !== "session") path.push(reply({ kind: "session", result: ok(null) }));
  if (until === "signature" || until === "verify") path.push(reply({ kind: "challenge", result: ok(CHALLENGE) }));
  if (until === "verify") path.push(reply({ kind: "signature", result: ok(SIGNATURE) }));
  const { state } = play(signedOut, ...path);
  expect(state).toMatchObject({ kind: "signing_in", account, step: { at: until } });
  return state;
}

describe("session machine, named races", () => {
  it("signs in with two prompts, then watches the expiry, and never asks for a payment", () => {
    const steps: { kind: string; effects: readonly string[] }[] = [];
    let s = signedOut;
    for (const e of [
      { type: "connect" },
      reply({ kind: "connect", result: ok(A) }),
      reply({ kind: "session", result: ok(null) }),
      reply({ kind: "challenge", result: ok(CHALLENGE) }),
      reply({ kind: "signature", result: ok(SIGNATURE) }),
      reply({ kind: "verify", result: ok({ wallet: A, expiresAt: EXP_2 }) }),
    ] satisfies Play[]) {
      const next = step(s, typeof e === "function" ? e(s) : e);
      steps.push({ kind: next.state.kind, effects: kinds(next.effects) });
      s = next.state;
    }
    expect(steps).toEqual([
      { kind: "connecting", effects: ["wallet_connect"] },
      { kind: "signing_in", effects: ["read_session"] },
      { kind: "signing_in", effects: ["end_session", "request_challenge"] },
      { kind: "signing_in", effects: ["wallet_sign"] },
      { kind: "signing_in", effects: ["verify"] },
      { kind: "signed_in", effects: ["watch_expiry"] },
    ]);
    expect(sessionOf(s)).toEqual({ wallet: A, expiresAt: EXP_2 });
  });

  it("signs the challenge's own message with the connected account and verifies with that signature", () => {
    const sign = play(signingIn(A, "challenge"), reply({ kind: "challenge", result: ok(CHALLENGE) }));
    expect(sign.effects).toEqual([{ kind: "wallet_sign", account: A, message: MESSAGE }]);
    const verify = play(sign.state, reply({ kind: "signature", result: ok(SIGNATURE) }));
    expect(verify.effects).toEqual([{ kind: "verify", challengeId: CHALLENGE.id, signature: SIGNATURE }]);
  });

  it("a double click on Connect wallet opens one prompt", () => {
    const first = step(signedOut, { type: "connect" });
    const second = step(first.state, { type: "connect" });
    expect(second.state).toBe(first.state);
    expect(second.effects).toEqual([]);
  });

  it("an account change during the sign-in prompt drops the signature and never verifies", () => {
    const prompt = signingIn(A, "signature");
    const switched = step(prompt, switchTo(B));
    expect(switched.state).toMatchObject({ kind: "connected", account: B, problem: "account_switched" });
    expect(switched.effects).toEqual([]);
    const late = step(switched.state, { type: "answer", gen: prompt.gen, answer: { kind: "signature", result: ok(SIGNATURE) } });
    expect(late.state).toBe(switched.state);
    expect(late.effects).toEqual([]);
  });

  it("a late answer from before A to B to A changes nothing", () => {
    const prompt = signingIn(A, "signature");
    const back = play(prompt, switchTo(B), switchTo(A));
    expect(back.state).toMatchObject({ kind: "connected", account: A, problem: "account_switched" });
    const late = step(back.state, { type: "answer", gen: prompt.gen, answer: { kind: "signature", result: ok(SIGNATURE) } });
    expect(late.state).toBe(back.state);
    expect(sessionOf(late.state)).toBeNull();
  });

  it("a switch while verify is in flight ends the session the server may set for the old wallet", () => {
    const verifying = signingIn(A, "verify");
    const switched = step(verifying, switchTo(B));
    expect(switched.state).toMatchObject({ kind: "connected", account: B, problem: "account_switched" });
    expect(switched.effects).toEqual([{ kind: "end_session" }]);
    const late = step(switched.state, { type: "answer", gen: verifying.gen, answer: { kind: "verify", result: ok({ wallet: A, expiresAt: EXP_2 }) } });
    expect(sessionOf(late.state)).toBeNull();
  });

  it("a verify answer for another wallet signs nobody in and ends that session", () => {
    const { state, effects } = play(signingIn(A, "verify"), reply({ kind: "verify", result: ok({ wallet: B, expiresAt: EXP_2 }) }));
    expect(sessionOf(state)).toBeNull();
    expect(state).toMatchObject({ kind: "connected", account: A, problem: "unavailable" });
    expect(effects).toEqual([{ kind: "end_session" }]);
  });

  it("an expired session asks the same wallet to sign in again without a connection prompt", () => {
    const expired = step(signedInA, { type: "expired", session: { wallet: A, expiresAt: EXP_1 } });
    expect(expired.state).toMatchObject({ kind: "connected", account: A, problem: "session_expired" });
    expect(expired.effects).toEqual([{ kind: "end_session" }]);
    const again = step(expired.state, { type: "connect" });
    expect(again.state).toMatchObject({ kind: "signing_in", account: A, step: { at: "session" } });
    expect(again.effects).toEqual([{ kind: "read_session" }]);
  });

  it("a report about an earlier session does not sign out the current one", () => {
    const report = step(signedInA, { type: "expired", session: { wallet: A, expiresAt: EXP_2 } });
    expect(report.state).toBe(signedInA);
  });

  it("a matching cookie skips the signature prompt", () => {
    const { state, effects } = play(signingIn(A, "session"), reply({ kind: "session", result: ok({ wallet: A, expiresAt: EXP_1 }) }));
    expect(sessionOf(state)).toEqual({ wallet: A, expiresAt: EXP_1 });
    expect(effects).toEqual([{ kind: "watch_expiry", session: { wallet: A, expiresAt: EXP_1 } }]);
  });

  it("a cookie for A while the wallet is on B is ended before B asks for a challenge", () => {
    const { state, effects } = play(signingIn(B, "session"), reply({ kind: "session", result: ok({ wallet: A, expiresAt: EXP_1 }) }));
    expect(sessionOf(state)).toBeNull();
    expect(effects).toEqual([{ kind: "end_session" }, { kind: "request_challenge", account: B }]);
  });

  it("an expired or used challenge asks for a fresh sign-in and resubmits nothing", () => {
    const { state, effects } = play(signingIn(A, "verify"), reply({ kind: "verify", result: { ok: false, failure: "stale_challenge" } }));
    expect(state).toMatchObject({ kind: "connected", account: A, problem: "challenge_stale" });
    expect(effects).toEqual([{ kind: "end_session" }]);
  });

  it("a refused signature moves nothing and offers Sign in again", () => {
    const { state, effects } = play(signingIn(A, "signature"), reply({ kind: "signature", result: { ok: false, failure: "rejected" } }));
    expect(state).toMatchObject({ kind: "connected", account: A, problem: "sign_rejected" });
    expect(effects).toEqual([]);
  });

  it("a refused connection shares nothing", () => {
    const { state, effects } = play(signedOut, { type: "connect" }, reply({ kind: "connect", result: { ok: false, failure: "rejected" } }));
    expect(state).toMatchObject({ kind: "signed_out", problem: "connect_rejected" });
    expect(effects).toEqual([]);
  });

  it("a connection approved after Cancel is ignored", () => {
    const connecting = step(signedOut, { type: "connect" }).state;
    const cancelled = step(connecting, { type: "cancel" });
    expect(cancelled.state).toMatchObject({ kind: "signed_out", problem: null });
    const late = step(cancelled.state, { type: "answer", gen: connecting.gen, answer: { kind: "connect", result: ok(A) } });
    expect(late.state).toBe(cancelled.state);
  });

  it("an unregistered wallet signs out and clears the connection", () => {
    const { state, effects } = step(signedInA, switchTo(null));
    expect(state).toMatchObject({ kind: "signed_out", problem: null });
    expect(effects).toEqual([{ kind: "end_session" }, { kind: "wallet_disconnect" }]);
  });

  it("Disconnect signs out at once and waits for no answer", () => {
    const { state, effects } = step(signedInA, { type: "disconnect" });
    expect(sessionOf(state)).toBeNull();
    expect(state).toMatchObject({ kind: "signed_out", problem: null });
    expect(effects).toEqual([{ kind: "end_session" }, { kind: "wallet_disconnect" }]);
  });

  it("a switched account is named and the old identity is gone", () => {
    const { state } = step(signedInA, switchTo(B));
    expect(sessionOf(state)).toBeNull();
    expect(state).toMatchObject({ kind: "connected", account: B, problem: "account_switched" });
  });

  it("a page starts signed in only when the persona's session is the wallet's account", () => {
    expect(sessionOf(initialState({ account: A, session: { wallet: A, expiresAt: EXP_1 } }))).toEqual({ wallet: A, expiresAt: EXP_1 });
    expect(sessionOf(initialState({ account: A, session: { wallet: B, expiresAt: EXP_1 } }))).toBeNull();
    expect(initialState({ account: null, session: null })).toMatchObject({ kind: "signed_out", problem: null });
  });
});

describe("sign-in messages", () => {
  it("accepts printable text and refuses transaction bytes, control bytes and invalid UTF-8", () => {
    expect(authMessage(new TextEncoder().encode("Sign in to OneTab.\nNonce 7"))?.text).toBe("Sign in to OneTab.\nNonce 7");
    expect(authMessage(Uint8Array.from([0x01, 0x00, 0x03, 0x05]))).toBeNull();
    expect(authMessage(Uint8Array.from([0x80, 0x01, 0x00]))).toBeNull();
    expect(authMessage(new TextEncoder().encode("Sign in\u0007"))).toBeNull();
    expect(authMessage(new Uint8Array())).toBeNull();
  });
});
