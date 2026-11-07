// The two ports a session store runs against, and the domain types that cross them.
// No wire types and no provider types appear here. live.ts and sample.ts parse into these.

import type { Address, Session } from "@/client/contracts";

/** Every port call resolves. Failures are values the machine branches on, never exceptions. */
export type Result<T, F extends string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: F };

/**
 * Why a wallet call did not produce a value. `rejected` only for the provider's rejection code
 * (4001); any other provider error is `failed`. A rejection code is not proof of a human action, so
 * no failure here ever reaches the server.
 */
export type BridgeFailure = "rejected" | "no_wallet" | "wrong_network" | "cannot_sign" | "failed";
export type BridgeResult<T> = Result<T, BridgeFailure>;

/** Why an auth route did not produce a value. Wire codes are mapped in live.ts and stop there. */
export type ServiceFailure = "stale_challenge" | "unsupported_wallet" | "unavailable";
export type ServiceResult<T> = Result<T, ServiceFailure>;

export type ChallengeId = string & { readonly __brand: "ChallengeId" };
export type SignatureBase64 = string & { readonly __brand: "SignatureBase64" };

/**
 * Bytes a server challenge asked the wallet to sign. Only `authMessage` makes one, so transaction
 * bytes can't reach `signAuthentication` without a visible, greppable conversion.
 */
export type AuthMessage = { readonly bytes: Uint8Array; readonly text: string; readonly __brand: "AuthMessage" };

export type Challenge = { readonly id: ChallengeId; readonly message: AuthMessage };

/** What a wallet offers, as an adapter reads it from the provider. */
export type WalletCapabilities = {
  /** wallet.chains includes solana:devnet. The wallet UI's current network can't be read. */
  readonly devnet: boolean;
  readonly signMessage: boolean;
  readonly signTransaction: boolean;
};

/** PROVISIONAL(B1): replaced by src/contracts' SigningPayload. Nothing in F2 constructs one. */
export type SigningPayload = { readonly __pending: "B1 SigningPayload" };

/**
 * contracts.md's WalletBridge. One instance per environment.
 *
 * Contract every implementation keeps (the machine relies on it):
 * - `onAccountChange` reports each change of the selected address after `connect` resolves,
 *   including a change between the user's approval and the subscription, and reports `null` when the
 *   wallet disconnects or unregisters. Same-address events are not reported.
 * - `signAuthentication` refuses without prompting when `account` is not the selected account.
 */
export interface WalletBridge {
  /** Opens the wallet's connection prompt. Refuses a wallet lacking OneTab's capabilities. */
  connect(): Promise<BridgeResult<Address>>;
  /** Clears the local connection. Never fails from the caller's point of view. */
  disconnect(): Promise<void>;
  /** Signs exactly `message.bytes` with `account`. Never signs transaction bytes. */
  signAuthentication(input: {
    readonly account: Address;
    readonly message: AuthMessage;
  }): Promise<BridgeResult<SignatureBase64>>;
  /** F4. Every F2 implementation returns `{ ok: false, failure: "failed" }` without prompting. */
  signPayment(input: { readonly account: Address; readonly payload: SigningPayload }): Promise<BridgeResult<never>>;
  onAccountChange(listener: (account: Address | null) => void): () => void;
}

/** The four auth routes in contracts.md, as domain operations. */
export interface SignInService {
  /** GET /api/auth/session. `null` when the browser holds no live session. */
  readSession(): Promise<ServiceResult<Session | null>>;
  /** POST /api/auth/challenge. */
  requestChallenge(wallet: Address): Promise<ServiceResult<Challenge>>;
  /** POST /api/auth/verify. The server sets the cookie on success. */
  verify(input: {
    readonly challengeId: ChallengeId;
    readonly signature: SignatureBase64;
  }): Promise<ServiceResult<Session>>;
  /** DELETE /api/auth/session. Idempotent. Failures are swallowed: the browser is already signed out. */
  endSession(): Promise<void>;
}

/** A matched pair. Only liveEnvironment() and sampleEnvironment() build one. */
export type WalletEnvironment = { readonly bridge: WalletBridge; readonly service: SignInService };

/** OneTab needs Devnet, message signing (sign-in) and transaction signing (F4 approvals). */
export function capabilityFailure(c: WalletCapabilities): "wrong_network" | "cannot_sign" | null {
  if (!c.signMessage || !c.signTransaction) return "cannot_sign";
  if (!c.devnet) return "wrong_network";
  return null;
}

/**
 * The only constructor of AuthMessage. Accepts printable UTF-8 text only. A serialized Solana
 * transaction message starts with a control byte or an invalid UTF-8 byte, so this is a second
 * fence behind the type.
 */
export function authMessage(bytes: Uint8Array): AuthMessage | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (text.trim() === "" || [...text].some(isControl)) return null;
  return { bytes, text, __brand: "AuthMessage" } as AuthMessage;
}

const LINE_BREAKS_AND_TABS = new Set(["\n", "\r", "\t"]);

function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return !LINE_BREAKS_AND_TABS.has(char) && (code < 0x20 || (code >= 0x7f && code <= 0x9f));
}
