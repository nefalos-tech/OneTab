import { address } from "@solana/kit";
import type { Checkout, PublicConfig, Receipt } from "../../contracts/index.js";
import { assembleSignedPayment } from "../../lib/payments/signature-core.js";
import { fromBase64, toBase64, validateFrozenSigningPayload } from "../../lib/payments/signing-payload.js";
import type { AttemptStore, StoredAttempt } from "../attempt-store/index.js";
import { PaymentFailure } from "./errors.js";
import type { PaymentRpc } from "./preflight.js";
import { decideReconciliation, type BackendAssurance, type KnownSubmission } from "./reconciliation.js";
import { observePayment, sendPayment } from "./rpc.js";

export type PaymentProgressDependencies = Readonly<{
  store: AttemptStore; readCheckout: (checkoutId: string) => Promise<Checkout | null>;
  config: PublicConfig; rpc: PaymentRpc; now?: () => Date; backendAssurance?: BackendAssurance;
}>;

function definitive(attempt: StoredAttempt): boolean {
  return attempt.state === "confirmed" || ((attempt.state === "failed" || attempt.state === "expired") && attempt.safelyResolved);
}

export function createPaymentProgress(deps: PaymentProgressDependencies): (attemptId: string) => Promise<StoredAttempt> {
  const { store, rpc } = deps;
  const now = deps.now ?? (() => new Date());
  const backendAssurance = deps.backendAssurance ?? "unverified";
  const read = async (attemptId: string) => {
    const attempt = await store.getAttempt({ attemptId });
    if (!attempt) throw new PaymentFailure("ATTEMPT_NOT_FOUND");
    if (attempt.id !== attemptId) throw new PaymentFailure("INVALID_PAYMENT");
    return attempt;
  };
  return async attemptId => {
    const attempt = await read(attemptId);
    if (definitive(attempt) || attempt.state === "preparing") return attempt;
    if (!attempt.submission && attempt.state !== "signing") return attempt;
    if (!attempt.signingPayload) throw new PaymentFailure("INVALID_PAYMENT");
    const checkout = await deps.readCheckout(attempt.checkoutId);
    if (!checkout) throw new PaymentFailure("CHECKOUT_NOT_FOUND");
    let expected: KnownSubmission;
    let transactionBase64: string;
    try {
      if (checkout.id !== attempt.checkoutId) throw new Error();
      const validated = await validateFrozenSigningPayload({
        payload: attempt.signingPayload, checkout, participants: attempt.participants, attemptId,
        lastValidBlockHeight: attempt.signingPayload.lastValidBlockHeight, config: deps.config,
      });
      if (!attempt.submission && attempt.signatures.length < validated.plan.contributions.length) return attempt;
      const signed = await assembleSignedPayment(validated, attempt.signatures.map(signature => ({
        wallet: address(signature.signerWallet), signatureBytes: fromBase64(signature.signatureBase64),
      })));
      transactionBase64 = toBase64(signed.transactionBytes);
      if (attempt.submission && (attempt.submission.transactionBase64 !== transactionBase64
        || attempt.submission.transactionReference !== signed.reference)) throw new Error();
      expected = { plan: validated.plan, messageBytes: validated.message.messageBytes,
        transactionBytes: signed.transactionBytes, reference: signed.reference,
        lastValidBlockHeight: validated.target.lastValidBlockHeight };
    } catch { throw new PaymentFailure("INVALID_PAYMENT"); }

    const lease = await store.claimSubmission({ attemptId, transactionBase64, transactionReference: expected.reference });
    if (!lease) return read(attemptId);
    const ownsLease = async () => {
      const current = await read(attemptId);
      return !definitive(current) && current.submissionLease?.token === lease.token
        && current.submission?.transactionBase64 === transactionBase64
        && current.submission.transactionReference === expected.reference
        && Date.parse(current.submissionLease.expiresAt) > now().getTime();
    };
    const record = async (outcome: Parameters<AttemptStore["recordOutcome"]>[0]["outcome"]) => {
      if (!await ownsLease()) return read(attemptId);
      try { return await store.recordOutcome({ attemptId, leaseToken: lease.token, outcome }); }
      catch (error) {
        const current = await read(attemptId);
        if (definitive(current) || current.submissionLease?.token !== lease.token) return current;
        throw error;
      }
    };
    if (!await ownsLease()) return read(attemptId);
    const observation = await observePayment({ rpc, expected, backendAssurance });
    const decision = decideReconciliation({ expected, observation, backendAssurance });
    if (decision.kind === "finalized") {
      const receipt: Receipt = { transactionReference: expected.reference, confirmationStatus: "finalized",
        sellerWallet: expected.plan.sellerWallet, totalUnits: String(expected.plan.totalUnits),
        contributions: expected.plan.contributions.map(payer => ({ slot: payer.slot, wallet: payer.wallet, amountUnits: String(payer.units) })),
        observedAt: now().toISOString(), explorerUrl: `https://explorer.solana.com/tx/${expected.reference}?cluster=devnet` };
      return record({ state: "confirmed", receipt });
    }
    if (decision.kind === "failed" || decision.kind === "expired") {
      return record({ state: decision.kind, error: decision.kind === "failed" ? "finalized_execution_error" : null, safelyResolved: true });
    }
    if ((observation.kind === "absent" || (observation.kind === "historical_absence"
      && (observation.finalizedBlockHeight === undefined || observation.finalizedBlockHeight <= expected.lastValidBlockHeight)))
      && await ownsLease()) {
      try { await sendPayment({ rpc, expected, transactionBase64, ownsLease }); }
      catch { return record({ state: "unresolved", error: "RPC_UNAVAILABLE", safelyResolved: false }); }
    }
    return record({ state: "unresolved", error: "RPC_UNAVAILABLE", safelyResolved: false });
  };
}
