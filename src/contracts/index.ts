export type Network = "devnet";
export type DecimalString = string;
export type Base64 = string;
export type AttemptState =
  | "preparing"
  | "signing"
  | "submitting"
  | "unresolved"
  | "declined"
  | "confirmed"
  | "failed"
  | "expired";
export type RoomPhase = "open" | "ready" | "paying" | "paid" | "needs_attention";

export interface PublicConfig {
  network: Network;
  mint: string;
  tokenDecimals: number;
  confirmationTarget: "finalized";
}

export interface Checkout {
  id: string;
  title: string;
  organizerWallet: string;
  sellerWallet: string;
  network: Network;
  mint: string;
  tokenDecimals: number;
  totalUnits: DecimalString;
  payerCount: 2 | 3;
  createdAt: string;
}

export interface Participant {
  slot: number;
  wallet: string;
  shareUnits: DecimalString;
  ready: boolean;
}

export interface Contribution {
  slot: number;
  wallet: string;
  amountUnits: DecimalString;
}

export interface Receipt {
  transactionReference: string;
  confirmationStatus: "finalized";
  sellerWallet: string;
  totalUnits: DecimalString;
  contributions: Contribution[];
  observedAt: string;
  explorerUrl: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
}

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

export type ApiResponse<T> = { data: T } | { error: ApiError };

export interface AttemptSummary {
  id: string;
  state: AttemptState;
  signedWallets: string[];
  transactionReference: string | null;
  lastValidBlockHeight: DecimalString | null;
  error: ApiError | null;
  canRetry: boolean;
  receipt: Receipt | null;
}

export interface RoomSnapshot {
  checkout: Checkout;
  participants: Participant[];
  phase: RoomPhase;
  attempt: AttemptSummary | null;
}

export interface PaymentContribution extends Contribution {
  sourceTokenAccount: string;
}

export interface PaymentSummary {
  network: Network;
  mint: string;
  tokenDecimals: number;
  sellerWallet: string;
  sellerTokenAccount: string;
  feePayerWallet: string;
  contributions: PaymentContribution[];
}

export interface SigningPayload {
  attemptId: string;
  checkoutId: string;
  transactionBase64: Base64;
  messageBase64: Base64;
  messageHash: string;
  blockhash: string;
  lastValidBlockHeight: DecimalString;
  payment: PaymentSummary;
}

export interface WalletBridge {
  connect(): Promise<{
    wallet: string;
    capabilities: { signAuthentication: boolean; signPayment: boolean };
  }>;
  disconnect(): Promise<void>;
  signAuthentication(input: {
    messageBase64: Base64;
  }): Promise<{ signatureBase64: Base64 }>;
  signPayment(input: {
    payload: SigningPayload;
  }): Promise<{
    signerWallet: string;
    messageHash: string;
    signatureBase64: Base64;
  }>;
}

export type DecimalUnits = string & { readonly __brand: "DecimalUnits" };

export function isDecimalUnits(value: unknown): value is DecimalUnits {
  return (
    typeof value === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    BigInt(value) <= 18446744073709551615n
  );
}
