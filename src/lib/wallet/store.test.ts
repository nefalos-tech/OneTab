import { afterEach, describe, expect, it, vi } from "vitest";
import { termsOf } from "@/client/checkout-view";
import { parseSigningPayload, type Address, type Session } from "@/client/contracts";
import { SAMPLE_WALLETS } from "@/client/fixture-data";
import { FIXTURES } from "@/client/fixtures";
import { keyedPayment } from "@/client/test-support/keyed-payment";
import { paymentCheck, type CheckedPayment } from "@/client/payment-check";
import { wirePayloadFor } from "@/client/payment-fixture";
import {
  authMessage,
  type BridgeResult,
  type ChallengeId,
  type PaymentApproval,
  type Result,
  type ServiceResult,
  type SignatureBase64,
  type SignFailure,
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

describe("the payment prompt", () => {
  const PAYER = SAMPLE_WALLETS.bea;
  const OTHER = SAMPLE_WALLETS.cam;
  const SESSION: Session = { wallet: PAYER, expiresAt: FAR_EXPIRY };
  const APPROVED = "YXBwcm92ZWQ=" as SignatureBase64;
  const room = FIXTURES.signing.snapshot;

  const validated = keyedPayment().then((k) => k.validated);

  async function payment(messageHash = "5a".repeat(32)): Promise<CheckedPayment> {
    const terms = termsOf(room, SESSION)!;
    const payload = parseSigningPayload({ ...wirePayloadFor(room), messageHash })!;
    const value = await validated;
    const checked = await paymentCheck(async () => ({ ok: true, value }), async () => "match").payload(payload, terms, room);
    if (!checked.ok) throw new Error("The sample payment didn't pass the check");
    return checked.value;
  }

  type WalletAnswer = "approves" | "rejects" | "fails" | "throws";
  const ANSWERS: readonly WalletAnswer[] = ["approves", "rejects", "fails", "throws"];
  const RESULT = {
    approves: { ok: true, value: APPROVED },
    rejects: { ok: false, failure: "rejected" },
    fails: { ok: false, failure: "wrong_network" },
  } as const satisfies Record<Exclude<WalletAnswer, "throws">, BridgeResult<SignatureBase64>>;
  const OUTCOME = {
    approves: "approved",
    rejects: "rejected",
    fails: "failed",
    throws: "failed",
  } as const satisfies Record<WalletAnswer, string>;

  function signedIn() {
    const prompts: { readonly payment: CheckedPayment; readonly answer: (a: WalletAnswer) => void }[] = [];
    const world = scripted({
      bridge: {
        connect: async () => ({ ok: true, value: PAYER }),
        signPayment: (p) =>
          new Promise((resolve, reject) => {
            prompts.push({ payment: p, answer: (a) => (a === "throws" ? reject(new Error("provider bug")) : resolve(RESULT[a])) });
          }),
      },
      service: { verify: async () => ({ ok: true, value: SESSION }) },
    });
    const store = createSessionStore(world.environment, initialState({ account: PAYER, session: SESSION }));
    store.start();
    const heard: (string | null)[] = [];
    store.subscribe(() => heard.push(store.waitingOnPrompt()));
    return { store, world, prompts, heard, gen: store.getSnapshot().gen };
  }

  const outcomeOf = (result: Result<PaymentApproval, SignFailure>) =>
    result.ok ? (result.value.signature === APPROVED ? "approved" : "wrong signature") : result.failure;

  type Move = "switches account" | "disconnects" | "sign-in expires";
  function move(world: ReturnType<typeof signedIn>, how: Move): void {
    if (how === "switches account") world.world.switchTo(OTHER);
    if (how === "disconnects") world.store.send({ type: "disconnect" });
    if (how === "sign-in expires") world.store.send({ type: "expired", session: SESSION });
  }

  async function signInAgain({ store, world }: ReturnType<typeof signedIn>) {
    const now = store.getSnapshot();
    if (now.kind === "connected" && now.account !== PAYER) world.switchTo(PAYER);
    store.send({ type: "connect" });
    await settled();
    expect(sessionOf(store.getSnapshot())).toEqual(SESSION);
    return store.getSnapshot().gen;
  }

  describe.each(ANSWERS)("when the wallet %s", (walletAnswer) => {
    it("with no account change, answers with it and holds the prompt until then", async () => {
      const w = signedIn();
      const pay = await payment();
      const pending = w.store.keptOrNewApproval(w.gen, pay);
      expect(w.prompts.map((p) => p.payment)).toEqual([pay]);
      expect(w.store.waitingOnPrompt(), "the page waits on the prompt for this attempt").toBe(pay.attemptId);
      w.prompts[0]!.answer(walletAnswer);
      expect(outcomeOf(await pending)).toBe(OUTCOME[walletAnswer]);
      expect(w.store.waitingOnPrompt()).toBeNull();
      expect(w.heard).toEqual([pay.attemptId, null]);

      const again = w.store.keptOrNewApproval(w.gen, pay);
      if (walletAnswer === "approves") {
        expect(outcomeOf(await again)).toBe("approved");
        expect(w.prompts, "the same message is approved once").toHaveLength(1);
      } else {
        expect(w.prompts, "a refused or failed prompt can be tried again").toHaveLength(2);
      }
    });

    describe.each<Move>(["switches account", "disconnects", "sign-in expires"])("and the payer %s", (how) => {
      it("before the prompt, nothing opens", async () => {
        const w = signedIn();
        move(w, how);
        expect(await w.store.keptOrNewApproval(w.gen, await payment())).toEqual({ ok: false, failure: "stale" });
        expect(w.prompts).toHaveLength(0);
        expect(w.heard.filter((attempt) => attempt !== null), "the page never waited on a prompt").toEqual([]);
      });

      it("during the prompt, the wait ends at once and the answer is dropped", async () => {
        const w = signedIn();
        const pay = await payment();
        const pending = w.store.keptOrNewApproval(w.gen, pay);
        move(w, how);
        expect(await pending).toEqual({ ok: false, failure: "stale" });
        expect(w.store.waitingOnPrompt()).toBeNull();
        w.prompts[0]!.answer(walletAnswer);
        await settled();

        const gen = await signInAgain(w);
        void w.store.keptOrNewApproval(gen, pay);
        expect(w.prompts, "the dropped answer is never reused").toHaveLength(2);
      });

      it("after the answer, the old signer is stale and the new sign-in asks again", async () => {
        const w = signedIn();
        const pay = await payment();
        const pending = w.store.keptOrNewApproval(w.gen, pay);
        w.prompts[0]!.answer(walletAnswer);
        expect(outcomeOf(await pending)).toBe(OUTCOME[walletAnswer]);
        move(w, how);
        expect(await w.store.keptOrNewApproval(w.gen, pay)).toEqual({ ok: false, failure: "stale" });

        const gen = await signInAgain(w);
        void w.store.keptOrNewApproval(gen, pay);
        expect(w.prompts, "an approval belongs to the sign-in that asked for it").toHaveLength(2);
      });
    });
  });

  it("a second call while the prompt is open is busy and opens nothing, and a later one asks again", async () => {
    const w = signedIn();
    const first = w.store.keptOrNewApproval(w.gen, await payment());
    expect(await w.store.keptOrNewApproval(w.gen, await payment())).toEqual({ ok: false, failure: "busy" });
    expect(await w.store.keptOrNewApproval(w.gen, await payment("6b".repeat(32)))).toEqual({ ok: false, failure: "busy" });
    expect(w.prompts).toHaveLength(1);
    w.prompts[0]!.answer("approves");
    expect(outcomeOf(await first)).toBe("approved");
    void w.store.keptOrNewApproval(w.gen, await payment("6b".repeat(32)));
    expect(w.prompts, "another message asks again").toHaveLength(2);
  });

  it("Cancel ends the wait as a refusal, the wallet's prompt stays the only one until it answers, and its late approval is dropped", async () => {
    const w = signedIn();
    const pay = await payment();
    const pending = w.store.keptOrNewApproval(w.gen, pay);
    w.store.cancelPayment();
    expect(await pending).toEqual({ ok: false, failure: "rejected" });
    expect(w.store.waitingOnPrompt()).toBeNull();
    expect(w.heard).toEqual([pay.attemptId, null]);
    expect(await w.store.keptOrNewApproval(w.gen, pay)).toEqual({ ok: false, failure: "busy" });

    w.prompts[0]!.answer("approves");
    await settled();
    void w.store.keptOrNewApproval(w.gen, pay);
    expect(w.prompts, "the approval after Cancel isn't kept").toHaveLength(2);
  });

  it("Cancel with no payment prompt open changes nothing", () => {
    const w = signedIn();
    w.store.cancelPayment();
    expect(w.heard).toEqual([]);
    expect(sessionOf(w.store.getSnapshot())).toEqual(SESSION);
  });

  it("a wallet that throws, at once or later, reads as failed and frees the prompt", async () => {
    for (const signPayment of [
      () => {
        throw new Error("provider bug");
      },
      () => Promise.reject(new Error("provider bug")),
    ]) {
      const world = scripted({ bridge: { signPayment }, service: { verify: async () => ({ ok: true, value: SESSION }) } });
      const store = createSessionStore(world.environment, initialState({ account: PAYER, session: SESSION }));
      const gen = store.getSnapshot().gen;
      expect(await store.keptOrNewApproval(gen, await payment())).toEqual({ ok: false, failure: "failed" });
      expect(store.waitingOnPrompt()).toBeNull();
      expect(await store.keptOrNewApproval(gen, await payment()), "the prompt was freed").toEqual({ ok: false, failure: "failed" });
    }
  });

  it("forgets a kept approval when told, so the next call for that message asks the wallet again", async () => {
    const w = signedIn();
    const pay = await payment();
    const first = w.store.keptOrNewApproval(w.gen, pay);
    w.prompts[0]!.answer("approves");
    const approved = await first;
    if (!approved.ok) throw new Error("The wallet approved");
    w.store.forgetApproval(w.gen, { ...approved.value, signature: "b3RoZXI=" as SignatureBase64 });
    expect(await w.store.keptOrNewApproval(w.gen, pay), "another approval leaves the kept one").toEqual(approved);
    w.store.forgetApproval(w.gen, approved.value);
    void w.store.keptOrNewApproval(w.gen, pay);
    expect(w.prompts, "a forgotten approval is asked for again").toHaveLength(2);
  });

  it.each<Move>(["switches account", "disconnects", "sign-in expires"])("the sign-in is no longer current once the payer %s", async (how) => {
    const w = signedIn();
    expect(w.store.isCurrent(w.gen, PAYER)).toBe(true);
    expect(w.store.isCurrent(w.gen, OTHER)).toBe(false);
    move(w, how);
    expect(w.store.isCurrent(w.gen, PAYER)).toBe(false);
  });

  it("refuses a payment for another account than the one signed in, with no prompt", async () => {
    const w = signedIn();
    const theirs = { ...(await payment()), account: OTHER };
    expect(await w.store.keptOrNewApproval(w.gen, theirs)).toEqual({ ok: false, failure: "stale" });
    expect(w.prompts).toHaveLength(0);
  });

  it("asks nothing of a wallet that isn't signed in", async () => {
    const world = scripted({ bridge: { signPayment: () => Promise.reject(new Error("prompted")) } });
    const store = createSessionStore(world.environment, initialState({ account: PAYER, session: null }));
    expect(await store.keptOrNewApproval(store.getSnapshot().gen, await payment())).toEqual({ ok: false, failure: "stale" });
  });
});
