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

/**
 * Payments' byte check, run only after the fields match the screen. Its implementation, P2's export from
 * src/lib/payments, rebuilds the transaction from `payload.payment` and `payload.blockhash`, derives each
 * token account from its owner and the mint instead of trusting the payload's, and requires the
 * transaction, the message and the hash to match byte for byte. It answers `unsupported` when it can't run.
 */
export type MessageCheck = (payload: SigningPayload) => Promise<"match" | "mismatch" | "unsupported">;

/** Answers `unsupported` until Payments exports its validator, so no live approval opens a wallet before then. */
const PAYMENTS_MESSAGE_CHECK: MessageCheck = async () => "unsupported";

export function paymentCheck(messageCheck: MessageCheck): PaymentCheck {
  return async (payload, terms) => {
    if (!matchesTerms(payload, terms)) return { ok: false, failure: "mismatch" };
    let bytes: Awaited<ReturnType<MessageCheck>>;
    try {
      bytes = await messageCheck(payload);
    } catch {
      bytes = "mismatch";
    }
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
  };
}

export const checkPayment: PaymentCheck = paymentCheck(PAYMENTS_MESSAGE_CHECK);

/**
 * The payload must describe the payment on screen. The expiry height isn't in the signed bytes, so it is
 * compared here, once the room has one.
 */
function matchesTerms(payload: SigningPayload, terms: ApprovalTerms): boolean {
  const { payment } = payload;
  const wallets = payment.contributions.map((c) => c.wallet);
  const sum = payment.contributions.reduce((total, c) => total + BigInt(c.amountUnits), 0n);
  return (
    payload.attemptId === terms.attemptId &&
    payload.checkoutId === terms.checkoutId &&
    payment.network === terms.network &&
    payment.mint === terms.mint &&
    payment.tokenDecimals === terms.tokenDecimals &&
    payment.sellerWallet === terms.seller &&
    payment.feePayerWallet === terms.feePayer &&
    payment.contributions.length === terms.contributions.length &&
    payment.contributions.every((c, i) => {
      const expected = terms.contributions[i];
      return expected !== undefined && c.slot === expected.slot && c.wallet === expected.wallet && c.amountUnits === expected.amountUnits;
    }) &&
    sum === BigInt(terms.totalUnits) &&
    wallets.includes(terms.payer) &&
    !wallets.includes(payment.sellerWallet) &&
    new Set(wallets).size === wallets.length &&
    (terms.lastValidBlockHeight === null || payload.lastValidBlockHeight === terms.lastValidBlockHeight)
  );
}
