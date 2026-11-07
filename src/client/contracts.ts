/** Integer token units as a decimal string in the u64 range. */
export type TokenUnits = string & { readonly __brand: "TokenUnits" };

/** A base58 public key: a wallet, the seller or the mint. */
export type Address = string & { readonly __brand: "Address" };

/** The UUID of a real checkout, in lowercase. A `sample-<name>` route segment can never parse as one. */
export type CheckoutId = string & { readonly __brand: "CheckoutId" };

export type AttemptId = string & { readonly __brand: "AttemptId" };

/** The SHA-256 of a payment message, as 64 lowercase hex digits. */
export type MessageHash = string & { readonly __brand: "MessageHash" };

/** The last block height a payment message is valid for, as a decimal string in the u64 range. */
export type BlockHeight = string & { readonly __brand: "BlockHeight" };

export const U64_MAX = 18446744073709551615n;

const isU64Decimal = (s: string): boolean => /^(0|[1-9][0-9]*)$/.test(s) && BigInt(s) <= U64_MAX;

export function isTokenUnits(s: string): s is TokenUnits {
  return isU64Decimal(s);
}

export function isBlockHeight(s: string): s is BlockHeight {
  return isU64Decimal(s);
}

export function isMessageHash(s: string): s is MessageHash {
  return /^[0-9a-f]{64}$/.test(s);
}

export function looksLikeAddress(s: string): s is Address {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCheckoutId(s: string): s is CheckoutId {
  return UUID.test(s);
}

export function isAttemptId(s: string): s is AttemptId {
  return UUID.test(s);
}

/** A UUID names the same checkout in any case, so every request, link and comparison uses one spelling. */
export function parseCheckoutId(text: string): CheckoutId | null {
  const id = text.toLowerCase();
  return isCheckoutId(id) ? id : null;
}

export function parseAttemptId(text: string): AttemptId | null {
  const id = text.toLowerCase();
  return isAttemptId(id) ? id : null;
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

export const PAYER_COUNTS = [2, 3] as const;
export type PayerCount = (typeof PAYER_COUNTS)[number];
export const FEWEST_PAYERS: PayerCount = PAYER_COUNTS.reduce((a, b) => (b < a ? b : a));
const MOST_PAYERS: PayerCount = PAYER_COUNTS.reduce((a, b) => (b > a ? b : a));

const isPayerCount = (value: unknown): value is PayerCount => PAYER_COUNTS.some((n) => n === value);

export function parsePayerCount(text: string): PayerCount | null {
  return PAYER_COUNTS.find((n) => String(n) === text) ?? null;
}

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
  readonly id: AttemptId;
  readonly state: AttemptState;
  readonly signedWallets: readonly Address[];
  readonly transactionReference: string | null;
  readonly lastValidBlockHeight: BlockHeight | null;
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

export type ClientRequestId = string & { readonly __brand: "ClientRequestId" };

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

export type SigningPayload = {
  readonly attemptId: AttemptId;
  readonly checkoutId: CheckoutId;
  readonly transaction: Uint8Array;
  readonly message: Uint8Array;
  readonly messageHash: MessageHash;
  readonly blockhash: string;
  readonly lastValidBlockHeight: BlockHeight;
  readonly payment: {
    readonly network: Network;
    readonly mint: Address;
    readonly tokenDecimals: number;
    readonly sellerWallet: Address;
    readonly sellerTokenAccount: Address;
    readonly feePayerWallet: Address;
    readonly contributions: readonly PaymentContribution[];
  };
};

export type PaymentContribution = {
  readonly slot: number;
  readonly wallet: Address;
  readonly sourceTokenAccount: Address;
  readonly amountUnits: TokenUnits;
};

export type ApprovalUpload = { readonly messageHash: MessageHash; readonly signatureBase64: string };

export function parseRoomSnapshot(data: unknown): RoomSnapshot | null {
  if (!isRecord(data) || !isOneOf(data.phase, PHASES)) return null;
  const checkout = parseCheckout(data.checkout);
  if (checkout === undefined) return null;
  const participants = listOf(data.participants, (p) => parseParticipant(p, checkout.payerCount));
  const attempt = data.attempt === null ? null : parseAttempt(data.attempt, checkout.payerCount);
  if (participants === undefined || attempt === undefined) return null;
  return { checkout, participants, phase: data.phase, attempt };
}

export function parseAttemptSummary(data: unknown): AttemptSummary | null {
  return parseAttempt(data, MOST_PAYERS) ?? null;
}

export function parseSigningPayload(data: unknown): SigningPayload | null {
  if (!isRecord(data) || !isRecord(data.payment)) return null;
  const { messageHash, blockhash, lastValidBlockHeight } = data;
  const { network, mint, tokenDecimals, sellerWallet, sellerTokenAccount, feePayerWallet } = data.payment;
  const attemptId = typeof data.attemptId === "string" ? parseAttemptId(data.attemptId) : null;
  const checkoutId = typeof data.checkoutId === "string" ? parseCheckoutId(data.checkoutId) : null;
  const transaction = typeof data.transactionBase64 === "string" ? decodePaddedBase64(data.transactionBase64) : null;
  const message = typeof data.messageBase64 === "string" ? decodePaddedBase64(data.messageBase64) : null;
  const contributions = listOf(data.payment.contributions, parsePaymentContribution);
  const inSlotOrder =
    contributions !== undefined && isPayerCount(contributions.length) && contributions.every((c, index) => c.slot === index);
  return attemptId !== null &&
    checkoutId !== null &&
    isSomeBytes(transaction) &&
    isSomeBytes(message) &&
    typeof messageHash === "string" &&
    isMessageHash(messageHash) &&
    isAddress(blockhash) &&
    isHeight(lastValidBlockHeight) &&
    network === "devnet" &&
    isAddress(mint) &&
    isDecimals(tokenDecimals) &&
    isAddress(sellerWallet) &&
    isAddress(sellerTokenAccount) &&
    isAddress(feePayerWallet) &&
    inSlotOrder
    ? {
        attemptId,
        checkoutId,
        transaction,
        message,
        messageHash,
        blockhash,
        lastValidBlockHeight,
        payment: { network, mint, tokenDecimals, sellerWallet, sellerTokenAccount, feePayerWallet, contributions },
      }
    : null;
}

export function parsePublicConfig(data: unknown): PublicConfig | null {
  if (!isRecord(data)) return null;
  const { network, mint, tokenDecimals, confirmationTarget } = data;
  return network === "devnet" && isAddress(mint) && isDecimals(tokenDecimals) && confirmationTarget === "finalized"
    ? { network, mint, tokenDecimals, confirmationTarget }
    : null;
}

function parseCheckout(data: unknown): Checkout | undefined {
  if (!isRecord(data)) return undefined;
  const { title, organizerWallet, sellerWallet, network, mint, tokenDecimals, totalUnits, payerCount, createdAt } = data;
  const id = typeof data.id === "string" ? parseCheckoutId(data.id) : null;
  return id !== null &&
    typeof title === "string" &&
    isAddress(organizerWallet) &&
    isAddress(sellerWallet) &&
    network === "devnet" &&
    isAddress(mint) &&
    isDecimals(tokenDecimals) &&
    isUnits(totalUnits) &&
    isPayerCount(payerCount) &&
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
  const { state, transactionReference, lastValidBlockHeight, canRetry } = data;
  const id = typeof data.id === "string" ? parseAttemptId(data.id) : null;
  const signedWallets = listOf(data.signedWallets, (w) => (isAddress(w) ? w : undefined));
  const error = data.error === null ? null : parseAttemptError(data.error);
  const receipt = data.receipt === null ? null : parseReceipt(data.receipt, payerCount);
  return id !== null &&
    isOneOf(state, ATTEMPT_STATES) &&
    signedWallets !== undefined &&
    isStringOrNull(transactionReference) &&
    (lastValidBlockHeight === null || isHeight(lastValidBlockHeight)) &&
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

function parsePaymentContribution(data: unknown): PaymentContribution | undefined {
  if (!isRecord(data)) return undefined;
  const { slot, wallet, sourceTokenAccount, amountUnits } = data;
  return isSlot(slot, MOST_PAYERS) && isAddress(wallet) && isAddress(sourceTokenAccount) && isUnits(amountUnits)
    ? { slot, wallet, sourceTokenAccount, amountUnits }
    : undefined;
}

/** The standard alphabet in whole four-character groups, with `=` padding only at the end. */
const PADDED_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodePaddedBase64(text: string): Uint8Array | null {
  return PADDED_BASE64.test(text) ? Uint8Array.from(atob(text), (char) => char.charCodeAt(0)) : null;
}

/** Empty bytes are no payment. */
const isSomeBytes = (bytes: Uint8Array | null): bytes is Uint8Array => bytes !== null && bytes.length > 0;

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
const isHeight = (value: unknown): value is BlockHeight => typeof value === "string" && isBlockHeight(value);
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isSlot = (value: unknown, payerCount: PayerCount): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < payerCount;
/** A Solana mint stores its decimals in one byte. */
const isDecimals = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
