import type { Result } from "@/lib/wallet/environment";
import {
  isErrorCode,
  isRecord,
  parsePublicConfig,
  parseRoomSnapshot,
  type CheckoutId,
  type ErrorCode,
  type PublicConfig,
  type RoomSnapshot,
} from "./contracts";

export type FetchLike = (path: string, init: RequestInit) => Promise<Response>;

/**
 * One answer from a contract route.
 * - `data`: status 200 or 201 with a `{ data }` body. Creation may answer 201.
 * - `error`: any other answer. `code` is null when the body has no known error code, such as the
 *   HTML 404 a route returns before Backend deploys it.
 * - `no_answer`: the request failed or timed out. For a mutation the outcome is unknown.
 */
export type Reply =
  | { readonly kind: "data"; readonly data: unknown }
  | { readonly kind: "error"; readonly status: number; readonly code: ErrorCode | null }
  | { readonly kind: "no_answer" };

const TIMEOUT_MS = 10_000;

/** Never throws, and drops the envelope's `message`, so no caller can show it. */
export async function send(
  fetchImpl: FetchLike,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: object,
): Promise<Reply> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "no_answer" };
  }
  const json: unknown = await response.json().catch(() => undefined);
  if ((response.status === 200 || response.status === 201) && isRecord(json) && "data" in json) {
    return { kind: "data", data: json.data };
  }
  const code = isRecord(json) && isRecord(json.error) && isErrorCode(json.error.code) ? json.error.code : null;
  return { kind: "error", status: response.status, code };
}

/** Why a room read produced no snapshot. Only the contract's CHECKOUT_NOT_FOUND is `not_found`. */
export type RoomReadProblem = "not_found" | "unavailable";

export type CheckoutApi = {
  /** GET /api/config. */
  readConfig(): Promise<Result<PublicConfig, "unavailable">>;
  /** GET /api/checkouts/:checkoutId. A snapshot of another checkout is `unavailable`. */
  readRoom(id: CheckoutId): Promise<Result<RoomSnapshot, RoomReadProblem>>;
};

const UNAVAILABLE = { ok: false, failure: "unavailable" } as const;

export function checkoutApi(fetchImpl: FetchLike): CheckoutApi {
  return {
    async readConfig() {
      const reply = await send(fetchImpl, "GET", "/api/config");
      const config = reply.kind === "data" ? parsePublicConfig(reply.data) : null;
      return config === null ? UNAVAILABLE : { ok: true, value: config };
    },
    async readRoom(id) {
      const reply = await send(fetchImpl, "GET", `/api/checkouts/${id}`);
      if (reply.kind === "data") return roomOf(reply.data, id);
      return reply.kind === "error" && reply.code === "CHECKOUT_NOT_FOUND" ? { ok: false, failure: "not_found" } : UNAVAILABLE;
    },
  };
}

function roomOf(data: unknown, id: CheckoutId): Result<RoomSnapshot, "unavailable"> {
  const snapshot = parseRoomSnapshot(data);
  return snapshot !== null && snapshot.checkout.id === id ? { ok: true, value: snapshot } : UNAVAILABLE;
}

/** The server's configuration for page loads. Never read from the incoming request. */
export type ApiEnv = { readonly [name: string]: string | undefined };

/**
 * The origin that page loads read the API from: ONETAB_API_ORIGIN, else APP_ORIGIN. Null unless the
 * value is an http or https origin with no path, query or fragment. The request's Host header is never
 * used, because a crafted request could then point the server's fetch at any host it can reach.
 */
export function apiOrigin(env: ApiEnv): string | null {
  const value = env.ONETAB_API_ORIGIN || env.APP_ORIGIN;
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const isHttp = url.protocol === "https:" || url.protocol === "http:";
  return isHttp && url.origin === value.replace(/\/$/, "") ? url.origin : null;
}

/**
 * The server's FetchLike. It reads the origin on every call, so `next start` honors the environment it
 * started with, and rejects a path that would leave that origin. A rejection reads as no answer. No
 * cookie or header from the viewer's request is forwarded: page loads read only public routes.
 */
export function originFetch(
  env: ApiEnv,
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
): FetchLike {
  return async (path, init) => {
    const origin = apiOrigin(env);
    if (origin === null) throw new Error("Set ONETAB_API_ORIGIN or APP_ORIGIN to read live checkouts.");
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error(`${path} leaves the API origin.`);
    return fetchImpl(url, init);
  };
}
