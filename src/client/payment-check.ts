import type { Result } from "@/lib/wallet/environment";
import type { ApprovalTerms } from "./checkout-view";
import type { Address, AttemptId, MessageHash, SigningPayload } from "./contracts";

const CHECKED: unique symbol = Symbol("CheckedPayment");

/**
 * A payment whose payload matched the screen's terms and whose bytes are exactly that payment. Only
 * `paymentCheck` makes one, because the symbol isn't exported, and the wallet takes nothing else.
 */
export type CheckedPayment = {
  readonly [CHECKED]: true;
  readonly attemptId: AttemptId;
  /** The viewer's wallet, a contributor to this payment and the only account allowed to approve it. */
  readonly account: Address;
  /** The payload's serialized transaction, unedited. */
  readonly transaction: Uint8Array;
  readonly message: Uint8Array;
  readonly messageHash: MessageHash;
};

/**
 * - `mismatch`: a field or byte differs from the payment on screen.
 * - `unsupported`: this browser can't check the bytes.
 * Neither opens the wallet.
 */
export type CheckFailure = "mismatch" | "unsupported";

export type PaymentCheck = (payload: SigningPayload, terms: ApprovalTerms) => Promise<Result<CheckedPayment, CheckFailure>>;
