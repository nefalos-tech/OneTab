import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Session } from "@/client/contracts";
import type { CheckedPayment } from "@/client/payment-check";
import {
  authMessage,
  type ChallengeId,
  type ServiceResult,
  type SignatureBase64,
  type SignInService,
  type WalletBridge,
} from "./environment";
import { initialState, sessionOf, type SessionState } from "./machine";
import { sampleEnvironment, type SampleWalletSeed } from "./sample";
import { createSessionStore } from "./store";

const ORGANIZER = "SAMPLEorganizer11111111111111111111111111org1" as Address;
const BEA = "SAMPLEpayerBea1111111111111111111111111Bea2" as Address;
const CAM = "SAMPLEpayerCam1111111111111111111111111Cam3" as Address;
const SEED: SampleWalletSeed = {
  accounts: [
    { label: "Organizer", wallet: ORGANIZER },
    { label: "Bea", wallet: BEA },
    { label: "Cam", wallet: CAM },
  ],
  selected: BEA,
};
const FAR_EXPIRY = "2099-01-01T00:00:00.000Z";
const SIGNATURE = "c2ln" as SignatureBase64;
const CHALLENGE = { id: "c-1" as ChallengeId, message: authMessage(new TextEncoder().encode("Sign in to OneTab."))! };

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function scripted(overrides: { readonly bridge?: Partial<WalletBridge>; readonly service?: Partial<SignInService> } = {}) {
  const log: string[] = [];
  let accountListener: (account: Address | null) => void = () => {};
  const bridge: WalletBridge = {
    connect: async () => ({ ok: true, value: BEA }),
    disconnect: async () => void log.push("wallet_disconnect"),
    signAuthentication: async () => ({ ok: true, value: SIGNATURE }),
    signPayment: async () => ({ ok: false, failure: "failed" }),
    onAccountChange: (listener) => {
      accountListener = listener;
      return () => {};
    },
    ...overrides.bridge,
  };
  const service: SignInService = {
    readSession: async () => (log.push("read_session"), { ok: true, value: null }),
    requestChallenge: async () => (log.push("request_challenge"), { ok: true, value: CHALLENGE }),
    verify: async () => (log.push("verify"), { ok: true, value: { wallet: BEA, expiresAt: FAR_EXPIRY } }),
    endSession: async () => void log.push("end_session"),
    ...overrides.service,
  };
  return { environment: { bridge, service }, log, switchTo: (account: Address | null) => accountListener(account) };
}

const signedOut = initialState({ account: null, session: null });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("session store", () => {
  it("runs the DELETE for a switch only after the in-flight verify settles", async () => {
    const verify = deferred<ServiceResult<Session>>();
    const world = scripted({ service: { verify: () => (world.log.push("verify"), verify.promise) } });
    const store = createSessionStore(world.environment, signedOut);
    store.start();
    store.send({ type: "connect" });
    await settled();
    expect(store.getSnapshot()).toMatchObject({ kind: "signing_in", step: { at: "verify" } });

    world.switchTo(CAM);
    expect(store.getSnapshot()).toMatchObject({ kind: "connected", account: CAM, problem: "account_switched" });
    await settled();
    expect(world.log.at(-1)).toBe("verify");

    verify.resolve({ ok: true, value: { wallet: BEA, expiresAt: FAR_EXPIRY } });
    await settled();
    expect(world.log.slice(-2)).toEqual(["verify", "end_session"]);
    expect(sessionOf(store.getSnapshot())).toBeNull();
  });

  it("Disconnect signs out at once while the server call hangs", async () => {
    const world = scripted({ service: { endSession: () => (world.log.push("end_session"), new Promise<void>(() => {})) } });
    const store = createSessionStore(world.environment, initialState({ account: BEA, session: { wallet: BEA, expiresAt: FAR_EXPIRY } }));
    store.send({ type: "disconnect" });
    expect(store.getSnapshot()).toMatchObject({ kind: "signed_out", problem: null });
    await settled();
    expect([...world.log].sort()).toEqual(["end_session", "wallet_disconnect"]);
    expect(store.getSnapshot()).toMatchObject({ kind: "signed_out", problem: null });
  });

  it("a wallet adapter that throws reads as unavailable, never as a refusal", async () => {
    const world = scripted({ bridge: { connect: () => Promise.reject(new Error("provider bug")) } });
    const store = createSessionStore(world.environment, signedOut);
    store.send({ type: "connect" });
    await settled();
    expect(store.getSnapshot()).toMatchObject({ kind: "signed_out", problem: "unavailable" });
  });

  it("ends a session when its expiry arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-07T12:00:00.000Z"));
    const expiresAt = "2026-11-07T12:15:00.000Z";
    const world = scripted({ service: { verify: async () => ({ ok: true, value: { wallet: BEA, expiresAt } }) } });
    const store = createSessionStore(world.environment, signedOut);
    store.send({ type: "connect" });
    await settled();
    expect(sessionOf(store.getSnapshot())).toEqual({ wallet: BEA, expiresAt });

    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(sessionOf(store.getSnapshot())).not.toBeNull();
    vi.advanceTimersByTime(60 * 1000);
    expect(store.getSnapshot()).toMatchObject({ kind: "connected", account: BEA, problem: "session_expired" });
  });

  it("schedules nothing for an expiry past setTimeout's ceiling", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const store = createSessionStore(scripted().environment, signedOut);
    store.send({ type: "connect" });
    await settled();
    expect(sessionOf(store.getSnapshot())).toEqual({ wallet: BEA, expiresAt: FAR_EXPIRY });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("session store with the sample wallet", () => {
  function sample(session: Session | null = null) {
    const env = sampleEnvironment(SEED, session);
    const store = createSessionStore(env.environment, env.initial);
    store.start();
    return { store, wallet: env.wallet, state: (): SessionState => store.getSnapshot() };
  }

  it("signs in with two prompts and never touches the network", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("sample data called a real route")));
    vi.stubGlobal("fetch", fetch);
    const { store, wallet, state } = sample();

    store.send({ type: "connect" });
    expect(wallet.view().prompt).toEqual({ kind: "connect" });
    wallet.approve();
    await settled();
    expect(wallet.view().prompt).toMatchObject({ kind: "sign", account: BEA });
    expect(wallet.view().prompt).toHaveProperty("text", expect.stringContaining("can't move money"));
    wallet.approve();
    await settled();

    expect(sessionOf(state())).toEqual({ wallet: BEA, expiresAt: FAR_EXPIRY });
    expect(wallet.view().prompt).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a connection approved after Cancel leaves the page signed out", async () => {
    const { store, wallet, state } = sample();
    store.send({ type: "connect" });
    store.send({ type: "cancel" });
    wallet.approve();
    await settled();
    expect(state()).toMatchObject({ kind: "signed_out", problem: null });
  });

  it("a switch during the sign prompt, then a late Approve, signs nobody in", async () => {
    const { store, wallet, state } = sample();
    store.send({ type: "connect" });
    wallet.approve();
    await settled();
    expect(wallet.view().prompt?.kind).toBe("sign");

    wallet.select(CAM);
    wallet.approve();
    await settled();
    expect(sessionOf(state())).toBeNull();
    expect(state()).toMatchObject({ kind: "connected", account: CAM, problem: "account_switched" });
  });

  it("a switch while signed in drops the old payer, and Sign in again opens only the sign prompt", async () => {
    const { store, wallet, state } = sample({ wallet: BEA, expiresAt: FAR_EXPIRY });
    expect(sessionOf(state())?.wallet).toBe(BEA);

    wallet.select(CAM);
    expect(sessionOf(state())).toBeNull();
    expect(state()).toMatchObject({ kind: "connected", account: CAM, problem: "account_switched" });

    store.send({ type: "connect" });
    await settled();
    expect(wallet.view().prompt).toMatchObject({ kind: "sign", account: CAM });
    wallet.approve();
    await settled();
    expect(sessionOf(state())?.wallet).toBe(CAM);
  });

  it("after the sign-in ends, Sign in again restores the same wallet", async () => {
    const { store, wallet, state } = sample({ wallet: BEA, expiresAt: FAR_EXPIRY });
    store.send({ type: "expired", session: { wallet: BEA, expiresAt: FAR_EXPIRY } });
    expect(state()).toMatchObject({ kind: "connected", account: BEA, problem: "session_expired" });

    store.send({ type: "connect" });
    await settled();
    expect(wallet.view().prompt).toMatchObject({ kind: "sign", account: BEA });
    wallet.approve();
    await settled();
    expect(sessionOf(state())?.wallet).toBe(BEA);
  });

  it("refusing either prompt moves nothing and signs nobody in", async () => {
    const { store, wallet, state } = sample();
    store.send({ type: "connect" });
    wallet.reject();
    await settled();
    expect(state()).toMatchObject({ kind: "signed_out", problem: "connect_rejected" });

    store.send({ type: "connect" });
    wallet.approve();
    await settled();
    wallet.reject();
    await settled();
    expect(state()).toMatchObject({ kind: "connected", account: BEA, problem: "sign_rejected" });
  });

  it("refuses a payment approval without opening a prompt", async () => {
    const env = sampleEnvironment(SEED, { wallet: BEA, expiresAt: FAR_EXPIRY });
    const result = await env.environment.bridge.signPayment({ account: BEA } as CheckedPayment);
    expect(result).toEqual({ ok: false, failure: "failed" });
    expect(env.wallet.view().prompt).toBeNull();
  });
});
