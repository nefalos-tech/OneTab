import { address } from "@solana/kit";
import type { AttemptSummary, ErrorCode, PublicConfig, RoomSnapshot, SigningPayload } from "../../contracts/index";
import { verifyPayerSignature } from "../../lib/payments/signature-core";
import { fromBase64, validateFrozenSigningPayload } from "../../lib/payments/signing-payload";
import type { AttemptStore, StoredAttempt } from "../attempt-store/index";
import { buildSigningPayload } from "./build-attempt";
import { observedPaymentError, PaymentFailure, paymentFailure } from "./errors";
import type { PaymentRpc } from "./preflight";

export interface PaymentLifecycle {
  declineAttempt(input: { attemptId: string; signerWallet: string }): Promise<StoredAttempt>;
  failPreparation(input: { attemptId: string; leaseToken: string; error: ErrorCode }): Promise<StoredAttempt>;
}

export interface PaymentDependencies {
  store: AttemptStore;
  lifecycle: PaymentLifecycle;
  readRoom(input: { checkoutId: string }): Promise<RoomSnapshot | null>;
  config: PublicConfig;
  rpc: PaymentRpc;
  progress(attemptId: string): Promise<StoredAttempt>;
}

type Actor = { attemptId: string; wallet: string };

export function projectAttempt(input: { attempt: StoredAttempt; room: { phase: RoomSnapshot["phase"]; attempt: Pick<AttemptSummary, "id"> | null } }): AttemptSummary {
  const { attempt, room } = input;
  const signed = new Set(attempt.signatures.map(signature => signature.signerWallet));
  return {
    id: attempt.id,
    state: attempt.state,
    signedWallets: [...attempt.participants].sort((a, b) => a.slot - b.slot)
      .filter(payer => signed.has(payer.wallet)).map(payer => payer.wallet),
    transactionReference: attempt.submission?.transactionReference ?? null,
    lastValidBlockHeight: attempt.signingPayload?.lastValidBlockHeight ?? null,
    error: observedPaymentError(attempt.observedError),
    canRetry: (attempt.state === "failed" || attempt.state === "expired") && attempt.safelyResolved
      && room.phase !== "paid" && room.attempt?.id === attempt.id,
    receipt: attempt.receipt ? {
      transactionReference: attempt.receipt.transactionReference,
      confirmationStatus: attempt.receipt.confirmationStatus,
      sellerWallet: attempt.receipt.sellerWallet,
      totalUnits: attempt.receipt.totalUnits,
      contributions: attempt.receipt.contributions.map(({ slot, wallet, amountUnits }) => ({ slot, wallet, amountUnits })),
      observedAt: attempt.receipt.observedAt,
      explorerUrl: attempt.receipt.explorerUrl,
    } : null,
  };
}

export function createPaymentService(dependencies: PaymentDependencies) {
  const { store, lifecycle, config, progress } = dependencies;
  const rpc: PaymentRpc = {
    async call(method, params) {
      try { return await dependencies.rpc.call(method, params); }
      catch { throw new PaymentFailure("RPC_UNAVAILABLE"); }
    },
  };

  async function room(checkoutId: string): Promise<RoomSnapshot> {
    const result = await dependencies.readRoom({ checkoutId });
    if (!result) throw new PaymentFailure("CHECKOUT_NOT_FOUND");
    return result;
  }

  async function attempt(attemptId: string): Promise<StoredAttempt> {
    const result = await store.getAttempt({ attemptId });
    if (!result) throw new PaymentFailure("ATTEMPT_NOT_FOUND");
    return result;
  }

  async function context(input: Actor) {
    const stored = await attempt(input.attemptId);
    if (!stored.participants.some(payer => payer.wallet === input.wallet)) throw new PaymentFailure("FORBIDDEN");
    const snapshot = await room(stored.checkoutId);
    if (snapshot.attempt?.id !== stored.id) throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
    return { stored, snapshot };
  }

  async function summary(stored: StoredAttempt): Promise<AttemptSummary> {
    return projectAttempt({ attempt: stored, room: await room(stored.checkoutId) });
  }

  async function prepareReserved(stored: StoredAttempt, snapshot: RoomSnapshot): Promise<StoredAttempt> {
    if (stored.state !== "preparing" || stored.signingPayload) return stored;
    const lease = await store.claimPreparation({ attemptId: stored.id });
    if (!lease) return attempt(stored.id);
    let payload: SigningPayload;
    try {
      payload = await buildSigningPayload({ attemptId: stored.id, checkout: snapshot.checkout,
        participants: stored.participants, config, rpc });
    } catch (error) {
      const failure = paymentFailure(error);
      await lifecycle.failPreparation({ attemptId: stored.id, leaseToken: lease.token, error: failure.code });
      throw failure;
    }
    return store.freezeMessage({ attemptId: stored.id, leaseToken: lease.token, payload });
  }

  async function validated(stored: StoredAttempt, snapshot: RoomSnapshot) {
    const payload = stored.signingPayload;
    if (!payload) throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
    try {
      return await validateFrozenSigningPayload({ payload, checkout: snapshot.checkout,
        participants: stored.participants, attemptId: stored.id,
        lastValidBlockHeight: payload.lastValidBlockHeight, config });
    } catch { throw new PaymentFailure("INVALID_PAYMENT"); }
  }

  return {
    async prepare(input: { checkoutId: string; wallet: string; retryOfAttemptId: string | null }): Promise<AttemptSummary> {
      const snapshot = await room(input.checkoutId);
      if (snapshot.checkout.organizerWallet !== input.wallet) throw new PaymentFailure("FORBIDDEN");
      if (snapshot.phase === "paid") throw new PaymentFailure("CHECKOUT_PAID");
      if (!snapshot.attempt && (snapshot.participants.length !== snapshot.checkout.payerCount
        || snapshot.participants.some(payer => !payer.ready))) throw new PaymentFailure("ROOM_NOT_READY");
      const stored = await store.reserveAttempt({ checkoutId: input.checkoutId,
        organizerWallet: input.wallet, retryOfAttemptId: input.retryOfAttemptId });
      return summary(await prepareReserved(stored, snapshot));
    },

    async signingPayload(input: Actor): Promise<SigningPayload> {
      const { stored, snapshot } = await context(input);
      if (stored.state !== "signing" || !stored.signingPayload) throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
      await validated(stored, snapshot);
      return structuredClone(stored.signingPayload);
    },

    async addSignature(input: Actor & { messageHash: string; signatureBase64: string }): Promise<AttemptSummary> {
      const { stored, snapshot } = await context(input);
      if (!stored.signingPayload) throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
      if (stored.signingPayload.messageHash !== input.messageHash) throw new PaymentFailure("MESSAGE_MISMATCH");
      const target = await validated(stored, snapshot);
      try {
        if (input.signatureBase64.length !== 88) throw new PaymentFailure("INVALID_SIGNATURE");
        await verifyPayerSignature(target, { wallet: address(input.wallet), signatureBytes: fromBase64(input.signatureBase64) });
      } catch { throw new PaymentFailure("INVALID_SIGNATURE"); }
      const existing = stored.signatures.find(signature => signature.signerWallet === input.wallet);
      if (existing) {
        if (existing.signatureBase64 !== input.signatureBase64) throw new PaymentFailure("IDEMPOTENCY_CONFLICT");
        return summary(await attempt(stored.id));
      }
      if (stored.state !== "signing") throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
      let updated: StoredAttempt;
      try {
        updated = await store.putVerifiedSignature({ attemptId: stored.id, signerWallet: input.wallet,
          messageHash: input.messageHash, signatureBase64: input.signatureBase64 });
      } catch (error) {
        const failure = error instanceof PaymentFailure ? error : paymentFailure(error);
        if (failure.code !== "ATTEMPT_NOT_SIGNABLE") throw failure;
        const current = await attempt(stored.id);
        const storedSignature = current.signatures.find(signature => signature.signerWallet === input.wallet);
        if (current.signingPayload?.messageHash !== input.messageHash || storedSignature?.signatureBase64 !== input.signatureBase64) throw failure;
        updated = current;
      }
      const complete = updated.participants.every(payer => updated.signatures.some(signature => signature.signerWallet === payer.wallet));
      return summary(complete && updated.state === "signing" ? await progress(updated.id) : updated);
    },

    async decline(input: Actor): Promise<AttemptSummary> {
      await context(input);
      const declined = await lifecycle.declineAttempt({ attemptId: input.attemptId, signerWallet: input.wallet });
      if (declined.state !== "declined" || declined.signingPayload || declined.signatures.length > 0 || declined.submission) {
        return summary(declined);
      }
      return summary(await progress(declined.id));
    },

    async submit(input: Actor): Promise<AttemptSummary> {
      await context(input);
      return summary(await progress(input.attemptId));
    },

    async refresh(input: Actor): Promise<AttemptSummary> {
      const { stored, snapshot } = await context(input);
      return summary(stored.state === "preparing"
        ? await prepareReserved(stored, snapshot) : await progress(stored.id));
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;
