import type { AttemptState, Base64, Participant, Receipt, SigningPayload } from "../../contracts";

export interface StoredAttempt {
  id: string;
  checkoutId: string;
  state: AttemptState;
  participants: Participant[];
  safelyResolved: boolean;
  observedError: string | null;
  preparationLease: Lease | null;
  submissionLease: Lease | null;
  resolutionLease: Lease | null;
  signingPayload: SigningPayload | null;
  signatures: Array<{ signerWallet: string; signatureBase64: Base64 }>;
  submission: {
    transactionBase64: Base64;
    transactionReference: string;
  } | null;
  receipt: Receipt | null;
}

export interface Lease {
  token: string;
  expiresAt: string;
}

export type ResolutionLease = Lease;

export interface AttemptStore {
  reserveAttempt(input: {
    checkoutId: string;
    organizerWallet: string;
    retryOfAttemptId: string | null;
  }): Promise<StoredAttempt>;
  claimPreparation(input: { attemptId: string }): Promise<Lease | null>;
  freezeMessage(input: {
    attemptId: string;
    leaseToken: string;
    payload: SigningPayload;
  }): Promise<StoredAttempt>;
  putVerifiedSignature(input: {
    attemptId: string;
    signerWallet: string;
    messageHash: string;
    signatureBase64: Base64;
  }): Promise<StoredAttempt>;
  claimSubmission(input: {
    attemptId: string;
    transactionBase64: Base64;
    transactionReference: string;
  }): Promise<Lease | null>;
  failPreparation(input: { attemptId: string; leaseToken: string; error: string }): Promise<StoredAttempt>;
  declineAttempt(input: { attemptId: string; signerWallet: string }): Promise<StoredAttempt>;
  claimResolution(input: { attemptId: string }): Promise<ResolutionLease | null>;
  recordOutcome(input: { attemptId: string; leaseToken: string; outcome:
    | { state: "unresolved"; error: string | null; safelyResolved: false }
    | { state: "failed" | "expired"; error: string | null; safelyResolved: true }
    | { state: "confirmed"; receipt: Receipt }
  }): Promise<StoredAttempt>;
  getAttempt(input: { attemptId: string }): Promise<StoredAttempt | null>;
}
