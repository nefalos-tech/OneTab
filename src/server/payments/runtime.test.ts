import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRoomSnapshot } from "../../client/contracts";
import { DEVNET_USDC } from "../../lib/payments/payment-core";

const { getRoom, requireWalletSession, expectedOrigin, storeError } = vi.hoisted(() => ({
  getRoom: vi.fn(), requireWalletSession: vi.fn(), expectedOrigin: vi.fn(), storeError: { message: "RETRY_BLOCKED" },
}));
vi.mock("../rooms/service", async importOriginal => ({
  ...await importOriginal<typeof import("../rooms/service")>(), getRoom,
}));
vi.mock("../auth/service", () => ({ requireWalletSession, expectedOrigin }));
vi.mock("../attempt-store/postgres", () => ({
  postgresAttemptStore: { reserveAttempt: async () => { throw new Error(storeError.message); } },
}));

import { POST as prepare } from "../../app/api/checkouts/[id]/attempts/route";
import { GET as signingPayload } from "../../app/api/attempts/[attemptId]/signing-payload/route";
import { POST as addSignature } from "../../app/api/attempts/[attemptId]/signatures/route";
import { POST as decline } from "../../app/api/attempts/[attemptId]/decline/route";
import { POST as submit } from "../../app/api/attempts/[attemptId]/submit/route";
import { POST as refresh } from "../../app/api/attempts/[attemptId]/refresh/route";
import { createPaymentRuntime, readPaymentRoom } from "./runtime";
import { serviceFixture } from "./test-fixtures";

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("payment runtime composition", () => {
  it("requires explicit persistence and lifecycle ports with no in-memory production fallback", async () => {
    await expect(createPaymentRuntime()).rejects.toMatchObject({ code: "CONFIGURATION_UNAVAILABLE" });
  });

  it("uses real B3 configuration and converts readonly room arrays to independent B1 values", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const snapshot = parseRoomSnapshot(await f.store.readRoom());
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("Fixture room invalid");
    getRoom.mockResolvedValue({ ok: true, value: snapshot });
    vi.stubEnv("SOLANA_CLUSTER", "devnet");
    vi.stubEnv("USDC_MINT", DEVNET_USDC);
    vi.stubEnv("USDC_DECIMALS", "6");
    const service = await createPaymentRuntime(f.dependencies);
    const payload = await service.signingPayload({ attemptId: f.current().id, wallet: f.organizer.wallet });
    expect(payload.attemptId).toBe(f.current().id);
    expect(getRoom).toHaveBeenCalledWith(f.room.checkout.id);
    const copied = await readPaymentRoom({ checkoutId: f.room.checkout.id });
    expect(copied).toEqual(snapshot);
    expect(copied?.participants).not.toBe(snapshot.participants);
    expect(copied?.attempt?.signedWallets).not.toBe(snapshot.attempt?.signedWallets);
    copied?.participants.pop();
    expect(snapshot.participants).toHaveLength(2);
    vi.stubEnv("SOLANA_CLUSTER", "mainnet");
    await expect(createPaymentRuntime(f.dependencies)).rejects.toMatchObject({ code: "CONFIGURATION_UNAVAILABLE" });
  });

  it("distinguishes B3 missing checkout from service unavailability", async () => {
    getRoom.mockResolvedValue({ ok: false, code: "CHECKOUT_NOT_FOUND" });
    expect(await readPaymentRoom({ checkoutId: "checkout" })).toBeNull();
    getRoom.mockResolvedValue({ ok: false, code: "CONFIGURATION_UNAVAILABLE" });
    await expect(readPaymentRoom({ checkoutId: "checkout" })).rejects.toMatchObject({ code: "CONFIGURATION_UNAVAILABLE" });
  });

  it("wires all real route modules to fail closed after their session and origin guards", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const upload = await f.upload(0);
    requireWalletSession.mockResolvedValue({ ok: true, value: { wallet: f.organizer.wallet, expiresAt: "later" } });
    expectedOrigin.mockReturnValue("https://onetab.test");
    const request = (body?: unknown, method = "POST") => new Request("https://onetab.test/api/payment", {
      method, headers: { origin: "https://onetab.test" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const context = { params: Promise.resolve({ attemptId: upload.attemptId }) };
    const responses = [
      await prepare(request(), { params: Promise.resolve({ id: f.room.checkout.id }) }),
      await signingPayload(request(undefined, "GET"), context),
      await addSignature(request({ messageHash: upload.messageHash, signatureBase64: upload.signatureBase64 }), context),
      await decline(request(), context), await submit(request(), context), await refresh(request(), context),
    ];
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: { code: "CONFIGURATION_UNAVAILABLE" } });
    }
    expect(requireWalletSession).toHaveBeenCalledTimes(6);
    expect(expectedOrigin).toHaveBeenCalledTimes(5);
    expect(getRoom).not.toHaveBeenCalled();
  });

  it("uses the Postgres store only when durable configuration is complete and maps its exact code", async () => {
    const f = await serviceFixture();
    getRoom.mockResolvedValue({ ok: true, value: await f.store.readRoom() });
    vi.stubEnv("SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("SOLANA_RPC_URL", "https://api.devnet.solana.com");
    vi.stubEnv("SOLANA_CLUSTER", "devnet");
    vi.stubEnv("USDC_MINT", DEVNET_USDC);
    vi.stubEnv("USDC_DECIMALS", "6");
    await expect(createPaymentRuntime()).rejects.toMatchObject({ code: "CONFIGURATION_UNAVAILABLE" });
    expect(getRoom).not.toHaveBeenCalled();
    vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-key");
    storeError.message = "postgres password=secret";
    const hidden = await createPaymentRuntime();
    await expect(hidden.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null }))
      .rejects.toSatisfy((error: unknown) => error instanceof Error && error.message === "Payment configuration is unavailable."
        && !error.message.includes("password") && !error.message.includes("secret"));
    storeError.message = "RETRY_BLOCKED";
    const service = await createPaymentRuntime();
    await expect(service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null }))
      .rejects.toMatchObject({ code: "RETRY_BLOCKED", status: 409 });
  });
});
