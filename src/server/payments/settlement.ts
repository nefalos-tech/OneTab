import { address } from "@solana/kit";
import type { Checkout, PublicConfig, Receipt } from "../../contracts/index";
import { assembleSignedPayment } from "../../lib/payments/signature-core";
import { fromBase64, toBase64, validateFrozenSigningPayload } from "../../lib/payments/signing-payload";
import type { AttemptStore, StoredAttempt } from "../attempt-store/index";
import { PaymentFailure } from "./errors";
import type { PaymentRpc } from "./preflight";
import { decideReconciliation, type BackendAssurance, type KnownSubmission } from "./reconciliation";
import { observePayment, preSubmissionBlockhashExpired, sendPayment } from "./rpc";

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
  const validatedPayload = async (attempt: StoredAttempt) => {
    const checkout = await deps.readCheckout(attempt.checkoutId);
    if (!checkout) throw new PaymentFailure("CHECKOUT_NOT_FOUND");
    if (!attempt.signingPayload) throw new PaymentFailure("INVALID_PAYMENT");
    try {
      if (checkout.id !== attempt.checkoutId) throw new Error();
      return await validateFrozenSigningPayload({
        payload: attempt.signingPayload, checkout, participants: attempt.participants, attemptId: attempt.id,
        lastValidBlockHeight: attempt.signingPayload.lastValidBlockHeight, config: deps.config,
      });
    } catch { throw new PaymentFailure("INVALID_PAYMENT"); }
  };
  const reconcileSubmission = async (attemptId: string): Promise<StoredAttempt> => {
    const attempt = await read(attemptId);
    if (definitive(attempt)) return attempt;
    const validated = await validatedPayload(attempt);
    if (!attempt.submission && attempt.signatures.length < validated.plan.contributions.length) return attempt;
    let expected: KnownSubmission;
    let transactionBase64: string;
    try {
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
  const expiryFacts = async (attemptId: string, messageHash: string) => {
    const current = await read(attemptId);
    if (current.submission || definitive(current) || !current.signingPayload || current.signingPayload.messageHash !== messageHash
      || (current.state !== "signing" && current.state !== "declined")) return { expired: false };
    const validated = await validatedPayload(current);
    const feePayerSignature = current.signatures.find(signature => signature.signerWallet === validated.plan.feePayer)?.signatureBase64 ?? null;
    return { expired: await preSubmissionBlockhashExpired({
      rpc, lastValidBlockHeight: validated.target.lastValidBlockHeight, feePayerSignature, backendAssurance,
    }) };
  };
  const unusedAuthorization = (attempt: StoredAttempt) => attempt.state === "declined"
    && !attempt.signingPayload && attempt.signatures.length === 0 && !attempt.submission;
  const closeUnusedAuthorization = async (attemptId: string): Promise<StoredAttempt> => {
    const current = async () => {
      const attempt = await read(attemptId);
      return attempt.submission ? reconcileSubmission(attemptId) : attempt;
    };
    const attempt = await read(attemptId);
    if (attempt.submission) return reconcileSubmission(attemptId);
    if (!unusedAuthorization(attempt)) return attempt;
    const lease = await store.claimResolution({ attemptId });
    if (!lease) return current();
    const ownsUnused = async () => {
      const owned = await read(attemptId);
      return unusedAuthorization(owned) && owned.resolutionLease?.token === lease.token
        && Date.parse(owned.resolutionLease.expiresAt) > now().getTime();
    };
    if (!await ownsUnused()) return current();
    try {
      return await store.recordOutcome({ attemptId, leaseToken: lease.token,
        outcome: { state: "failed", error: null, safelyResolved: true } });
    } catch (error) {
      const missed = await read(attemptId);
      if (missed.submission) return reconcileSubmission(attemptId);
      if (definitive(missed) || missed.resolutionLease?.token !== lease.token || !unusedAuthorization(missed)) return missed;
      throw error;
    }
  };
  const expireWithoutSubmission = async (attemptId: string): Promise<StoredAttempt> => {
    const attempt = await read(attemptId);
    if (attempt.submission) return reconcileSubmission(attemptId);
    if (!attempt.signingPayload || (attempt.state !== "signing" && attempt.state !== "declined")) return attempt;
    const messageHash = attempt.signingPayload.messageHash;
    if (!(await expiryFacts(attemptId, messageHash)).expired) {
      const current = await read(attemptId);
      return current.submission ? reconcileSubmission(attemptId) : current;
    }
    const raced = await read(attemptId);
    if (raced.submission) return reconcileSubmission(attemptId);
    if (definitive(raced) || raced.signingPayload?.messageHash !== messageHash
      || (raced.state !== "signing" && raced.state !== "declined")) return raced;
    const lease = await store.claimResolution({ attemptId });
    if (!lease) {
      const missed = await read(attemptId);
      return missed.submission ? reconcileSubmission(attemptId) : missed;
    }
    const ownsResolution = async () => {
      const owned = await read(attemptId);
      return !owned.submission && !definitive(owned) && owned.resolutionLease?.token === lease.token
        && (owned.state === "signing" || owned.state === "declined")
        && owned.signingPayload?.messageHash === messageHash
        && Date.parse(owned.resolutionLease.expiresAt) > now().getTime();
    };
    if (!await ownsResolution()) {
      const missed = await read(attemptId);
      return missed.submission ? reconcileSubmission(attemptId) : missed;
    }
    const stillExpired = (await expiryFacts(attemptId, messageHash)).expired;
    if (!stillExpired || !await ownsResolution()) {
      const missed = await read(attemptId);
      return missed.submission ? reconcileSubmission(attemptId) : missed;
    }
    try {
      return await store.recordOutcome({ attemptId, leaseToken: lease.token,
        outcome: { state: "expired", error: null, safelyResolved: true } });
    } catch (error) {
      const missed = await read(attemptId);
      if (missed.submission) return reconcileSubmission(attemptId);
      if (definitive(missed) || missed.resolutionLease?.token !== lease.token) return missed;
      throw error;
    }
  };
  return async attemptId => {
    const attempt = await read(attemptId);
    if (definitive(attempt) || attempt.state === "preparing") return attempt;
    if (attempt.submission) return reconcileSubmission(attemptId);
    if (attempt.state !== "signing" && attempt.state !== "declined") return attempt;
    if (!attempt.signingPayload) return closeUnusedAuthorization(attemptId);
    const validated = await validatedPayload(attempt);
    if (attempt.state === "signing" && attempt.signatures.length >= validated.plan.contributions.length) {
      return reconcileSubmission(attemptId);
    }
    return expireWithoutSubmission(attemptId);
  };
}
