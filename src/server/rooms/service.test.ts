import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRecord, looksLikeAddress, type Address } from "@/client/contracts";

vi.mock("@/server/auth/service", () => ({ readSession: async () => ({ ok: true, value: { wallet: `11111111111111111111111111111111`, expiresAt: new Date().toISOString() } }) }));

import { createRoom, getRoom, joinRoom, publicConfig, setReadiness } from "./service";

function address(value: string): Address {
  if (!looksLikeAddress(value)) throw new Error("test address is malformed");
  return value;
}

const organizer = address("11111111111111111111111111111111");
const seller = address("11111111111111111111111111111114");
const mint = address("11111111111111111111111111111115");
const id = "00000000-0000-4000-8000-000000000001";
const snapshot = {
  checkout: { id, title: "Lunch", organizerWallet: organizer, sellerWallet: seller, network: "devnet", mint, tokenDecimals: 6, totalUnits: "10", payerCount: 3, createdAt: new Date().toISOString() },
  participants: [{ slot: 0, wallet: organizer, shareUnits: "4", ready: false }], phase: "open", attempt: null,
};

describe("room service", () => {
  beforeEach(() => {
    process.env.APP_ORIGIN = "http://localhost:3000";
    process.env.SUPABASE_URL = "https://database.example.test";
    process.env.SUPABASE_SECRET_KEY = "test-only-secret";
    process.env.SOLANA_CLUSTER = "devnet";
    process.env.USDC_MINT = mint;
    process.env.USDC_DECIMALS = "6";
  });

  it("exposes only validated Devnet config", () => {
    expect(publicConfig()).toEqual({ ok: true, value: { network: "devnet", mint, tokenDecimals: 6, confirmationTarget: "finalized" } });
    process.env.SOLANA_CLUSTER = "mainnet-beta";
    expect(publicConfig()).toEqual({ ok: false, code: "CONFIGURATION_UNAVAILABLE" });
  });

  it("validates create input and sends config-derived immutable details to the atomic RPC", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const parsed: unknown = JSON.parse(String(init.body));
      if (!isRecord(parsed)) throw new Error("request body should be an object");
      const body = parsed;
      calls.push({ url: String(url), body });
      return String(url).includes("create_checkout") ? Response.json(id) : Response.json(snapshot);
    });
    const result = await createRoom({ title: " Lunch ", sellerWallet: seller, totalUnits: "10", payerCount: 3, clientRequestId: id }, organizer);
    expect(result.ok).toBe(true);
    expect(calls[0]?.body).toMatchObject({ p_title: "Lunch", p_organizer_wallet: organizer, p_network: "devnet", p_mint: mint, p_total_units: "10", p_payer_count: 3 });
    expect(calls[0]?.body.p_token_decimals).toBe(6);
    expect(calls[1]?.url).toContain("checkout_room_snapshot");
    expect(await createRoom({ title: "Lunch", sellerWallet: organizer, totalUnits: "10", payerCount: 3, clientRequestId: id }, organizer)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await createRoom({ title: "Lunch", sellerWallet: "1".repeat(33), totalUnits: "10", payerCount: 3, clientRequestId: id }, organizer)).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("returns database snapshots after idempotent join and readiness mutations", async () => {
    const names: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      names.push(String(url));
      return Response.json(snapshot);
    });
    expect((await joinRoom(id, organizer)).ok).toBe(true);
    expect((await setReadiness(id, organizer, true)).ok).toBe(true);
    expect((await getRoom(id)).ok).toBe(true);
    expect(names.map((name) => name.split("/").at(-1))).toEqual(["join_checkout", "checkout_room_snapshot", "set_checkout_readiness", "checkout_room_snapshot", "checkout_room_snapshot"]);
    expect(names.every((name) => name.includes("database.example.test/rest/v1/rpc/"))).toBe(true);
  });
});
