import { send, type FetchLike, type Reply } from "@/client/api";
import {
  isRecord,
  looksLikeAddress,
  type AuthChallenge,
  type AuthVerifyRequest,
  type ErrorCode,
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

export function liveEnvironment(): WalletEnvironment {
  return { bridge: unavailableBridge, service: liveSignInService((path, init) => globalThis.fetch(path, init)) };
}

const unavailableBridge: WalletBridge = {
  connect: async () => ({ ok: false, failure: "failed" }),
  disconnect: async () => {},
  signAuthentication: async () => ({ ok: false, failure: "failed" }),
  signPayment: async () => ({ ok: false, failure: "failed" }),
  onAccountChange: () => () => {},
};

export type { FetchLike };

const SESSION_PATH = "/api/auth/session";
const CHALLENGE_PATH = "/api/auth/challenge";
const VERIFY_PATH = "/api/auth/verify";

const FAILURE_BY_CODE: Partial<Record<ErrorCode, ServiceFailure>> = {
  CHALLENGE_EXPIRED: "stale_challenge",
  CHALLENGE_USED: "stale_challenge",
  UNSUPPORTED_WALLET: "unsupported_wallet",
};

const UNAVAILABLE = { ok: false, failure: "unavailable" } as const;

export function liveSignInService(fetchImpl: FetchLike): SignInService {
  return {
    async readSession() {
      const reply = await send(fetchImpl, "GET", SESSION_PATH);
      if (reply.kind === "error" && reply.status === 401) return { ok: true, value: null };
      if (reply.kind !== "data") return failureOf(reply);
      return reply.data === null ? { ok: true, value: null } : parsed(parseSession(reply.data));
    },
    async requestChallenge(wallet) {
      const reply = await send(fetchImpl, "POST", CHALLENGE_PATH, { wallet });
      return reply.kind === "data" ? parsed(parseChallenge(reply.data)) : failureOf(reply);
    },
    async verify({ challengeId, signature }) {
      const request: AuthVerifyRequest = { challengeId, signatureBase64: signature };
      const reply = await send(fetchImpl, "POST", VERIFY_PATH, request);
      return reply.kind === "data" ? parsed(parseSession(reply.data)) : failureOf(reply);
    },
    async endSession() {
      await send(fetchImpl, "DELETE", SESSION_PATH);
    },
  };
}

function failureOf(reply: Reply): { readonly ok: false; readonly failure: ServiceFailure } {
  const failure = reply.kind === "error" && reply.code !== null ? FAILURE_BY_CODE[reply.code] : undefined;
  return { ok: false, failure: failure ?? "unavailable" };
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
