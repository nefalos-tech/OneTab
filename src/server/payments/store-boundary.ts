import type { AttemptStore } from "../attempt-store/index";
import { paymentFailure } from "./errors";
import type { PaymentLifecycle } from "./service";

async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { throw paymentFailure(error); }
}

export function boundAttemptStore(store: AttemptStore): AttemptStore {
  return {
    reserveAttempt: input => guard(() => store.reserveAttempt(input)),
    claimPreparation: input => guard(() => store.claimPreparation(input)),
    freezeMessage: input => guard(() => store.freezeMessage(input)),
    putVerifiedSignature: input => guard(() => store.putVerifiedSignature(input)),
    claimSubmission: input => guard(() => store.claimSubmission(input)),
    failPreparation: input => guard(() => store.failPreparation(input)),
    declineAttempt: input => guard(() => store.declineAttempt(input)),
    claimResolution: input => guard(() => store.claimResolution(input)),
    recordOutcome: input => guard(() => store.recordOutcome(input)),
    getAttempt: input => guard(() => store.getAttempt(input)),
  };
}

export function boundLifecycle(lifecycle: PaymentLifecycle): PaymentLifecycle {
  return {
    declineAttempt: input => guard(() => lifecycle.declineAttempt(input)),
    failPreparation: input => guard(() => lifecycle.failPreparation(input)),
  };
}
