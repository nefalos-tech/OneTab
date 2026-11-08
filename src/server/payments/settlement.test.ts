import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import type { StoredAttempt } from "../attempt-store/index";
import { toBase64 } from "../../lib/payments/signing-payload";
import type { PaymentRpc } from "./preflight";
import { DEVNET_GENESIS_HASH } from "./preflight";
import { projectAttempt } from "./service";
import { serviceFixture } from "./test-fixtures";
import { createPaymentProgress } from "./settlement";
import { settlementFixture, submissionStore } from "./settlement-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function setup(count: 2 | 3 = 2) {
  const f = await settlementFixture(count);
  const events: string[] = [];
  let time = Date.parse("2026-11-07T12:00:00.000Z");
  const now = () => new Date(time);
  const memory = submissionStore(f.attempt, events, now);
  let status: unknown = null;
  let transaction: unknown = f.transaction;
  let height = 200;
  let failedSend = false;
  let sentReference = f.expected.reference;
  let genesis = DEVNET_GENESIS_HASH;
  let beforeCall: (method: string) => Promise<void> = async () => {};
  const rpc: PaymentRpc = { async call(method, params) {
    events.push(method);
    await beforeCall(method);
    switch (method) {
      case "getGenesisHash": return genesis;
      case "getEpochInfo": return { absoluteSlot: 1000, blockHeight: height };
      case "getSignatureStatuses": return { context: { slot: 1001 }, value: [status] };
      case "getTransaction": return transaction;
      case "getSlot": return 1002;
      case "getBlockHeight": return height;
      case "sendTransaction": {
        expect(memory.snapshot().submission?.transactionBase64).toBe(params[0]);
        expect(params[0]).toBe(toBase64(f.expected.transactionBytes));
        expect(params[1]).toEqual({ encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
        if (failedSend) throw new Error("timeout with private endpoint credential");
        return sentReference;
      }
      default: throw new Error(`Unexpected RPC ${method}`);
    }
  } };
  const deps = { store: memory.store, readCheckout: async () => f.checkout, config: f.config, rpc, now };
  return { ...f, ...memory, events, deps, progress: createPaymentProgress(deps),
    advance: () => { time += 31_000; },
    setStatus: (value: unknown) => { status = value; }, setTransaction: (value: unknown) => { transaction = value; },
    setHeight: (value: number) => { height = value; }, loseSend: () => { failedSend = true; },
    setReference: (value: string) => { sentReference = value; }, setGenesis: (value: string) => { genesis = value; },
    onCall: (callback: typeof beforeCall) => { beforeCall = callback; },
  };
}

describe("durable submission progress", () => {
  it("persists the complete signed identity before RPC work and sends at most once", async () => {
    const f = await setup(3);
    const result = await f.progress(f.attempt.id);
    expect(result.state).toBe("unresolved");
    expect(result.safelyResolved).toBe(false);
    expect(f.events.slice(0, 3)).toEqual(["claim", "persisted", "getGenesisHash"]);
    expect(f.events.indexOf("getSignatureStatuses")).toBeLessThan(f.events.indexOf("sendTransaction"));
    expect(f.events.filter(event => event === "sendTransaction")).toHaveLength(1);
    expect(result.submission).toEqual({ transactionBase64: toBase64(f.expected.transactionBytes), transactionReference: f.expected.reference });
    expect(result.signingPayload?.transactionBase64).toBe(f.attempt.signingPayload?.transactionBase64);
  });

  it("concurrent requests acquire one lease and keep one identity", async () => {
    const f = await setup();
    const entered = deferred();
    const release = deferred();
    f.onCall(async method => { if (method === "getEpochInfo") { entered.resolve(); await release.promise; } });
    const first = f.progress(f.attempt.id);
    await entered.promise;
    const second = await createPaymentProgress(f.deps)(f.attempt.id);
    expect(second.state).toBe("submitting");
    expect(f.events.filter(event => event === "persisted")).toHaveLength(1);
    release.resolve();
    await first;
    expect(f.events.filter(event => event === "sendTransaction")).toHaveLength(1);
  });

  it("recovers after persistence and process loss before the first send", async () => {
    const f = await setup();
    await f.store.claimSubmission({ attemptId: f.attempt.id, transactionBase64: toBase64(f.expected.transactionBytes), transactionReference: f.expected.reference });
    expect(f.events).toEqual(["claim", "persisted"]);
    f.advance();
    const result = await createPaymentProgress(f.deps)(f.attempt.id);
    expect(result.submission?.transactionReference).toBe(f.expected.reference);
    expect(f.events.indexOf("getSignatureStatuses")).toBeLessThan(f.events.indexOf("sendTransaction"));
    expect(f.events.filter(event => event === "sendTransaction")).toHaveLength(1);
  });

  it("a lost send response later produces the receipt for exactly the stored identity", async () => {
    const f = await setup(3);
    f.loseSend();
    const unresolved = await f.progress(f.attempt.id);
    expect(unresolved.state).toBe("unresolved");
    expect(unresolved.observedError).toBe("RPC_UNAVAILABLE");
    f.setHeight(10_000);
    f.setStatus({ slot: 500, confirmationStatus: "finalized", err: null });
    const confirmed = await createPaymentProgress(f.deps)(f.attempt.id);
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.receipt).toEqual({ transactionReference: f.expected.reference, confirmationStatus: "finalized",
      sellerWallet: f.checkout.sellerWallet, totalUnits: "10",
      contributions: f.attempt.participants.map(payer => ({ slot: payer.slot, wallet: payer.wallet, amountUnits: payer.shareUnits })),
      observedAt: f.deps.now().toISOString(), explorerUrl: `https://explorer.solana.com/tx/${f.expected.reference}?cluster=devnet` });
    expect(f.events.filter(event => event === "sendTransaction")).toHaveLength(1);
    const callCount = f.events.length;
    expect(await f.progress(f.attempt.id)).toEqual(confirmed);
    expect(f.events).toHaveLength(callCount);
  });

  it("unknown RPC errors and a mismatched returned reference stay unresolved", async () => {
    const f = await setup();
    f.setReference("another-payment");
    const result = await f.progress(f.attempt.id);
    expect(result.state).toBe("unresolved");
    expect(result.safelyResolved).toBe(false);
    expect(result.observedError).toBe("RPC_UNAVAILABLE");
    expect(result.submission?.transactionReference).toBe(f.expected.reference);
  });

  it("does not rebroadcast after lifetime expiry and defaults to unresolved absence", async () => {
    const f = await setup();
    f.setHeight(251);
    const result = await f.progress(f.attempt.id);
    expect(result.state).toBe("unresolved");
    expect(result.safelyResolved).toBe(false);
    expect(f.events).not.toContain("sendTransaction");
    const expired = await createPaymentProgress({ ...f.deps, backendAssurance: "coherent_backend_and_retention_established" })(f.attempt.id);
    expect(expired.state).toBe("expired");
    expect(expired.safelyResolved).toBe(true);
    expect(expired.submission?.transactionReference).toBe(f.expected.reference);
    expect(f.events).not.toContain("sendTransaction");
  });

  it("an expired finalized height cannot be undone by a later lower processed height", async () => {
    const f = await setup();
    f.setHeight(251);
    f.onCall(async method => { if (method === "getSlot") f.setHeight(200); });
    const result = await f.progress(f.attempt.id);
    expect(result.state).toBe("unresolved");
    expect(f.events).not.toContain("sendTransaction");
    expect(f.events).not.toContain("getBlockHeight");
  });

  it("earlier commitments and inconsistent finalized metadata cannot settle or trigger a send", async () => {
    const f = await setup();
    f.setHeight(251);
    for (const confirmationStatus of ["processed", "confirmed", null]) {
      for (const err of [null, "failure"]) {
        f.setStatus({ slot: 500, confirmationStatus, err });
        expect((await f.progress(f.attempt.id)).state).toBe("unresolved");
      }
    }
    f.setStatus({ slot: 500, confirmationStatus: "finalized", err: null });
    for (const transaction of [null, { ...f.transaction, slot: 501 }, { ...f.transaction, meta: null },
      { ...f.transaction, meta: { ...f.transaction.meta, err: "failure" } },
      { ...f.transaction, transaction: ["not-the-wire", "base64"] },
    ]) {
      f.setTransaction(transaction);
      const result = await f.progress(f.attempt.id);
      expect(result.state).toBe("unresolved");
      expect(result.safelyResolved).toBe(false);
    }
    expect(f.events).not.toContain("sendTransaction");
  });

  it("finalized failure safely closes authorization without claiming a fee refund", async () => {
    const f = await setup();
    f.setStatus({ slot: 500, confirmationStatus: "finalized", err: "InstructionError" });
    f.setTransaction({ ...f.transaction, meta: { ...f.transaction.meta, err: "InstructionError" } });
    const result = await f.progress(f.attempt.id);
    expect(result.state).toBe("failed");
    expect(result.safelyResolved).toBe(true);
    expect(result.receipt).toBeNull();
    expect(result.observedError).toBe("finalized_execution_error");
    expect(f.events).not.toContain("sendTransaction");
  });

  it("a stale worker cannot overwrite a newer finalized result", async () => {
    const f = await setup();
    const entered = deferred();
    const release = deferred();
    let first = true;
    f.onCall(async method => {
      if (first && method === "getSignatureStatuses") { first = false; entered.resolve(); await release.promise; }
    });
    const stale = f.progress(f.attempt.id);
    await entered.promise;
    f.advance();
    f.setStatus({ slot: 500, confirmationStatus: "finalized", err: null });
    const winner = await createPaymentProgress(f.deps)(f.attempt.id);
    expect(winner.state).toBe("confirmed");
    f.setStatus(null);
    release.resolve();
    expect(await stale).toEqual(winner);
    expect(f.snapshot()).toEqual(winner);
    expect(f.events.filter(event => event.startsWith("outcome:"))).toEqual(["outcome:confirmed"]);
    expect(f.events).not.toContain("sendTransaction");
  });

  it("rechecks the lease after a slow height call before sending", async () => {
    const f = await setup();
    f.onCall(async method => { if (method === "getBlockHeight") f.advance(); });
    expect((await f.progress(f.attempt.id)).state).toBe("submitting");
    expect(f.events).not.toContain("sendTransaction");
    expect(f.events).not.toContain("outcome:unresolved");
  });

  it("wrong cluster cannot send or become an expiry observation", async () => {
    const f = await setup();
    f.setGenesis("wrong-cluster");
    f.setHeight(251);
    const result = await createPaymentProgress({ ...f.deps, backendAssurance: "coherent_backend_and_retention_established" })(f.attempt.id);
    expect(result.state).toBe("unresolved");
    expect(result.safelyResolved).toBe(false);
    expect(f.events).not.toContain("getEpochInfo");
    expect(f.events).not.toContain("sendTransaction");
  });

  it("rejects malformed stored signatures, payload targets, bytes, and references before claiming", async () => {
    const f = await setup();
    const mutations: ((attempt: StoredAttempt) => void)[] = [
      attempt => { attempt.signatures[0]!.signatureBase64 = "not-base64"; },
      attempt => { attempt.signatures[0]!.signatureBase64 = toBase64(new Uint8Array(64).fill(1)); },
      attempt => { attempt.signatures[1]!.signerWallet = attempt.signatures[0]!.signerWallet; },
      attempt => { attempt.signingPayload!.attemptId = "00000000-0000-4000-8000-000000000099"; },
      attempt => { attempt.signingPayload!.payment.sellerWallet = attempt.participants[0]!.wallet; },
      attempt => { attempt.submission = { transactionBase64: "AAAA", transactionReference: f.expected.reference }; },
      attempt => { attempt.submission = { transactionBase64: toBase64(f.expected.transactionBytes), transactionReference: "other" }; },
    ];
    for (const mutate of mutations) {
      const attempt = structuredClone(f.attempt);
      mutate(attempt);
      const events: string[] = [];
      const memory = submissionStore(attempt, events, f.deps.now);
      const progress = createPaymentProgress({ ...f.deps, store: memory.store });
      await expect(progress(attempt.id)).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
      expect(events).toEqual([]);
    }
    expect(f.events).toEqual([]);
  });

  it("missing signatures cannot claim and an unexpired pre-submission attempt stays blocking", async () => {
    const f = await setup();
    for (const state of ["signing", "declined"] as const) {
      const attempt = { ...f.attempt, state, signatures: f.attempt.signatures.slice(1) };
      const events: string[] = [];
      const memory = submissionStore(attempt, events, f.deps.now);
      expect(await createPaymentProgress({ ...f.deps, store: memory.store, backendAssurance: "coherent_backend_and_retention_established" })(attempt.id)).toEqual(attempt);
      expect(events).not.toContain("resolve");
      expect(events).not.toContain("claim");
      expect(events).not.toContain("sendTransaction");
    }
    expect(f.events).toContain("getEpochInfo");
    const beforeUnresolved = f.events.length;
    const unresolved = { ...f.attempt, state: "unresolved" as const, signatures: f.attempt.signatures.slice(1) };
    const events: string[] = [];
    const memory = submissionStore(unresolved, events, f.deps.now);
    expect(await createPaymentProgress({ ...f.deps, store: memory.store })(unresolved.id)).toEqual(unresolved);
    expect(events).toEqual([]);
    expect(f.events).toHaveLength(beforeUnresolved);
  });

  it("expires a partial or declined attempt only with the same blockhash predicate and no send", async () => {
    const assured = "coherent_backend_and_retention_established" as const;
    const f = await setup();
    f.mutate(attempt => { attempt.signatures = attempt.signatures.slice(1); });
    f.setHeight(251);
    const unverified = await f.progress(f.attempt.id);
    expect(unverified.state).toBe("signing");
    expect(unverified.safelyResolved).toBe(false);
    expect(unverified.submission).toBeNull();
    expect(f.events).not.toContain("resolve");
    expect(f.events).not.toContain("sendTransaction");
    const expired = await createPaymentProgress({ ...f.deps, backendAssurance: assured })(f.attempt.id);
    expect(expired.state).toBe("expired");
    expect(expired.safelyResolved).toBe(true);
    expect(expired.submission).toBeNull();
    expect(f.events).not.toContain("sendTransaction");
    expect(f.events).not.toContain("claim");
    const declined = await setup();
    declined.mutate(attempt => { attempt.state = "declined"; attempt.signatures = attempt.signatures.slice(1); });
    declined.setHeight(251);
    const closed = await createPaymentProgress({ ...declined.deps, backendAssurance: assured })(declined.attempt.id);
    expect(closed).toMatchObject({ state: "expired", safelyResolved: true, submission: null });
    expect(declined.events).not.toContain("sendTransaction");
  });

  it("keeps a visible fee-payer signature blocking and treats unknown RPC as unresolved", async () => {
    const assured = "coherent_backend_and_retention_established" as const;
    const visible = await setup();
    visible.mutate(attempt => { attempt.signatures = attempt.signatures.slice(0, 1); });
    visible.setHeight(251);
    visible.setStatus({ slot: 500, confirmationStatus: "finalized", err: null });
    const found = await createPaymentProgress({ ...visible.deps, backendAssurance: assured })(visible.attempt.id);
    expect(found).toMatchObject({ state: "signing", safelyResolved: false, submission: null });
    expect(visible.events).not.toContain("resolve");
    expect(visible.events).not.toContain("sendTransaction");
    expect(visible.events).not.toContain("getTransaction");
    const unknown = await setup();
    unknown.mutate(attempt => { attempt.signatures = attempt.signatures.slice(1); });
    unknown.setHeight(251);
    unknown.setGenesis("wrong-cluster");
    const blocked = await createPaymentProgress({ ...unknown.deps, backendAssurance: assured })(unknown.attempt.id);
    expect(blocked.state).toBe("signing");
    expect(blocked.safelyResolved).toBe(false);
    expect(unknown.events).not.toContain("resolve");
  });

  it("a decline during resolution revokes the token, and a later pass can expire", async () => {
    const f = await setup();
    f.mutate(attempt => { attempt.signatures = attempt.signatures.slice(1); });
    f.setHeight(251);
    let slots = 0;
    f.onCall(async method => {
      if (method !== "getSlot") return;
      slots += 1;
      if (slots === 2) await f.store.declineAttempt({ attemptId: f.attempt.id, signerWallet: f.attempt.participants[0]!.wallet });
    });
    const blocked = await createPaymentProgress({ ...f.deps, backendAssurance: "coherent_backend_and_retention_established" })(f.attempt.id);
    expect(blocked).toMatchObject({ state: "declined", safelyResolved: false, submission: null, resolutionLease: null });
    expect(f.events).not.toContain("outcome:expired");
    const expired = await createPaymentProgress({ ...f.deps, backendAssurance: "coherent_backend_and_retention_established" })(f.attempt.id);
    expect(expired).toMatchObject({ state: "expired", safelyResolved: true, submission: null });
    expect(f.events).not.toContain("sendTransaction");
  });

  it("a submission that arrives before resolution is reconciled instead of dropped", async () => {
    const f = await setup();
    f.mutate(attempt => { attempt.signatures = attempt.signatures.slice(1); });
    f.setHeight(251);
    let planted = false;
    f.onCall(async method => {
      if (method !== "getSlot" || planted) return;
      planted = true;
      f.mutate(attempt => {
        attempt.signatures = structuredClone(f.attempt.signatures);
        attempt.submission = { transactionBase64: toBase64(f.expected.transactionBytes), transactionReference: f.expected.reference };
      });
    });
    const result = await createPaymentProgress({ ...f.deps, backendAssurance: "coherent_backend_and_retention_established" })(f.attempt.id);
    expect(result.submission?.transactionReference).toBe(f.expected.reference);
    expect(result.state).toBe("expired");
    expect(result.safelyResolved).toBe(true);
    expect(f.events).toContain("persisted");
    expect(f.events).not.toContain("resolve");
    expect(f.events).not.toContain("sendTransaction");
  });

  it("lets one fresh attempt replace an expired partial payment and rejects the old signature", async () => {
    const f = await serviceFixture();
    const latest = f.replies.getLatestBlockhash as { value: { blockhash: string } };
    f.replies.getLatestBlockhash = { value: { blockhash: latest.value.blockhash, lastValidBlockHeight: 250 } };
    await f.prepare();
    const old = await f.upload(0);
    await f.service.addSignature(old);
    const rpc: PaymentRpc = { async call(method) {
      if (method === "getGenesisHash") return DEVNET_GENESIS_HASH;
      if (method === "getEpochInfo") return { absoluteSlot: 1000, blockHeight: 251 };
      if (method === "getSignatureStatuses") return { context: { slot: 1001 }, value: [null] };
      if (method === "getSlot") return 1002;
      throw new Error(`Unexpected ${method}`);
    } };
    const expired = await createPaymentProgress({
      store: f.store, readCheckout: async () => f.room.checkout, config: f.config, rpc,
      now: () => new Date(f.store.now), backendAssurance: "coherent_backend_and_retention_established",
    })(f.current().id);
    expect(expired).toMatchObject({ state: "expired", safelyResolved: true, submission: null });
    expect(projectAttempt({ attempt: expired, room: await f.store.readRoom() }).canRetry).toBe(true);
    f.replies.getLatestBlockhash = { value: {
      blockhash: getAddressDecoder().decode(new Uint8Array(32).fill(21)), lastValidBlockHeight: 250,
    } };
    const replacement = await f.service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: expired.id });
    expect(replacement.id).not.toBe(expired.id);
    expect(f.store.attempts.size).toBe(2);
    expect(f.store.attempts.get(replacement.id)?.signatures).toEqual([]);
    await expect(f.service.addSignature({ ...old, attemptId: replacement.id })).rejects.toMatchObject({ code: "MESSAGE_MISMATCH" });
    expect(f.store.attempts.get(replacement.id)?.signatures).toEqual([]);
    const duplicate = await f.service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null });
    expect(duplicate.id).toBe(replacement.id);
    expect(f.store.attempts.size).toBe(2);
  });
});
