import { randomUUID } from "node:crypto";
import type { RoomSnapshot } from "../../contracts/index.js";
import type { AttemptStore, Lease, StoredAttempt } from "../attempt-store/index.js";
import { PaymentFailure } from "./errors.js";
import { projectAttempt, type PaymentLifecycle } from "./service.js";

export class TestAttemptStore implements AttemptStore, PaymentLifecycle {
  readonly attempts = new Map<string, StoredAttempt>();
  currentId: string | null = null;
  now = Date.parse("2026-11-07T00:00:00Z");
  freezes = 0;
  private serial = 0;
  private retryParents = new Map<string, string | null>();

  readonly room: RoomSnapshot;

  constructor(room: RoomSnapshot) { this.room = room; }

  readRoom = async (): Promise<RoomSnapshot> => {
    const snapshot = structuredClone(this.room);
    const current = this.currentId ? this.attempts.get(this.currentId) : null;
    snapshot.attempt = current ? projectAttempt({ attempt: current, room: {
      ...snapshot, attempt: { id: current.id },
    } }) : null;
    if (current?.state === "confirmed") snapshot.phase = "paid";
    else if (current) snapshot.phase = "paying";
    return snapshot;
  };

  private stored(id: string) {
    const value = this.attempts.get(id);
    if (!value) throw new PaymentFailure("ATTEMPT_NOT_FOUND");
    return value;
  }

  private current(id: string) {
    const value = this.stored(id);
    if (id !== this.currentId) throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
    return value;
  }

  private lease(): Lease {
    return { token: `test-fence-${++this.serial}`, expiresAt: new Date(this.now + 30000).toISOString() };
  }

  private owns(lease: Lease | null, token: string) {
    if (!lease || lease.token !== token || Date.parse(lease.expiresAt) <= this.now) throw new PaymentFailure("IDEMPOTENCY_CONFLICT");
  }

  async reserveAttempt(input: Parameters<AttemptStore["reserveAttempt"]>[0]) {
    if (input.checkoutId !== this.room.checkout.id) throw new PaymentFailure("CHECKOUT_NOT_FOUND");
    if (input.organizerWallet !== this.room.checkout.organizerWallet) throw new PaymentFailure("FORBIDDEN");
    if (this.room.phase === "paid") throw new PaymentFailure("CHECKOUT_PAID");
    const previous = this.currentId ? this.stored(this.currentId) : null;
    if (previous?.state === "confirmed") throw new PaymentFailure("CHECKOUT_PAID");
    if (previous) {
      if (input.retryOfAttemptId === null || this.retryParents.get(previous.id) === input.retryOfAttemptId) {
        return structuredClone(previous);
      }
      if (input.retryOfAttemptId !== previous.id || !previous.safelyResolved
        || !["failed", "expired"].includes(previous.state)) throw new PaymentFailure("RETRY_BLOCKED");
    } else if (input.retryOfAttemptId !== null) throw new PaymentFailure("RETRY_BLOCKED");
    if (this.room.participants.length !== this.room.checkout.payerCount || this.room.participants.some(payer => !payer.ready)) {
      throw new PaymentFailure("ROOM_NOT_READY");
    }
    const attempt: StoredAttempt = {
      id: randomUUID(), checkoutId: input.checkoutId, state: "preparing", participants: structuredClone(this.room.participants),
      safelyResolved: false, observedError: null, preparationLease: null, submissionLease: null,
      signingPayload: null, signatures: [], submission: null, receipt: null,
    };
    this.currentId = attempt.id;
    this.attempts.set(attempt.id, attempt);
    this.retryParents.set(attempt.id, input.retryOfAttemptId);
    return structuredClone(attempt);
  }

  async claimPreparation(input: Parameters<AttemptStore["claimPreparation"]>[0]) {
    const attempt = this.current(input.attemptId);
    if (attempt.state !== "preparing" || attempt.signingPayload
      || (attempt.preparationLease && Date.parse(attempt.preparationLease.expiresAt) > this.now)) return null;
    attempt.preparationLease = this.lease();
    return structuredClone(attempt.preparationLease);
  }

  async freezeMessage(input: Parameters<AttemptStore["freezeMessage"]>[0]) {
    const attempt = this.current(input.attemptId);
    this.owns(attempt.preparationLease, input.leaseToken);
    if (attempt.state !== "preparing" || attempt.signingPayload) throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
    attempt.signingPayload = structuredClone(input.payload);
    attempt.state = "signing";
    this.freezes++;
    return structuredClone(attempt);
  }

  async putVerifiedSignature(input: Parameters<AttemptStore["putVerifiedSignature"]>[0]) {
    const attempt = this.current(input.attemptId);
    if (!attempt.participants.some(payer => payer.wallet === input.signerWallet)) throw new PaymentFailure("FORBIDDEN");
    if (attempt.signingPayload?.messageHash !== input.messageHash) throw new PaymentFailure("MESSAGE_MISMATCH");
    const existing = attempt.signatures.find(signature => signature.signerWallet === input.signerWallet);
    if (existing) {
      if (existing.signatureBase64 !== input.signatureBase64) throw new PaymentFailure("IDEMPOTENCY_CONFLICT");
      return structuredClone(attempt);
    }
    if (attempt.state !== "signing") throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
    attempt.signatures.push({ signerWallet: input.signerWallet, signatureBase64: input.signatureBase64 });
    return structuredClone(attempt);
  }

  async declineAttempt(input: Parameters<PaymentLifecycle["declineAttempt"]>[0]) {
    const attempt = this.current(input.attemptId);
    if (!attempt.participants.some(payer => payer.wallet === input.signerWallet)) throw new PaymentFailure("FORBIDDEN");
    if (attempt.state === "preparing" || attempt.state === "signing") attempt.state = "declined";
    return structuredClone(attempt);
  }

  async failPreparation(input: Parameters<PaymentLifecycle["failPreparation"]>[0]) {
    const attempt = this.current(input.attemptId);
    this.owns(attempt.preparationLease, input.leaseToken);
    if (attempt.state !== "preparing" || attempt.signingPayload) throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
    attempt.state = "failed";
    attempt.safelyResolved = true;
    attempt.observedError = input.error;
    return structuredClone(attempt);
  }

  async claimSubmission(input: Parameters<AttemptStore["claimSubmission"]>[0]) {
    const attempt = this.current(input.attemptId);
    if (attempt.submission) {
      if (attempt.submission.transactionBase64 !== input.transactionBase64
        || attempt.submission.transactionReference !== input.transactionReference) throw new PaymentFailure("IDEMPOTENCY_CONFLICT");
    } else {
      if (attempt.state !== "signing") return null;
      if (!attempt.participants.every(payer => attempt.signatures.some(signature => signature.signerWallet === payer.wallet))) {
        throw new PaymentFailure("SIGNATURES_INCOMPLETE");
      }
    }
    if (!["signing", "submitting", "unresolved"].includes(attempt.state)
      || (attempt.submissionLease && Date.parse(attempt.submissionLease.expiresAt) > this.now)) return null;
    attempt.submission = { transactionBase64: input.transactionBase64, transactionReference: input.transactionReference };
    attempt.submissionLease = this.lease();
    attempt.state = "submitting";
    return structuredClone(attempt.submissionLease);
  }

  async recordOutcome(input: Parameters<AttemptStore["recordOutcome"]>[0]) {
    const attempt = this.current(input.attemptId);
    this.owns(attempt.submissionLease, input.leaseToken);
    if (attempt.safelyResolved || attempt.state === "confirmed") return structuredClone(attempt);
    attempt.state = input.outcome.state;
    if (input.outcome.state === "confirmed") {
      attempt.receipt = structuredClone(input.outcome.receipt);
      attempt.safelyResolved = true;
      attempt.observedError = null;
      this.room.phase = "paid";
    } else {
      attempt.observedError = input.outcome.error;
      attempt.safelyResolved = input.outcome.safelyResolved;
    }
    return structuredClone(attempt);
  }

  async getAttempt(input: Parameters<AttemptStore["getAttempt"]>[0]) {
    return structuredClone(this.attempts.get(input.attemptId) ?? null);
  }
}
