/** Integer token units as a decimal string in the u64 range. */
export type TokenUnits = string & { readonly __brand: "TokenUnits" };

/** A base58 public key: a wallet, the seller or the mint. */
export type Address = string & { readonly __brand: "Address" };

/** The UUID of a real checkout. A `sample-<name>` route segment can never parse as one. */
export type CheckoutId = string & { readonly __brand: "CheckoutId" };

export const U64_MAX = 18446744073709551615n;

export function isTokenUnits(s: string): s is TokenUnits {
  return /^(0|[1-9][0-9]*)$/.test(s) && BigInt(s) <= U64_MAX;
}

export function looksLikeAddress(s: string): s is Address {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCheckoutId(s: string): s is CheckoutId {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export type Network = "devnet";
export type ConfirmationTarget = "finalized";

export type PublicConfig = {
  readonly network: Network;
  readonly mint: Address;
  readonly tokenDecimals: number;
  readonly confirmationTarget: ConfirmationTarget;
};

/** GET /api/auth/session data. Signed out is `null` at use sites. */
export type Session = { readonly wallet: Address; readonly expiresAt: string };

export type PayerCount = 2 | 3;

export type Checkout = {
  readonly id: CheckoutId;
  readonly title: string;
  readonly organizerWallet: Address;
  readonly sellerWallet: Address;
  readonly network: Network;
  readonly mint: Address;
  readonly tokenDecimals: number;
  readonly totalUnits: TokenUnits;
  readonly payerCount: PayerCount;
  readonly createdAt: string;
};

/** Joined payers only. Open spots have no record. */
export type Participant = {
  readonly slot: number;
  readonly wallet: Address;
  readonly shareUnits: TokenUnits;
  readonly ready: boolean;
};

/** Server-derived. The UI reads it and never recomputes it. */
export const PHASES = ["open", "ready", "paying", "paid", "needs_attention"] as const;
export type Phase = (typeof PHASES)[number];

export const ATTEMPT_STATES = [
  "preparing",
  "signing",
  "submitting",
  "unresolved",
  "declined",
  "confirmed",
  "failed",
  "expired",
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_SIGNATURE",
  "MESSAGE_MISMATCH",
  "UNSUPPORTED_WALLET",
  "INVALID_PAYMENT",
  "UNAUTHENTICATED",
  "CHALLENGE_EXPIRED",
  "CHALLENGE_USED",
  "FORBIDDEN",
  "ORIGIN_MISMATCH",
  "CHECKOUT_NOT_FOUND",
  "ATTEMPT_NOT_FOUND",
  "ROOM_FULL",
  "ROOM_NOT_READY",
  "CHECKOUT_PAID",
  "ATTEMPT_NOT_SIGNABLE",
  "SIGNATURES_INCOMPLETE",
  "RETRY_BLOCKED",
  "IDEMPOTENCY_CONFLICT",
  "INSUFFICIENT_USDC",
  "INSUFFICIENT_SOL",
  "TOKEN_ACCOUNT_MISSING",
  "RATE_LIMITED",
  "CONFIGURATION_UNAVAILABLE",
  "RPC_UNAVAILABLE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return isOneOf(value, ERROR_CODES);
}

/** PROVISIONAL(B1): contracts.md leaves AttemptSummary.error open. Mirrors the error envelope. */
export type AttemptError = { readonly code: ErrorCode; readonly message: string };

/** PROVISIONAL(B1): mirrors SigningPayload contributions without sourceTokenAccount. */
export type ReceiptContribution = {
  readonly slot: number;
  readonly wallet: Address;
  readonly amountUnits: TokenUnits;
};

export type Receipt = {
  readonly transactionReference: string;
  readonly confirmationStatus: ConfirmationTarget;
  readonly sellerWallet: Address;
  readonly totalUnits: TokenUnits;
  readonly contributions: readonly ReceiptContribution[];
  readonly observedAt: string;
  /** PROVISIONAL(B1): contracts.md names "the Devnet explorer URL" without a field name. */
  readonly explorerUrl: string;
};

export type AttemptSummary = {
  readonly id: string;
  readonly state: AttemptState;
  readonly signedWallets: readonly Address[];
  readonly transactionReference: string | null;
  readonly lastValidBlockHeight: string | null;
  readonly error: AttemptError | null;
  /** Server decision. The only input that can enable Try again. */
  readonly canRetry: boolean;
  readonly receipt: Receipt | null;
};

export type RoomSnapshot = {
  readonly checkout: Checkout;
  readonly participants: readonly Participant[];
  readonly phase: Phase;
  readonly attempt: AttemptSummary | null;
};

/** A client-generated UUID that makes POST /api/checkouts idempotent for one organizer. */
export type ClientRequestId = string & { readonly __brand: "ClientRequestId" };

/** PROVISIONAL(B1): POST /api/checkouts body. */
export type CreateCheckoutBody = {
  readonly title: string;
  readonly sellerWallet: Address;
  readonly totalUnits: TokenUnits;
  readonly payerCount: PayerCount;
  readonly clientRequestId: ClientRequestId;
};

/** PROVISIONAL(B1): POST /api/auth/challenge data. */
export type AuthChallenge = { readonly challengeId: string; readonly messageBase64: string; readonly expiresAt: string };

/** PROVISIONAL(B1): POST /api/auth/verify body. */
export type AuthVerifyRequest = { readonly challengeId: string; readonly signatureBase64: string };

/**
 * PROVISIONAL(B1): the boundary check for a room the server sent, until B1 publishes runtime schemas.
 * It checks field types, branded strings, enums, a payer count of 2 or 3 and slots inside it, and returns
 * a fresh object with only the contract's fields. It doesn't re-check server invariants such as shares
 * summing to the total. deriveRoomView trusts its input, so a lane mismatch reads as an outage here
 * instead of a crash inside the view.
 */
export function parseRoomSnapshot(data: unknown): RoomSnapshot | null {
  if (!isRecord(data) || !isOneOf(data.phase, PHASES)) return null;
  const checkout = parseCheckout(data.checkout);
  if (checkout === undefined) return null;
  const participants = listOf(data.participants, (p) => parseParticipant(p, checkout.payerCount));
  const attempt = data.attempt === null ? null : parseAttempt(data.attempt, checkout.payerCount);
  if (participants === undefined || attempt === undefined) return null;
  return { checkout, participants, phase: data.phase, attempt };
}

/** PROVISIONAL(B1): GET /api/config data. */
export function parsePublicConfig(data: unknown): PublicConfig | null {
  if (!isRecord(data)) return null;
  const { network, mint, tokenDecimals, confirmationTarget } = data;
  return network === "devnet" && isAddress(mint) && isDecimals(tokenDecimals) && confirmationTarget === "finalized"
    ? { network, mint, tokenDecimals, confirmationTarget }
    : null;
}

// The parsers below return undefined when the data doesn't parse, because null is a valid attempt,
// attempt error and receipt.

function parseCheckout(data: unknown): Checkout | undefined {
  if (!isRecord(data)) return undefined;
  const { id, title, organizerWallet, sellerWallet, network, mint, tokenDecimals, totalUnits, payerCount, createdAt } = data;
  return typeof id === "string" &&
    isCheckoutId(id) &&
    typeof title === "string" &&
    isAddress(organizerWallet) &&
    isAddress(sellerWallet) &&
    network === "devnet" &&
    isAddress(mint) &&
    isDecimals(tokenDecimals) &&
    isUnits(totalUnits) &&
    (payerCount === 2 || payerCount === 3) &&
    isTimestamp(createdAt)
    ? { id, title, organizerWallet, sellerWallet, network, mint, tokenDecimals, totalUnits, payerCount, createdAt }
    : undefined;
}

function parseParticipant(data: unknown, payerCount: PayerCount): Participant | undefined {
  if (!isRecord(data)) return undefined;
  const { slot, wallet, shareUnits, ready } = data;
  return isSlot(slot, payerCount) && isAddress(wallet) && isUnits(shareUnits) && typeof ready === "boolean"
    ? { slot, wallet, shareUnits, ready }
    : undefined;
}

function parseAttempt(data: unknown, payerCount: PayerCount): AttemptSummary | undefined {
  if (!isRecord(data)) return undefined;
  const { id, state, transactionReference, lastValidBlockHeight, canRetry } = data;
  const signedWallets = listOf(data.signedWallets, (w) => (isAddress(w) ? w : undefined));
  const error = data.error === null ? null : parseAttemptError(data.error);
  const receipt = data.receipt === null ? null : parseReceipt(data.receipt, payerCount);
  return typeof id === "string" &&
    isOneOf(state, ATTEMPT_STATES) &&
    signedWallets !== undefined &&
    isStringOrNull(transactionReference) &&
    isStringOrNull(lastValidBlockHeight) &&
    error !== undefined &&
    typeof canRetry === "boolean" &&
    receipt !== undefined
    ? { id, state, signedWallets, transactionReference, lastValidBlockHeight, error, canRetry, receipt }
    : undefined;
}

function parseAttemptError(data: unknown): AttemptError | undefined {
  return isRecord(data) && isErrorCode(data.code) && typeof data.message === "string"
    ? { code: data.code, message: data.message }
    : undefined;
}

function parseReceipt(data: unknown, payerCount: PayerCount): Receipt | undefined {
  if (!isRecord(data)) return undefined;
  const { transactionReference, confirmationStatus, sellerWallet, totalUnits, observedAt, explorerUrl } = data;
  const contributions = listOf(data.contributions, (c) => parseContribution(c, payerCount));
  return typeof transactionReference === "string" &&
    confirmationStatus === "finalized" &&
    isAddress(sellerWallet) &&
    isUnits(totalUnits) &&
    contributions !== undefined &&
    isTimestamp(observedAt) &&
    typeof explorerUrl === "string"
    ? { transactionReference, confirmationStatus, sellerWallet, totalUnits, contributions, observedAt, explorerUrl }
    : undefined;
}

function parseContribution(data: unknown, payerCount: PayerCount): ReceiptContribution | undefined {
  if (!isRecord(data)) return undefined;
  const { slot, wallet, amountUnits } = data;
  return isSlot(slot, payerCount) && isAddress(wallet) && isUnits(amountUnits) ? { slot, wallet, amountUnits } : undefined;
}

function listOf<T>(data: unknown, parse: (item: unknown) => T | undefined): readonly T[] | undefined {
  if (!Array.isArray(data)) return undefined;
  const items: T[] = [];
  for (const item of data) {
    const parsed = parse(item);
    if (parsed === undefined) return undefined;
    items.push(parsed);
  }
  return items;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return (options as readonly unknown[]).includes(value);
}

const isAddress = (value: unknown): value is Address => typeof value === "string" && looksLikeAddress(value);
const isUnits = (value: unknown): value is TokenUnits => typeof value === "string" && isTokenUnits(value);
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isSlot = (value: unknown, payerCount: PayerCount): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < payerCount;
/** A Solana mint stores its decimals in one byte. */
const isDecimals = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
