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
export type Phase = "open" | "ready" | "paying" | "paid" | "needs_attention";

export type AttemptState =
  | "preparing"
  | "signing"
  | "submitting"
  | "unresolved"
  | "declined"
  | "confirmed"
  | "failed"
  | "expired";

export type ErrorCode =
  | "INVALID_INPUT"
  | "INVALID_SIGNATURE"
  | "MESSAGE_MISMATCH"
  | "UNSUPPORTED_WALLET"
  | "INVALID_PAYMENT"
  | "UNAUTHENTICATED"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_USED"
  | "FORBIDDEN"
  | "ORIGIN_MISMATCH"
  | "CHECKOUT_NOT_FOUND"
  | "ATTEMPT_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_NOT_READY"
  | "CHECKOUT_PAID"
  | "ATTEMPT_NOT_SIGNABLE"
  | "SIGNATURES_INCOMPLETE"
  | "RETRY_BLOCKED"
  | "IDEMPOTENCY_CONFLICT"
  | "INSUFFICIENT_USDC"
  | "INSUFFICIENT_SOL"
  | "TOKEN_ACCOUNT_MISSING"
  | "RATE_LIMITED"
  | "CONFIGURATION_UNAVAILABLE"
  | "RPC_UNAVAILABLE";

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
