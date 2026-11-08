import { getWallets } from "@wallet-standard/app";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "@/client/contracts";
import type { ChallengeId, SignatureBase64 } from "./environment";
import { liveEnvironment, liveSignInService, type FetchLike } from "./live";

vi.mock(import("@wallet-standard/app"), async (actual) => ({ getWallets: vi.fn((await actual()).getWallets) }));

const WALLET = "SAMPLEpayerBea1111111111111111111111111Bea2" as Address;
const EXPIRES = "2099-01-01T00:00:00.000Z";
const MESSAGE = "Sign in to OneTab as SAMP…Bea2. Signing in can't move money.";

type Call = { readonly path: string; readonly init: RequestInit };

function stubFetch(respond: (call: Call) => Response | Promise<Response>): { readonly fetch: FetchLike; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (path, init) => {
      const call = { path, init };
      calls.push(call);
      return respond(call);
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errorBody = (code: string) => ({ error: { code, message: "Something the browser never shows." } });
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const challengeBody = (messageBase64: string) => ({ data: { challengeId: "c-1", messageBase64, expiresAt: EXPIRES } });

describe("live sign-in service", () => {
  it("sends each auth route with the same-origin cookie, no-store and the contract's body", async () => {
    const { fetch, calls } = stubFetch(({ path, init }) =>
      path === "/api/auth/challenge"
        ? json(200, challengeBody(base64(new TextEncoder().encode(MESSAGE))))
        : init.method === "DELETE" || init.method === "GET"
          ? json(200, { data: null })
          : json(200, { data: { wallet: WALLET, expiresAt: EXPIRES } }),
    );
    const service = liveSignInService(fetch);
    await service.readSession();
    await service.requestChallenge(WALLET);
    await service.verify({ challengeId: "c-1" as ChallengeId, signature: "c2ln" as SignatureBase64 });
    await service.endSession();

    expect(calls.map((c) => [c.init.method, c.path, c.init.body ?? null])).toEqual([
      ["GET", "/api/auth/session", null],
      ["POST", "/api/auth/challenge", JSON.stringify({ wallet: WALLET })],
      ["POST", "/api/auth/verify", JSON.stringify({ challengeId: "c-1", signatureBase64: "c2ln" })],
      ["DELETE", "/api/auth/session", null],
    ]);
    for (const { init } of calls) {
      expect(init.credentials).toBe("same-origin");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("reads a session, and reads both null and 401 as signed out", async () => {
    const read = (response: Response) => liveSignInService(stubFetch(() => response).fetch).readSession();
    expect(await read(json(200, { data: { wallet: WALLET, expiresAt: EXPIRES } }))).toEqual({
      ok: true,
      value: { wallet: WALLET, expiresAt: EXPIRES },
    });
    expect(await read(json(200, { data: null }))).toEqual({ ok: true, value: null });
    expect(await read(json(401, errorBody("UNAUTHENTICATED")))).toEqual({ ok: true, value: null });
    expect(await read(json(200, { data: { wallet: "not a wallet", expiresAt: EXPIRES } }))).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });

  it("turns the challenge into the exact message bytes to sign", async () => {
    const bytes = new TextEncoder().encode(MESSAGE);
    const result = await liveSignInService(stubFetch(() => json(200, challengeBody(base64(bytes)))).fetch).requestChallenge(WALLET);
    expect(result.ok && result.value.id).toBe("c-1");
    expect(result.ok && result.value.message.text).toBe(MESSAGE);
    expect(result.ok && [...result.value.message.bytes]).toEqual([...bytes]);
  });

  it("refuses a challenge that isn't printable text before any wallet sees it", async () => {
    const legacyTransactionMessage = Uint8Array.from([1, 0, 1, 3, 6, 7, 8]);
    for (const messageBase64 of [base64(legacyTransactionMessage), base64(Uint8Array.from([0x80, 0xff])), "%%%"]) {
      const service = liveSignInService(stubFetch(() => json(200, challengeBody(messageBase64))).fetch);
      expect(await service.requestChallenge(WALLET), messageBase64).toEqual({ ok: false, failure: "unavailable" });
    }
  });

  it("maps expired and used challenges to a stale challenge, and an unsupported wallet to its own failure", async () => {
    const verify = (status: number, code: string) =>
      liveSignInService(stubFetch(() => json(status, errorBody(code))).fetch).verify({
        challengeId: "c-1" as ChallengeId,
        signature: "c2ln" as SignatureBase64,
      });
    expect(await verify(401, "CHALLENGE_EXPIRED")).toEqual({ ok: false, failure: "stale_challenge" });
    expect(await verify(401, "CHALLENGE_USED")).toEqual({ ok: false, failure: "stale_challenge" });
    expect(await verify(400, "INVALID_SIGNATURE")).toEqual({ ok: false, failure: "unavailable" });
    const challenge = await liveSignInService(stubFetch(() => json(400, errorBody("UNSUPPORTED_WALLET"))).fetch).requestChallenge(WALLET);
    expect(challenge).toEqual({ ok: false, failure: "unsupported_wallet" });
  });

  it("reads a missing route, rate limiting, an outage, a network error and a timeout as unavailable", async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      () => new Response("<html>Not found</html>", { status: 404 }),
      () => json(429, errorBody("RATE_LIMITED")),
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => Promise.reject(new TypeError("fetch failed")),
      () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    ];
    for (const respond of answers) {
      const service = liveSignInService(stubFetch(respond).fetch);
      expect(await service.requestChallenge(WALLET)).toEqual({ ok: false, failure: "unavailable" });
      expect(await service.readSession()).toEqual({ ok: false, failure: "unavailable" });
    }
  });

  it("never throws when ending a session fails", async () => {
    const service = liveSignInService(stubFetch(() => Promise.reject(new TypeError("fetch failed"))).fetch);
    await expect(service.endSession()).resolves.toBeUndefined();
  });

  it("a verify answer that isn't a session is unavailable", async () => {
    const service = liveSignInService(stubFetch(() => json(200, { data: null })).fetch);
    expect(await service.verify({ challengeId: "c-1" as ChallengeId, signature: "c2ln" as SignatureBase64 })).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });
});

describe("the live wallet environment", () => {
  it("builds during server rendering without looking for wallets, and looks only when someone connects", async () => {
    expect(typeof window).toBe("undefined");
    const { bridge } = liveEnvironment();
    const stop = bridge.onAccountChange(() => {});
    stop();
    expect(getWallets).not.toHaveBeenCalled();

    expect(await bridge.connect()).toEqual({ ok: false, failure: "no_wallet" });
    expect(getWallets).toHaveBeenCalled();
  });
});
