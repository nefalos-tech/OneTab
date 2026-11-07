import type { Result } from "@/lib/wallet/environment";
import type { CreateRequest } from "./checkout-view";
import {
  isErrorCode,
  isRecord,
  parsePublicConfig,
  parseRoomSnapshot,
  type CheckoutId,
  type ClientRequestId,
  type CreateCheckoutBody,
  type ErrorCode,
  type PublicConfig,
  type RoomSnapshot,
} from "./contracts";

export type FetchLike = (path: string, init: RequestInit) => Promise<Response>;

export type Reply =
  | { readonly kind: "data"; readonly data: unknown }
  | { readonly kind: "error"; readonly status: number; readonly code: ErrorCode | null }
  | { readonly kind: "no_answer" };

const TIMEOUT_MS = 10_000;

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

export type RoomReadProblem = "not_found" | "unavailable";

export type RequestProblem = "signed_out" | "room_full" | "rate_limited" | "refused" | "unavailable";

export type CheckoutApi = {
  readConfig(): Promise<Result<PublicConfig, "unavailable">>;
  readRoom(id: CheckoutId): Promise<Result<RoomSnapshot, RoomReadProblem>>;
  create(request: CreateRequest, clientRequestId: ClientRequestId): Promise<Result<RoomSnapshot, RequestProblem>>;
  join(id: CheckoutId): Promise<Result<RoomSnapshot, RequestProblem>>;
};

const REQUEST_PROBLEM_BY_CODE: Partial<Record<ErrorCode, Exclude<RequestProblem, "signed_out">>> = {
  ROOM_FULL: "room_full",
  RATE_LIMITED: "rate_limited",
  INVALID_INPUT: "refused",
  FORBIDDEN: "refused",
  ORIGIN_MISMATCH: "refused",
  IDEMPOTENCY_CONFLICT: "refused",
  CHECKOUT_NOT_FOUND: "refused",
  CHECKOUT_PAID: "refused",
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
    async create(request, clientRequestId) {
      const body: CreateCheckoutBody = {
        title: request.title,
        sellerWallet: request.sellerWallet,
        totalUnits: request.totalUnits,
        payerCount: request.payerCount,
        clientRequestId,
      };
      return mutationResult(await send(fetchImpl, "POST", "/api/checkouts", body), null);
    },
    async join(id) {
      return mutationResult(await send(fetchImpl, "POST", `/api/checkouts/${id}/join`), id);
    },
  };
}

function roomOf(data: unknown, expectedId: CheckoutId | null): Result<RoomSnapshot, "unavailable"> {
  const snapshot = parseRoomSnapshot(data);
  return snapshot !== null && (expectedId === null || snapshot.checkout.id === expectedId)
    ? { ok: true, value: snapshot }
    : UNAVAILABLE;
}

function mutationResult(reply: Reply, expectedId: CheckoutId | null): Result<RoomSnapshot, RequestProblem> {
  if (reply.kind === "data") return roomOf(reply.data, expectedId);
  if (reply.kind === "error" && reply.status === 401) return { ok: false, failure: "signed_out" };
  const problem = reply.kind === "error" && reply.code !== null ? REQUEST_PROBLEM_BY_CODE[reply.code] : undefined;
  return { ok: false, failure: problem ?? "unavailable" };
}

export type ApiEnv = { readonly [name: string]: string | undefined };

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
