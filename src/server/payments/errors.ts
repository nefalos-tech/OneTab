import type { ApiError, ErrorCode } from "../../contracts/index.js";
import { PaymentPreflightFailure } from "./preflight.js";

const failures = {
  INVALID_INPUT: [400, "The request is invalid."],
  INVALID_SIGNATURE: [400, "The signature is invalid for this payer and payment."],
  MESSAGE_MISMATCH: [400, "The signature does not refer to this payment message."],
  UNSUPPORTED_WALLET: [400, "This wallet cannot sign the payment."],
  INVALID_PAYMENT: [400, "The payment does not match the frozen checkout."],
  UNAUTHENTICATED: [401, "Authenticate your wallet to continue."],
  CHALLENGE_EXPIRED: [401, "The authentication challenge expired."],
  CHALLENGE_USED: [401, "The authentication challenge was already used."],
  FORBIDDEN: [403, "This wallet cannot perform that action."],
  ORIGIN_MISMATCH: [403, "The request origin is not allowed."],
  CHECKOUT_NOT_FOUND: [404, "The checkout was not found."],
  ATTEMPT_NOT_FOUND: [404, "The payment attempt was not found."],
  ROOM_FULL: [409, "The checkout already has all payers."],
  ROOM_NOT_READY: [409, "All payer slots must be filled and ready."],
  CHECKOUT_PAID: [409, "This checkout is already paid."],
  ATTEMPT_NOT_SIGNABLE: [409, "This attempt is not accepting signatures."],
  SIGNATURES_INCOMPLETE: [409, "The payment is waiting for payer signatures."],
  RETRY_BLOCKED: [409, "The existing payment must be resolved before retrying."],
  IDEMPOTENCY_CONFLICT: [409, "This request conflicts with the stored payment."],
  INSUFFICIENT_USDC: [422, "A payer needs more Devnet USDC for their contribution."],
  INSUFFICIENT_SOL: [422, "The organizer needs more Devnet SOL for the network fee."],
  TOKEN_ACCOUNT_MISSING: [422, "A required prepared token account is missing."],
  RATE_LIMITED: [429, "Too many requests. Try again later."],
  CONFIGURATION_UNAVAILABLE: [503, "Payment configuration is unavailable."],
  RPC_UNAVAILABLE: [503, "The payment network is unavailable. Check this attempt again."],
} satisfies Record<ErrorCode, readonly [number, string]>;

export class PaymentFailure extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode) {
    super(failures[code][1]);
    this.name = "PaymentFailure";
    this.code = code;
    this.status = failures[code][0];
  }
}

export function paymentFailure(error: unknown): PaymentFailure {
  if (error instanceof PaymentFailure) return error;
  if (error instanceof PaymentPreflightFailure) {
    switch (error.code) {
      case "INSUFFICIENT_USDC": case "INSUFFICIENT_SOL": case "TOKEN_ACCOUNT_MISSING":
        return new PaymentFailure(error.code);
      case "FEE_UNAVAILABLE": return new PaymentFailure("RPC_UNAVAILABLE");
      case "WRONG_NETWORK": return new PaymentFailure("CONFIGURATION_UNAVAILABLE");
      default: return new PaymentFailure("INVALID_PAYMENT");
    }
  }
  return new PaymentFailure("CONFIGURATION_UNAVAILABLE");
}

export function publicPaymentError(code: ErrorCode): ApiError {
  return { code, message: failures[code][1] };
}

export function observedPaymentError(error: string | null): ApiError | null {
  if (error === null) return null;
  return publicPaymentError(isErrorCode(error) ? error : "RPC_UNAVAILABLE");
}

function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(failures, value);
}
