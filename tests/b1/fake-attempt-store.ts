import type { AttemptStore, StoredAttempt } from "../../src/server/attempt-store";
import { roomFixtures, signingPayloadFixture } from "../../src/fixtures";

const fixtureRoom = roomFixtures.data.signing;
const fixtureSummary = fixtureRoom.attempt;

if (fixtureSummary === null) {
  throw new Error("The signing fixture must contain an attempt.");
}

const fixtureAttempt: StoredAttempt = {
  id: fixtureSummary.id,
  checkoutId: fixtureRoom.checkout.id,
  state: fixtureSummary.state,
  participants: fixtureRoom.participants,
  safelyResolved: false,
  observedError: null,
  preparationLease: null,
  submissionLease: null,
  resolutionLease: null,
  signingPayload: signingPayloadFixture.data,
  signatures: fixtureSummary.signedWallets.map((signerWallet) => ({
    signerWallet,
    signatureBase64: "RklYVFVSRQ==",
  })),
  submission: null,
  receipt: null,
};

function unsupported(operation: string): never {
  throw new Error(`${operation} is unavailable in the fixture-only AttemptStore.`);
}

/** Example consumer double. Mutations intentionally fail; this is not B4 persistence. */
export const fixtureAttemptStore: AttemptStore = {
  async reserveAttempt() {
    return unsupported("reserveAttempt");
  },
  async claimPreparation() {
    return unsupported("claimPreparation");
  },
  async freezeMessage() {
    return unsupported("freezeMessage");
  },
  async putVerifiedSignature() {
    return unsupported("putVerifiedSignature");
  },
  async claimSubmission() {
    return unsupported("claimSubmission");
  },
  async failPreparation() {
    return unsupported("failPreparation");
  },
  async recordOutcome() {
    return unsupported("recordOutcome");
  },
  async declineAttempt() {
    return unsupported("declineAttempt");
  },
  async claimResolution() {
    return unsupported("claimResolution");
  },
  async getAttempt({ attemptId }) {
    return attemptId === fixtureAttempt.id ? fixtureAttempt : null;
  },
};
