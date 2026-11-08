import { address, getAddressEncoder } from "@solana/kit";
import type { SigningPayload as WirePayload } from "@/contracts";
import type { ValidatedSigningPayload } from "@/lib/payments/signing-payload";
import type { PaymentApproval, Result, SignatureBase64 } from "@/lib/wallet/environment";
import type { ApprovalTerms } from "./checkout-view";
import type { Address, AttemptId, BlockHeight, Checkout, MessageHash, Participant, RoomSnapshot, SigningPayload } from "./contracts";
import { splitEqually } from "./units";

const CHECKED: unique symbol = Symbol("CheckedPayment");

export type CheckedPayment = {
  /** Payments' result for exactly these bytes. Only this module can read it, and only paymentCheck makes one. */
  readonly [CHECKED]: ValidatedSigningPayload;
  readonly attemptId: AttemptId;
  readonly account: Address;
  /** Payments' own copy of the transaction it validated. The wallet is asked to approve exactly these bytes. */
  readonly transaction: Uint8Array;
  readonly messageHash: MessageHash;
  /**
   * Runs the server's check of a wallet's returned transaction: the same message, no other payer's signature,
   * and a valid signature by this account. Answers that signature, or null. Never throws.
   */
  readonly signatureIn: (returned: Uint8Array) => Promise<SignatureBase64 | null>;
};

/**
 * - `mismatch`: the payload isn't the payment on screen, or Payments refused its bytes.
 * - `room_changed`: the room read after the payload no longer waits for this payer's approval.
 * - `unsupported`: this browser can't verify Ed25519, so it couldn't check the wallet's answer.
 * - `check_unavailable`: Payments' code didn't load, or the signing room has no expiry height.
 */
export type CheckFailure = "mismatch" | "room_changed" | "unsupported" | "check_unavailable";
export type ReturnFailure = "unchecked";

export type PaymentCheck = {
  /** Before any wallet prompt: the payload must be the payment on screen and the frozen checkout in `room`. */
  readonly payload: (payload: SigningPayload, terms: ApprovalTerms, room: RoomSnapshot) => Promise<Result<CheckedPayment, CheckFailure>>;
  /** After the wallet answers and before the upload: the approval must be the payer's, over these bytes. */
  readonly returned: (payment: CheckedPayment, approval: PaymentApproval) => Promise<Result<PaymentApproval, ReturnFailure>>;
};

/** The room Payments validates against, in validateFrozenSigningPayload's own field names. */
export type SigningRoom = {
  readonly checkout: Checkout;
  readonly participants: readonly Participant[];
  readonly attemptId: AttemptId;
  readonly lastValidBlockHeight: BlockHeight;
};

/**
 * Payments' byte check, run only after the fields match the screen and the room still waits for this payer.
 * It rebuilds the transaction from the room, derives every token account, and requires the payload's
 * transaction, message and hash to match byte for byte.
 */
export type MessageCheck = (
  payload: SigningPayload,
  room: SigningRoom,
  payer: Address,
) => Promise<Result<ValidatedSigningPayload, Exclude<CheckFailure, "room_changed">>>;

/** P3's check that `signature` is `payment.account`'s, over the message Payments validated. */
export type ReturnCheck = (payment: CheckedPayment, signature: SignatureBase64) => Promise<"match" | "mismatch" | "unsupported">;

const MISMATCH = { ok: false, failure: "mismatch" } as const;

export function paymentCheck(messageCheck: MessageCheck, returnCheck: ReturnCheck): PaymentCheck {
  return {
    payload: async (payload, terms, room) => {
      if (!matchesTerms(payload, terms)) return MISMATCH;
      const signing = signingRoomOf(room, terms);
      if (typeof signing === "string") return { ok: false, failure: signing };
      const bytes = await caught(() => messageCheck(payload, signing, terms.payer), MISMATCH);
      if (!bytes.ok) return bytes;
      const validated = bytes.value;
      const account = terms.payer;
      return {
        ok: true,
        value: {
          [CHECKED]: validated,
          attemptId: payload.attemptId,
          account,
          transaction: Uint8Array.from(validated.message.transactionBytes),
          messageHash: payload.messageHash,
          signatureIn: (returned) => signatureIn(validated, account, returned),
        },
      };
    },
    returned: async (payment, approval) => {
      const valid = approval.messageHash === payment.messageHash && (await caught(() => returnCheck(payment, approval.signature), "mismatch")) === "match";
      return valid ? { ok: true, value: approval } : { ok: false, failure: "unchecked" };
    },
  };
}

/** Payments' functions throw for every failure. */
async function caught<T>(check: () => Promise<T>, onThrow: T): Promise<T> {
  try {
    return await check();
  } catch {
    return onThrow;
  }
}

const PAYMENTS_MESSAGE_CHECK: MessageCheck = async (payload, room, payer) => {
  if (!(await verifiesEd25519(payer))) return { ok: false, failure: "unsupported" };
  const payments = await loadPayments();
  if (payments === null) return { ok: false, failure: "check_unavailable" };
  try {
    const validated = await payments.validateFrozenSigningPayload({
      payload: wireOf(payload, payments.toBase64),
      ...room,
      config: { network: "devnet", mint: payments.DEVNET_USDC, tokenDecimals: 6, confirmationTarget: "finalized" },
    });
    return { ok: true, value: validated };
  } catch {
    return MISMATCH;
  }
};

/** The server runs the same call on upload, so a signature this accepts is one the server accepts. */
const PAYMENTS_RETURN_CHECK: ReturnCheck = async (payment, signature) => {
  const payments = await loadPayments();
  if (payments === null) return "unsupported";
  await payments.verifyPayerSignature(payment[CHECKED], { wallet: address(payment.account), signatureBytes: payments.fromBase64(signature) });
  return "match";
};

export const checkPayment: PaymentCheck = paymentCheck(PAYMENTS_MESSAGE_CHECK, PAYMENTS_RETURN_CHECK);

async function signatureIn(validated: ValidatedSigningPayload, account: Address, returned: Uint8Array): Promise<SignatureBase64 | null> {
  const payments = await loadPayments();
  if (payments === null) return null;
  try {
    const extracted = await payments.extractPaymentSignature({ validated, wallet: account, transactionBytes: Uint8Array.from(returned) });
    return extracted.signatureBase64 as SignatureBase64;
  } catch {
    return null;
  }
}

type Payments = typeof import("@/lib/payments/signing-payload") &
  typeof import("@/lib/payments/signature-core") &
  typeof import("@/lib/payments/wallet-signature") &
  Pick<typeof import("@/lib/payments/payment-core"), "DEVNET_USDC">;

let loading: Promise<Payments> | null = null;

/**
 * Payments' validators bring zod and the token program, so they load on the first Approve instead of with
 * every page. A failed load is tried again on the next press.
 */
async function loadPayments(): Promise<Payments | null> {
  loading ??= Promise.all([
    import("@/lib/payments/signing-payload"),
    import("@/lib/payments/signature-core"),
    import("@/lib/payments/wallet-signature"),
    import("@/lib/payments/payment-core"),
  ]).then(([signing, signatures, wallet, core]) => ({ ...signing, ...signatures, ...wallet, DEVNET_USDC: core.DEVNET_USDC }));
  try {
    return await loading;
  } catch {
    loading = null;
    return null;
  }
}

/** Every return check imports the payer's key as Ed25519. A browser that can't is found before the wallet opens. */
async function verifiesEd25519(payer: Address): Promise<boolean> {
  try {
    await crypto.subtle.importKey("raw", Uint8Array.from(getAddressEncoder().encode(address(payer))), "Ed25519", false, ["verify"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Payments validates the room and the payload against each other, not against what Approve waits for, so this
 * checks that the fresh room still waits for this payer's approval of this attempt.
 */
function signingRoomOf(room: RoomSnapshot, terms: ApprovalTerms): SigningRoom | "room_changed" | "check_unavailable" {
  const { attempt } = room;
  if (room.phase !== "paying" || attempt === null || attempt.id !== terms.attemptId || attempt.state !== "signing") return "room_changed";
  if (attempt.signedWallets.includes(terms.payer)) return "room_changed";
  if (attempt.lastValidBlockHeight === null) return "check_unavailable";
  return { checkout: room.checkout, participants: room.participants, attemptId: attempt.id, lastValidBlockHeight: attempt.lastValidBlockHeight };
}

/** B1's wire payload, re-encoded from the decoded one with every key named, because Payments' schema is strict. */
function wireOf(payload: SigningPayload, toBase64: (bytes: Uint8Array) => string): WirePayload {
  const { payment } = payload;
  return {
    attemptId: payload.attemptId,
    checkoutId: payload.checkoutId,
    transactionBase64: toBase64(payload.transaction),
    messageBase64: toBase64(payload.message),
    messageHash: payload.messageHash,
    blockhash: payload.blockhash,
    lastValidBlockHeight: payload.lastValidBlockHeight,
    payment: {
      network: payment.network,
      mint: payment.mint,
      tokenDecimals: payment.tokenDecimals,
      sellerWallet: payment.sellerWallet,
      sellerTokenAccount: payment.sellerTokenAccount,
      feePayerWallet: payment.feePayerWallet,
      contributions: payment.contributions.map(({ slot, wallet, sourceTokenAccount, amountUnits }) => ({ slot, wallet, sourceTokenAccount, amountUnits })),
    },
  };
}

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
