import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet, get: vi.fn() }) }));

import { issueChallenge, signInMessage, verifyChallenge } from "./service";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const wallet = encodeBase58(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const origin = "http://localhost:3000";

function encodeBase58(bytes: Buffer): string {
  let number = BigInt(`0x${bytes.toString("hex")}`);
  let result = "";
  while (number > 0n) {
    const digit = Number(number % 58n);
    result = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[digit] + result;
    number /= 58n;
  }
  return "1".repeat(bytes.findIndex((byte) => byte !== 0) < 0 ? bytes.length : bytes.findIndex((byte) => byte !== 0)) + result;
}

describe("wallet authentication service", () => {
  beforeEach(() => {
    process.env.APP_ORIGIN = origin;
    process.env.SUPABASE_URL = "https://database.example.test";
    process.env.SUPABASE_SECRET_KEY = "test-only-secret";
    cookieSet.mockReset();
  });

  it("issues a domain and wallet bound challenge", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body));
      return Response.json([], { status: 201 });
    });

    const result = await issueChallenge(wallet);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(requestBody).toMatchObject({ p_wallet: wallet, p_origin: origin, p_purpose: "authenticate" });
    expect(Buffer.from(result.value.messageBase64, "base64").toString()).toContain(`Wallet: ${wallet}`);
    expect(Buffer.from(result.value.messageBase64, "base64").toString()).toContain(`Origin: ${origin}`);
  });

  it("sets a session only after a valid signature and atomically consumes the challenge", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const message = signInMessage({ id, wallet, origin, expiresAt });
    const signature = sign(null, message, privateKey).toString("base64");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("claim_auth_verification")) {
        return Response.json([{ wallet, origin, purpose: "authenticate", message_bytes: `\\x${Buffer.from(message).toString("hex")}`, expires_at: expiresAt }]);
      }
      return Response.json([{ wallet, expires_at: new Date(Date.now() + 12 * 60 * 60_000).toISOString() }]);
    });

    const result = await verifyChallenge({ id, signature, origin });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("rpc/claim_auth_verification");
    expect(calls[1]).toContain("rpc/consume_auth_challenge");
    expect(cookieSet).toHaveBeenCalledWith("onetab_session", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
  });

  it("rejects a signature request from a different origin before reading a challenge", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await verifyChallenge({ id: "22222222-2222-4222-8222-222222222222", signature: "AA==", origin: "https://attacker.example" });

    expect(result).toEqual({ ok: false, code: "ORIGIN_MISMATCH" });
    expect(fetch).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
