import { randomUUID } from "node:crypto";
import { isRecord, isTokenUnits, looksLikeAddress, parseRoomSnapshot, type Address, type RoomSnapshot } from "@/client/contracts";
import { decodePublicKey } from "../solana/address";

export type RoomFailure = "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "CHECKOUT_NOT_FOUND" | "ROOM_FULL" | "IDEMPOTENCY_CONFLICT" | "CHECKOUT_PAID" | "ATTEMPT_NOT_SIGNABLE" | "CONFIGURATION_UNAVAILABLE" | "ORIGIN_MISMATCH";
export type RoomResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: RoomFailure };
export type ValidatedConfig = { readonly network: "devnet"; readonly mint: Address; readonly tokenDecimals: number; readonly confirmationTarget: "finalized" };
function isRoomFailure(value: string): value is RoomFailure {
  switch (value) {
    case "INVALID_INPUT": case "UNAUTHENTICATED": case "FORBIDDEN": case "CHECKOUT_NOT_FOUND": case "ROOM_FULL":
    case "IDEMPOTENCY_CONFLICT": case "CHECKOUT_PAID": case "ATTEMPT_NOT_SIGNABLE": case "CONFIGURATION_UNAVAILABLE": case "ORIGIN_MISMATCH": return true;
    default: return false;
  }
}

function settings(): { origin: string; url: string; key: string } | null {
  const origin = process.env.APP_ORIGIN;
  const parsedOrigin = origin ? URL.parse(origin) : null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return parsedOrigin && parsedOrigin.origin === origin && url && key ? { origin, url: url.replace(/\/$/, ""), key } : null;
}

export function publicConfig(): RoomResult<ValidatedConfig> {
  const cluster = process.env.SOLANA_CLUSTER;
  const mint = process.env.USDC_MINT;
  const decimals = process.env.USDC_DECIMALS;
  if (cluster !== "devnet" || typeof mint !== "string" || !looksLikeAddress(mint) || !decodePublicKey(mint) || typeof decimals !== "string" || !/^(0|[1-9][0-9]{0,2})$/.test(decimals) || !Number.isInteger(Number(decimals)) || Number(decimals) > 255) {
    return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
  }
  return { ok: true, value: { network: "devnet", mint, tokenDecimals: Number(decimals), confirmationTarget: "finalized" } };
}

export function requestOriginAllowed(request: Request): boolean {
  const config = settings();
  return config !== null && request.headers.get("origin") === config.origin;
}

async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const config = settings();
  if (!config) throw new Error("CONFIGURATION_UNAVAILABLE");
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: "POST", cache: "no-store",
    headers: { apikey: config.key, authorization: `Bearer ${config.key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    const match = ["CHECKOUT_NOT_FOUND", "ROOM_FULL", "FORBIDDEN", "IDEMPOTENCY_CONFLICT", "CHECKOUT_PAID", "ATTEMPT_NOT_SIGNABLE"].find((code) => text.includes(code));
    throw new Error(match ?? "CONFIGURATION_UNAVAILABLE");
  }
  return response.json();
}

function failure(error: unknown): RoomFailure {
  const message = error instanceof Error ? error.message : "";
  return isRoomFailure(message) ? message : "CONFIGURATION_UNAVAILABLE";
}

export async function getRoom(id: string): Promise<RoomResult<RoomSnapshot>> {
  try {
    const data = await rpc("checkout_room_snapshot", { p_checkout_id: id });
    const snapshot = parseRoomSnapshot(data);
    return snapshot ? { ok: true, value: snapshot } : { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
  } catch (error) {
    return { ok: false, code: failure(error) };
  }
}

export async function createRoom(input: unknown, organizer: Address): Promise<RoomResult<RoomSnapshot>> {
  if (!isRecord(input) || typeof input.title !== "string" || input.title.trim().length === 0 || input.title.trim().length > 120 ||
      typeof input.sellerWallet !== "string" || !looksLikeAddress(input.sellerWallet) || !decodePublicKey(input.sellerWallet) || input.sellerWallet === organizer ||
      typeof input.totalUnits !== "string" || !isTokenUnits(input.totalUnits) || BigInt(input.totalUnits) < 2n ||
      (input.payerCount !== 2 && input.payerCount !== 3) || typeof input.clientRequestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientRequestId)) return { ok: false, code: "INVALID_INPUT" };
  const config = publicConfig();
  if (!config.ok) return config;
  if (BigInt(input.totalUnits) < BigInt(input.payerCount)) return { ok: false, code: "INVALID_INPUT" };
  try {
    const id = await rpc("create_checkout", {
      p_id: randomUUID(), p_client_request_id: input.clientRequestId, p_title: input.title.trim(), p_organizer_wallet: organizer,
      p_seller_wallet: input.sellerWallet, p_total_units: input.totalUnits, p_payer_count: input.payerCount,
      p_network: config.value.network, p_mint: config.value.mint, p_token_decimals: config.value.tokenDecimals,
    });
    if (typeof id !== "string") return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
    return getRoom(id);
  } catch (error) {
    return { ok: false, code: failure(error) };
  }
}

export async function joinRoom(id: string, wallet: Address): Promise<RoomResult<RoomSnapshot>> {
  try {
    await rpc("join_checkout", { p_checkout_id: id, p_wallet: wallet });
    return getRoom(id);
  } catch (error) { return { ok: false, code: failure(error) }; }
}

export async function setReadiness(id: string, wallet: Address, ready: boolean): Promise<RoomResult<RoomSnapshot>> {
  try {
    await rpc("set_checkout_readiness", { p_checkout_id: id, p_wallet: wallet, p_ready: ready });
    return getRoom(id);
  } catch (error) { return { ok: false, code: failure(error) }; }
}

export function parseRoomId(text: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text.toLowerCase() : null;
}

export function isReadyBody(data: unknown): data is { ready: boolean } {
  return isRecord(data) && typeof data.ready === "boolean";
}
