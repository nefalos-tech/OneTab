import { getAddressDecoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import type { AttemptStore, StoredAttempt } from "../attempt-store/index";
import { assembleSignedPayment } from "../../lib/payments/signature-core";
import { createCheckoutPaymentPlan, fromBase64, toBase64, validateFrozenSigningPayload } from "../../lib/payments/signing-payload";
import { config, paymentFixture, payloadForPlan } from "../../lib/payments/test-fixtures";

export async function settlementFixture(count: 2 | 3 = 2) {
  const f = await paymentFixture(count);
  const pairs = await Promise.all(f.room.participants.map(() => crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])));
  for (const [index, pair] of pairs.entries()) {
    f.room.participants[index]!.wallet = getAddressDecoder().decode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  }
  f.room.checkout.organizerWallet = f.room.participants[0]!.wallet;
  const plan = await createCheckoutPaymentPlan({ ...f.room, config });
  const payload = { ...await payloadForPlan(plan), lastValidBlockHeight: "250" };
  const signatures = await Promise.all(pairs.map(async (pair, index) => ({
    signerWallet: f.room.participants[index]!.wallet,
    signatureBase64: toBase64(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, Uint8Array.from(fromBase64(payload.messageBase64)).buffer))),
  })));
  const validated = await validateFrozenSigningPayload({ payload, ...f.room, config,
    attemptId: payload.attemptId, lastValidBlockHeight: payload.lastValidBlockHeight });
  const signed = await assembleSignedPayment(validated, signatures.map((signature, index) => ({
    wallet: plan.contributions[index]!.wallet, signatureBytes: fromBase64(signature.signatureBase64),
  })));
  const expected = { plan, messageBytes: validated.message.messageBytes, transactionBytes: signed.transactionBytes,
    reference: signed.reference, lastValidBlockHeight: 250n };
  const attempt: StoredAttempt = { id: payload.attemptId, checkoutId: payload.checkoutId, state: "signing",
    participants: f.room.participants, safelyResolved: false, observedError: null, preparationLease: null,
    submissionLease: null, resolutionLease: null, signingPayload: payload, signatures, submission: null, receipt: null };
  const message = getCompiledTransactionMessageDecoder().decode(expected.messageBytes);
  const balances = [
    ...plan.contributions.map(payer => ({ wallet: payer.wallet, token: payer.sourceTokenAccount, before: payer.units, after: 0n })),
    { wallet: plan.sellerWallet, token: plan.sellerTokenAccount, before: 0n, after: plan.totalUnits },
  ];
  const tokens = (stage: "before" | "after") => balances.map(account => ({
    accountIndex: message.staticAccounts.indexOf(account.token), mint: plan.mint, owner: account.wallet,
    uiTokenAmount: { amount: String(account[stage]), decimals: 6 },
  }));
  const transaction = { slot: 500, transaction: [toBase64(signed.transactionBytes), "base64"], meta: {
    err: null, fee: 5000 * count, preBalances: message.staticAccounts.map(() => 1000000),
    postBalances: message.staticAccounts.map((_, i) => i === 0 ? 1000000 - 5000 * count : 1000000),
    preTokenBalances: tokens("before"), postTokenBalances: tokens("after"),
  } };
  return { attempt, expected, transaction, checkout: f.room.checkout, config };
}

export function submissionStore(initial: StoredAttempt, events: string[], now: () => Date) {
  const current = structuredClone(initial);
  let claims = 0;
  const unused = async (): Promise<never> => { throw new Error("Unexpected store operation"); };
  const terminal = () => current.state === "confirmed" || (["failed", "expired"].includes(current.state) && current.safelyResolved);
  const store: AttemptStore = {
    reserveAttempt: unused, claimPreparation: unused, freezeMessage: unused, putVerifiedSignature: unused,
    failPreparation: unused, declineAttempt: unused, claimResolution: unused,
    async getAttempt({ attemptId }) { return current.id === attemptId ? structuredClone(current) : null; },
    async claimSubmission(input) {
      events.push("claim");
      if (input.attemptId !== current.id || terminal()) return null;
      if (current.submission && (current.submission.transactionBase64 !== input.transactionBase64
        || current.submission.transactionReference !== input.transactionReference)) throw new Error("Identity conflict");
      if (current.submissionLease && Date.parse(current.submissionLease.expiresAt) > now().getTime()) return null;
      current.submission = { transactionBase64: input.transactionBase64, transactionReference: input.transactionReference };
      current.submissionLease = { token: String(++claims), expiresAt: new Date(now().getTime() + 30_000).toISOString() };
      current.state = "submitting";
      events.push("persisted");
      return structuredClone(current.submissionLease);
    },
    async recordOutcome({ attemptId, leaseToken, outcome }) {
      if (current.id !== attemptId || current.submissionLease?.token !== leaseToken
        || Date.parse(current.submissionLease.expiresAt) <= now().getTime() || terminal()) throw new Error("Stale lease");
      events.push(`outcome:${outcome.state}`);
      current.state = outcome.state;
      current.safelyResolved = outcome.state === "confirmed" || outcome.safelyResolved;
      current.observedError = outcome.state === "confirmed" ? null : outcome.error;
      current.receipt = outcome.state === "confirmed" ? outcome.receipt : null;
      current.submissionLease = null;
      return structuredClone(current);
    },
  };
  return { store, snapshot: () => structuredClone(current) };
}
