import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { isRecord, looksLikeAddress, type Address } from "@/client/contracts";
import { decodePublicKey } from "../solana/address";

const COOKIE_NAME = "onetab_session";
const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const PURPOSE = "authenticate";

type AuthFailure = "INVALID_INPUT" | "INVALID_SIGNATURE" | "UNAUTHENTICATED" | "CHALLENGE_EXPIRED" | "CHALLENGE_USED" | "ORIGIN_MISMATCH" | "RATE_LIMITED" | "CONFIGURATION_UNAVAILABLE";
export type AuthResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: AuthFailure };
export type IssuedChallenge = { readonly challengeId: string; readonly messageBase64: string; readonly expiresAt: string };
export type WalletSession = { readonly wallet: Address; readonly expiresAt: string };

type AuthChallengeRecord = { readonly wallet: string; readonly origin: string; readonly purpose: string; readonly message_bytes: string; readonly expires_at: string };

function configured() {
  const origin = process.env.APP_ORIGIN;
  const url = origin ? URL.parse(origin) : null;
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || url.origin !== origin || !supabaseUrl || !key) return null;
  return { origin, supabaseUrl: supabaseUrl.replace(/\/$/, ""), key };
}

async function database(path: string, init: RequestInit = {}): Promise<Response> {
  const config = configured();
  if (!config) throw new Error("configuration");
  return fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function decodeBase64(value: unknown, bytes: number): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === bytes && decoded.toString("base64") === value ? Uint8Array.from(decoded) : null;
}

export function signInMessage(input: { id: string; wallet: string; origin: string; expiresAt: string }): Uint8Array {
  return new TextEncoder().encode([
    "OneTab sign-in",
    `Origin: ${input.origin}`,
    `Wallet: ${input.wallet}`,
    `Purpose: ${PURPOSE}`,
    `Challenge: ${input.id}`,
    `Expires: ${input.expiresAt}`,
  ].join("\n"));
}

export async function issueChallenge(walletValue: unknown): Promise<AuthResult<IssuedChallenge>> {
  const config = configured();
  if (!config) return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
  if (typeof walletValue !== "string" || !looksLikeAddress(walletValue) || !decodePublicKey(walletValue)) return { ok: false, code: "INVALID_INPUT" };
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const message = signInMessage({ id, wallet: walletValue, origin: config.origin, expiresAt });
  try {
    const response = await database("rpc/issue_auth_challenge", {
      method: "POST",
      body: JSON.stringify({ p_id: id, p_wallet: walletValue, p_origin: config.origin, p_purpose: PURPOSE, p_message_bytes: `\\x${hex(message)}`, p_expires_at: expiresAt }),
    });
    if (response.status === 429) return { ok: false, code: "RATE_LIMITED" };
    if (!response.ok) {
      const error = await response.text();
      return { ok: false, code: error.includes("RATE_LIMITED") ? "RATE_LIMITED" : "CONFIGURATION_UNAVAILABLE" };
    }
    return { ok: true, value: { challengeId: id, messageBase64: Buffer.from(message).toString("base64"), expiresAt } };
  } catch {
    return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
  }
}

export async function verifyChallenge(input: { id: unknown; signature: unknown; origin: string }): Promise<AuthResult<WalletSession>> {
  const config = configured();
  if (!config) return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
  if (typeof input.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false, code: "INVALID_INPUT" };
  if (input.origin !== config.origin) return { ok: false, code: "ORIGIN_MISMATCH" };
  const signature = decodeBase64(input.signature, 64);
  if (!signature) return { ok: false, code: "INVALID_SIGNATURE" };
  try {
    const response = await database("rpc/claim_auth_verification", {
      method: "POST",
      body: JSON.stringify({ p_id: input.id, p_origin: config.origin }),
    });
    if (!response.ok) {
      const error = await response.text();
      const code: AuthFailure = error.includes("CHALLENGE_EXPIRED") ? "CHALLENGE_EXPIRED"
        : error.includes("CHALLENGE_USED") ? "CHALLENGE_USED"
          : error.includes("ORIGIN_MISMATCH") ? "ORIGIN_MISMATCH"
            : error.includes("RATE_LIMITED") ? "RATE_LIMITED" : "CONFIGURATION_UNAVAILABLE";
      return { ok: false, code };
    }
    const records: unknown = await response.json();
    if (!Array.isArray(records) || records.length !== 1 || !isRecord(records[0])) return { ok: false, code: "CHALLENGE_USED" };
    if (!isRecord(records[0]) || typeof records[0].wallet !== "string" || typeof records[0].origin !== "string" || typeof records[0].purpose !== "string" || typeof records[0].message_bytes !== "string" || typeof records[0].expires_at !== "string") {
      return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
    }
    const challenge: AuthChallengeRecord = {
      wallet: records[0].wallet,
      origin: records[0].origin,
      purpose: records[0].purpose,
      message_bytes: records[0].message_bytes,
      expires_at: records[0].expires_at,
    };
    if (challenge.expires_at <= new Date().toISOString()) return { ok: false, code: "CHALLENGE_EXPIRED" };
    if (!looksLikeAddress(challenge.wallet) || challenge.origin !== config.origin || challenge.purpose !== PURPOSE) return { ok: false, code: "ORIGIN_MISMATCH" };
    const keyBytes = decodePublicKey(challenge.wallet);
    if (!keyBytes) return { ok: false, code: "INVALID_INPUT" };
    const publicKey = await crypto.subtle.importKey("raw", Uint8Array.from(keyBytes), { name: "Ed25519" }, false, ["verify"]);
    const message = Uint8Array.from(Buffer.from(challenge.message_bytes.replace(/^\\x/, ""), "hex"));
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, message))) return { ok: false, code: "INVALID_SIGNATURE" };
    const token = randomBytes(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const tokenHash = createHash("sha256").update(token).digest();
    const consumed = await database("rpc/consume_auth_challenge", {
      method: "POST",
      body: JSON.stringify({ p_id: input.id, p_wallet: challenge.wallet, p_origin: config.origin, p_purpose: PURPOSE, p_token_hash: `\\x${hex(tokenHash)}`, p_session_expires_at: expiresAt }),
    });
    if (!consumed.ok) {
      const text = await consumed.text();
      const code: AuthFailure = text.includes("CHALLENGE_EXPIRED") ? "CHALLENGE_EXPIRED" : text.includes("ORIGIN_MISMATCH") ? "ORIGIN_MISMATCH" : text.includes("CHALLENGE_USED") ? "CHALLENGE_USED" : "CONFIGURATION_UNAVAILABLE";
      return { ok: false, code };
    }
    const jar = await cookies();
    jar.set(COOKIE_NAME, token.toString("base64url"), { httpOnly: true, secure: new URL(config.origin).protocol === "https:", sameSite: "lax", path: "/", expires: new Date(expiresAt) });
    return { ok: true, value: { wallet: challenge.wallet as Address, expiresAt } };
  } catch {
    return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
  }
}

export async function readSession(): Promise<AuthResult<WalletSession | null>> {
  const config = configured();
  if (!config) return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: true, value: null };
    const hash = createHash("sha256").update(Buffer.from(token, "base64url")).digest("hex");
    const response = await database(`wallet_sessions?token_hash=eq.%5Cx${hash}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=wallet,expires_at`);
    if (!response.ok) return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length === 0 || !isRecord(rows[0]) || typeof rows[0].wallet !== "string" || !looksLikeAddress(rows[0].wallet)) return { ok: true, value: null };
    return { ok: true, value: { wallet: rows[0].wallet, expiresAt: String(rows[0].expires_at) } };
  } catch {
    return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
  }
}

export async function requireWalletSession(): Promise<AuthResult<WalletSession>> {
  const session = await readSession();
  if (!session.ok) return session;
  return session.value ? { ok: true, value: session.value } : { ok: false, code: "UNAUTHENTICATED" };
}

export async function endSession(): Promise<void> {
  const config = configured();
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (config && token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const hash = createHash("sha256").update(Buffer.from(token, "base64url")).digest("hex");
    await database(`wallet_sessions?token_hash=eq.%5Cx${hash}&revoked_at=is.null`, { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) }).catch(() => undefined);
  }
  jar.set(COOKIE_NAME, "", { httpOnly: true, secure: config ? new URL(config.origin).protocol === "https:" : true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function expectedOrigin(request: Request): string | null {
  const config = configured();
  const origin = request.headers.get("origin");
  return config && origin === config.origin ? origin : null;
}
