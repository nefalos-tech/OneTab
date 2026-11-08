import type { PaymentApproval, Result, SignatureBase64 } from "@/lib/wallet/environment";
import type { ApprovalTerms } from "./checkout-view";
import type { Address, AttemptId, MessageHash, SigningPayload } from "./contracts";
import { splitEqually } from "./units";

const CHECKED: unique symbol = Symbol("CheckedPayment");

export type CheckedPayment = {
  readonly [CHECKED]: true;
  readonly attemptId: AttemptId;
  readonly account: Address;
  readonly transaction: Uint8Array;
  readonly message: Uint8Array;
  readonly messageHash: MessageHash;
};

export type CheckFailure = "mismatch" | "unsupported";
export type ReturnFailure = "unchecked";

export type PaymentCheck = {
  /** Before any wallet prompt: the payload must be the payment on screen. */
  readonly payload: (payload: SigningPayload, terms: ApprovalTerms) => Promise<Result<CheckedPayment, CheckFailure>>;
  /** After the wallet answers and before the upload: the approval must be the payer's, over these bytes. */
  readonly returned: (payment: CheckedPayment, approval: PaymentApproval) => Promise<Result<PaymentApproval, ReturnFailure>>;
};

type CheckAnswer = "match" | "mismatch" | "unsupported";

/**
 * Payments' byte check, run only after the fields match the screen. Its implementation, P2's export from
 * src/lib/payments, rebuilds the transaction from `payload.payment` and `payload.blockhash`, derives each
 * token account from its owner and the mint instead of trusting the payload's, and requires the
 * transaction, the message and the hash to match byte for byte. It answers `unsupported` when it can't run.
 */
export type MessageCheck = (payload: SigningPayload) => Promise<CheckAnswer>;

/**
 * P3's check of what the wallet returned: `signature` is `payment.account`'s, over exactly
 * `payment.message`. Its implementation is P3's `verifyWalletSignature` from src/lib/payments. It answers
 * `unsupported` when it can't run.
 */
export type ReturnCheck = (payment: CheckedPayment, signature: SignatureBase64) => Promise<CheckAnswer>;

const MESSAGE_CHECK_PLACEHOLDER: MessageCheck = async () => "unsupported";
const RETURN_CHECK_PLACEHOLDER: ReturnCheck = async () => "unsupported";

export function paymentCheck(messageCheck: MessageCheck, returnCheck: ReturnCheck): PaymentCheck {
  return {
    payload: async (payload, terms) => {
      if (!matchesTerms(payload, terms)) return { ok: false, failure: "mismatch" };
      const bytes = await answerOf(() => messageCheck(payload));
      if (bytes !== "match") return { ok: false, failure: bytes };
      return {
        ok: true,
        value: {
          [CHECKED]: true,
          attemptId: payload.attemptId,
          account: terms.payer,
          transaction: payload.transaction,
          message: payload.message,
          messageHash: payload.messageHash,
        },
      };
    },
    returned: async (payment, approval) => {
      const valid = approval.messageHash === payment.messageHash && (await answerOf(() => returnCheck(payment, approval.signature))) === "match";
      return valid ? { ok: true, value: approval } : { ok: false, failure: "unchecked" };
    },
  };
}

async function answerOf(check: () => Promise<CheckAnswer>): Promise<CheckAnswer> {
  try {
    return await check();
  } catch {
    return "mismatch";
  }
}

export const checkPayment: PaymentCheck = paymentCheck(MESSAGE_CHECK_PLACEHOLDER, RETURN_CHECK_PLACEHOLDER);

/**
 * The payload must describe the payment on screen, split equally as spec.md requires. The expiry height
 * isn't in the signed bytes, so it is compared here, once the room has one.
 */
function matchesTerms(payload: SigningPayload, terms: ApprovalTerms): boolean {
  const { payment } = payload;
  const wallets = payment.contributions.map((c) => c.wallet);
  const equal = splitEqually(terms.totalUnits, terms.payerCount);
  return (
    payload.attemptId === terms.attemptId &&
    payload.checkoutId === terms.checkoutId &&
    payment.network === terms.network &&
    payment.mint === terms.mint &&
    payment.tokenDecimals === terms.tokenDecimals &&
    payment.sellerWallet === terms.seller &&
    payment.feePayerWallet === terms.feePayer &&
    terms.contributions.length === terms.payerCount &&
    terms.contributions.every((c) => c.amountUnits === equal[c.slot]) &&
    payment.contributions.length === terms.contributions.length &&
    payment.contributions.every((c, i) => {
      const expected = terms.contributions[i];
      return expected !== undefined && c.slot === expected.slot && c.wallet === expected.wallet && c.amountUnits === expected.amountUnits;
    }) &&
    wallets.includes(terms.payer) &&
    !wallets.includes(payment.sellerWallet) &&
    new Set(wallets).size === wallets.length &&
    (terms.lastValidBlockHeight === null || payload.lastValidBlockHeight === terms.lastValidBlockHeight)
  );
}
