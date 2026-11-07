import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { looksLikeAddress } from "../../client/contracts";
import type { AuthResult, WalletSession } from "../auth/service";
import { createPaymentHandlers } from "./http";
import { serviceFixture } from "./test-fixtures";

const origin = "https://onetab.test";
const request = (input: { method?: string; body?: unknown; origin?: string | null; raw?: string } = {}) => new Request(`${origin}/api/payment`, {
  method: input.method ?? "POST",
  headers: input.origin === null ? {} : { origin: input.origin ?? origin, "content-type": "application/json" },
  body: input.raw ?? (input.body === undefined ? undefined : JSON.stringify(input.body)),
});

async function fixture() {
  const f = await serviceFixture();
  const wallet = f.organizer.wallet;
  if (!looksLikeAddress(wallet)) throw new Error("Fixture wallet invalid");
  let session: AuthResult<WalletSession> = { ok: true, value: {
    wallet, expiresAt: "2026-11-08T00:00:00Z",
  } };
  let authentications = 0;
  const handlers = createPaymentHandlers({
    async requireSession() { authentications++; return session; },
    originAllowed: req => req.headers.get("origin") === origin,
    service: () => f.service,
  });
  return { ...f, handlers, setSession(value: typeof session) { session = value; },
    authentications: () => authentications };
}

describe("payment HTTP handlers", () => {
  it("requires the configured origin before authentication for every mutation", async () => {
    const f = await fixture();
    const mutations = [f.handlers.prepare, f.handlers.addSignature, f.handlers.decline, f.handlers.submit, f.handlers.refresh];
    for (const operation of mutations) {
      for (const forbiddenOrigin of [null, "https://foreign.test"]) {
        const response = await operation(request({ origin: forbiddenOrigin }), f.room.checkout.id);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "ORIGIN_MISMATCH" } });
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
    }
    expect(f.authentications()).toBe(0);
    expect(f.store.attempts.size).toBe(0);
  });

  it("requires a session for every operation including the payload GET", async () => {
    const f = await fixture();
    f.setSession({ ok: false, code: "UNAUTHENTICATED" });
    for (const operation of Object.values(f.handlers)) {
      const response = await operation(request(), f.room.checkout.id);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    }
    expect(f.store.attempts.size).toBe(0);
  });

  it("validates UUIDs, strict bodies, hashes and bounded encodings without accepting a body wallet", async () => {
    const f = await fixture();
    for (const invalid of [request({ raw: "{" }), request({ body: { wallet: f.organizer.wallet } }),
      request({ body: { retryOfAttemptId: "invalid" } }), request({ raw: "x".repeat(4097) })]) {
      expect((await f.handlers.prepare(invalid, f.room.checkout.id)).status).toBe(400);
    }
    expect((await f.handlers.prepare(request(), "not-a-uuid")).status).toBe(400);
    expect((await f.handlers.signingPayload(request({ method: "GET", origin: null }), "bad")).status).toBe(400);
    expect(f.store.attempts.size).toBe(0);
    await f.prepare();
    const upload = await f.upload(0);
    for (const body of [{}, { messageHash: "bad", signatureBase64: upload.signatureBase64 },
      { messageHash: upload.messageHash, signatureBase64: "short" },
      { messageHash: upload.messageHash, signatureBase64: upload.signatureBase64, wallet: upload.wallet }]) {
      expect((await f.handlers.addSignature(request({ body }), upload.attemptId)).status).toBe(400);
    }
    for (const operation of [f.handlers.decline, f.handlers.submit, f.handlers.refresh]) {
      expect((await operation(request({ body: { wallet: upload.wallet } }), upload.attemptId)).status).toBe(400);
    }
    expect(f.current().signatures).toEqual([]);
  });

  it("prepares and serves a signable payload to an authenticated member without GET Origin", async () => {
    const f = await fixture();
    const prepared = await f.handlers.prepare(request(), f.room.checkout.id.toUpperCase());
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toMatchObject({ data: { id: f.current().id, state: "signing", signedWallets: [] } });
    const response = await f.handlers.signingPayload(request({ method: "GET", origin: null }), f.current().id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: f.current().signingPayload });
  });

  it("derives the signer from the session and returns only the public attempt summary", async () => {
    const f = await fixture();
    await f.prepare();
    const upload = await f.upload(0);
    const response = await f.handlers.addSignature(request({ body: {
      messageHash: upload.messageHash, signatureBase64: upload.signatureBase64,
    } }), upload.attemptId);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ data: { signedWallets: [f.organizer.wallet], canRetry: false } });
    expect(JSON.stringify(json)).not.toContain(upload.signatureBase64);
    expect(JSON.stringify(json)).not.toContain(f.current().preparationLease!.token);
    expect((await f.handlers.submit(request(), upload.attemptId)).status).toBe(200);
    expect((await f.handlers.refresh(request(), upload.attemptId)).status).toBe(200);
    const declined = await f.handlers.decline(request(), upload.attemptId);
    expect(await declined.json()).toMatchObject({ data: { state: "declined", canRetry: false } });
    expect(f.current().signatures).toHaveLength(1);
    expect(f.progressCalls).toEqual([upload.attemptId, upload.attemptId]);
  });

  it("denies an outsider for every attempt operation and a non-organizer for preparation", async () => {
    const f = await fixture();
    await f.prepare();
    const upload = await f.upload(0);
    const wallet = getAddressDecoder().decode(new Uint8Array(32).fill(80));
    if (!looksLikeAddress(wallet)) throw new Error("Fixture wallet invalid");
    f.setSession({ ok: true, value: { wallet, expiresAt: "2026-11-08T00:00:00Z" } });
    expect((await f.handlers.prepare(request(), f.room.checkout.id)).status).toBe(403);
    const signatureRequest = request({ body: { messageHash: upload.messageHash, signatureBase64: upload.signatureBase64 } });
    expect((await f.handlers.addSignature(signatureRequest, upload.attemptId)).status).toBe(403);
    for (const operation of [f.handlers.signingPayload, f.handlers.decline, f.handlers.submit, f.handlers.refresh]) {
      expect((await operation(request(), upload.attemptId)).status).toBe(403);
    }
    expect(f.current().signatures).toEqual([]);
    expect(f.progressCalls).toEqual([]);
  });

  it("maps unknown adapter errors to fixed configuration errors without trusting their text", async () => {
    const f = await fixture();
    f.store.reserveAttempt = async () => { throw new Error("FORBIDDEN credential=secret"); };
    const response = await f.handlers.prepare(request(), f.room.checkout.id);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "CONFIGURATION_UNAVAILABLE", message: "Payment configuration is unavailable." } });
  });

  it("preserves not-found and state conflicts in the B1 status mapping", async () => {
    const f = await fixture();
    expect((await f.handlers.signingPayload(request({ method: "GET" }), "00000000-0000-4000-8000-000000000099")).status).toBe(404);
    f.room.participants[0]!.ready = false;
    expect((await f.handlers.prepare(request(), f.room.checkout.id)).status).toBe(409);
    expect(f.store.attempts.size).toBe(0);
  });
});
