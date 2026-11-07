import type { Address, MessageHash, Session } from "@/client/contracts";
import type { CheckedPayment } from "@/client/payment-check";

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

export type ServiceFailure = "stale_challenge" | "unsupported_wallet" | "unavailable";
export type ServiceResult<T> = Result<T, ServiceFailure>;

export type ChallengeId = string & { readonly __brand: "ChallengeId" };
export type SignatureBase64 = string & { readonly __brand: "SignatureBase64" };

export type AuthMessage = { readonly bytes: Uint8Array; readonly text: string; readonly __brand: "AuthMessage" };

export type Challenge = { readonly id: ChallengeId; readonly message: AuthMessage };

export type WalletCapabilities = {
  /** wallet.chains includes solana:devnet. The wallet UI's current network can't be read. */
  readonly devnet: boolean;
  readonly signMessage: boolean;
  readonly signTransaction: boolean;
};

export type PaymentApproval = { readonly messageHash: MessageHash; readonly signature: SignatureBase64 };

export type SignFailure = "rejected" | "stale" | "busy" | "failed";

export interface PaymentSigner {
  sign(payment: CheckedPayment): Promise<Result<PaymentApproval, SignFailure>>;
  /** Drops a kept approval that was refused, so the next `sign` for that message opens the wallet again. */
  forget(approval: PaymentApproval): void;
  /** Whether the sign-in that asked for this payment is still the page's. Checked right before the upload. */
  isCurrent(payment: CheckedPayment): boolean;
}

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
  /**
   * Asks the wallet to approve `payment.transaction`, exactly as given, without sending it. Refuses
   * without prompting when `payment.account` isn't the selected account. Returns only that account's
   * signature, after checking the returned transaction has the same message and no other signature.
   * The returned transaction never leaves the bridge.
   */
  signPayment(payment: CheckedPayment): Promise<BridgeResult<SignatureBase64>>;
  onAccountChange(listener: (account: Address | null) => void): () => void;
}

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

export type WalletEnvironment = { readonly bridge: WalletBridge; readonly service: SignInService };

export function capabilityFailure(c: WalletCapabilities): "wrong_network" | "cannot_sign" | null {
  if (!c.signMessage || !c.signTransaction) return "cannot_sign";
  if (!c.devnet) return "wrong_network";
  return null;
}

/**
 * A serialized Solana transaction message starts with a control byte or an invalid UTF-8 byte, so
 * this is a second fence behind the type.
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
