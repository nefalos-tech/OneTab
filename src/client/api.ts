import { isErrorCode, isRecord, type ErrorCode } from "./contracts";

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
