import { getWallets } from "@wallet-standard/app";
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
  type SignInService,
  type WalletEnvironment,
} from "./environment";
import { clearSignInDiagnostic, noteSignInDiagnostic, type SignInDiagnostic } from "./sign-in-diagnostic";
import { standardBridge } from "./standard";

export function liveEnvironment(): WalletEnvironment {
  return { bridge: standardBridge(getWallets), service: liveSignInService((path, init) => globalThis.fetch(path, init)) };
}

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
      clearSignInDiagnostic();
      const reply = await send(fetchImpl, "GET", SESSION_PATH);
      if (reply.kind === "error" && reply.status === 401) return { ok: true, value: null };
      if (reply.kind !== "data") return failureOf("session", reply);
      if (reply.data === null) return { ok: true, value: null };
      const session = parseSession(reply.data);
      return session ? { ok: true, value: session } : unparsed("session");
    },
    async requestChallenge(wallet) {
      const reply = await send(fetchImpl, "POST", CHALLENGE_PATH, { wallet });
      if (reply.kind !== "data") return failureOf("challenge", reply);
      const challenge = parseChallenge(reply.data);
      return challenge ? { ok: true, value: challenge } : unparsed("challenge");
    },
    async verify({ challengeId, signature }) {
      const request: AuthVerifyRequest = { challengeId, signatureBase64: signature };
      const reply = await send(fetchImpl, "POST", VERIFY_PATH, request);
      if (reply.kind !== "data") return failureOf("verify", reply);
      const session = parseSession(reply.data);
      return session ? { ok: true, value: session } : unparsed("verify");
    },
    async endSession() {
      await send(fetchImpl, "DELETE", SESSION_PATH);
    },
  };
}

function failureOf(stage: SignInDiagnostic["stage"], reply: Reply): { readonly ok: false; readonly failure: ServiceFailure } {
  const failure = reply.kind === "error" && reply.code !== null ? FAILURE_BY_CODE[reply.code] : undefined;
  noteSignInDiagnostic({
    stage,
    reason: reply.kind === "no_answer" ? "no_answer" : reply.kind === "error" && reply.code !== null ? reply.code : "unavailable",
    code: reply.kind === "error" ? reply.status : null,
  });
  return { ok: false, failure: failure ?? "unavailable" };
}

function unparsed(stage: SignInDiagnostic["stage"]): { readonly ok: false; readonly failure: "unavailable" } {
  noteSignInDiagnostic({ stage, reason: "unparsed", code: 200 });
  return UNAVAILABLE;
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
