// The live environment. The only module that knows the auth routes' URLs, bodies and error codes.

import {
  looksLikeAddress,
  type AuthChallenge,
  type AuthVerifyRequest,
  type ErrorCode,
  type ErrorEnvelope,
  type Session,
} from "@/client/contracts";
import {
  authMessage,
  type Challenge,
  type ChallengeId,
  type ServiceFailure,
  type ServiceResult,
  type SignInService,
  type WalletBridge,
  type WalletEnvironment,
} from "./environment";

/**
 * THE SEAM. When P1 records a proven package set, add src/lib/wallet/wallet-standard.ts implementing
 * WalletBridge (discovery via getWallets(), register/unregister, standard:connect without `silent`,
 * standard:events -> onAccountChange, assertCurrent before and after each prompt, 4001 -> "rejected",
 * capabilityFailure() on connect) and replace `unavailableBridge` below. machine.ts, store.ts and every
 * screen stay unchanged.
 */
export function liveEnvironment(): WalletEnvironment {
  return { bridge: unavailableBridge, service: liveSignInService((path, init) => globalThis.fetch(path, init)) };
}

/**
 * Until the adapter lands, connecting reports `failed` ("Sign-in isn't available right now"), not
 * `no_wallet`: Phantom may well be installed, and saying otherwise would be false.
 */
const unavailableBridge: WalletBridge = {
  connect: async () => ({ ok: false, failure: "failed" }),
  disconnect: async () => {},
  signAuthentication: async () => ({ ok: false, failure: "failed" }),
  signPayment: async () => ({ ok: false, failure: "failed" }),
  onAccountChange: () => () => {},
};

export type FetchLike = (path: string, init: RequestInit) => Promise<Response>;

const AUTH_TIMEOUT_MS = 10_000;
const SESSION_PATH = "/api/auth/session";
const CHALLENGE_PATH = "/api/auth/challenge";
const VERIFY_PATH = "/api/auth/verify";

/** The error envelope's code, mapped once. Every code not listed is `unavailable`. */
const FAILURE_BY_CODE: Partial<Record<ErrorCode, ServiceFailure>> = {
  CHALLENGE_EXPIRED: "stale_challenge",
  CHALLENGE_USED: "stale_challenge",
  UNSUPPORTED_WALLET: "unsupported_wallet",
};

const UNAVAILABLE = { ok: false, failure: "unavailable" } as const;

type Reply = { readonly status: number; readonly body: unknown };

/**
 * contracts.md's auth routes. Same-origin cookie, no-store, and a timeout so the store's serial
 * queue can't stall. 404 (B2 not deployed yet), 429, 503, network and timeout errors all map to
 * `unavailable`. Nothing here logs a request or response body.
 */
export function liveSignInService(fetchImpl: FetchLike): SignInService {
  const send = async (method: "GET" | "POST" | "DELETE", path: string, body?: object): Promise<Reply | null> => {
    try {
      const response = await fetchImpl(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
      return { status: response.status, body: await response.json().catch(() => undefined) };
    } catch {
      return null;
    }
  };

  return {
    async readSession() {
      const reply = await send("GET", SESSION_PATH);
      if (reply?.status === 401) return { ok: true, value: null };
      if (reply?.status !== 200) return failureOf(reply);
      const data = dataOf(reply.body);
      return data === null ? { ok: true, value: null } : parsed(parseSession(data));
    },
    async requestChallenge(wallet) {
      const reply = await send("POST", CHALLENGE_PATH, { wallet });
      return reply?.status === 200 ? parsed(parseChallenge(dataOf(reply.body))) : failureOf(reply);
    },
    async verify({ challengeId, signature }) {
      const request: AuthVerifyRequest = { challengeId, signatureBase64: signature };
      const reply = await send("POST", VERIFY_PATH, request);
      return reply?.status === 200 ? parsed(parseSession(dataOf(reply.body))) : failureOf(reply);
    },
    async endSession() {
      await send("DELETE", SESSION_PATH);
    },
  };
}

function failureOf(reply: Reply | null): { readonly ok: false; readonly failure: ServiceFailure } {
  const failure = isErrorEnvelope(reply?.body) ? FAILURE_BY_CODE[reply.body.error.code] : undefined;
  return { ok: false, failure: failure ?? "unavailable" };
}

/** An unknown code passes as a string and maps to nothing, so it reads as `unavailable`. */
function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  return isRecord(body) && isRecord(body.error) && typeof body.error.code === "string";
}

function dataOf(body: unknown): unknown {
  return isRecord(body) && "data" in body ? body.data : undefined;
}

function parsed<T>(value: T | null): ServiceResult<T> {
  return value === null ? UNAVAILABLE : { ok: true, value };
}

function parseSession(data: unknown): Session | null {
  return isRecord(data) &&
    typeof data.wallet === "string" &&
    looksLikeAddress(data.wallet) &&
    typeof data.expiresAt === "string" &&
    Number.isFinite(Date.parse(data.expiresAt))
    ? { wallet: data.wallet, expiresAt: data.expiresAt }
    : null;
}

/** AuthChallenge (wire) to Challenge (domain). The wire type never leaves this file. */
function parseChallenge(data: unknown): Challenge | null {
  if (!isAuthChallenge(data) || data.challengeId === "") return null;
  const bytes = fromBase64(data.messageBase64);
  const message = bytes && authMessage(bytes);
  return message ? { id: data.challengeId as ChallengeId, message } : null;
}

function isAuthChallenge(data: unknown): data is AuthChallenge {
  return (
    isRecord(data) &&
    typeof data.challengeId === "string" &&
    typeof data.messageBase64 === "string" &&
    typeof data.expiresAt === "string"
  );
}

function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
