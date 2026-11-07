import { describe, expect, it } from "vitest";
import type { StoredAttempt } from "../attempt-store/index";
import type { PaymentRpc } from "./preflight";
import { DEVNET_GENESIS_HASH } from "./preflight";
import { createPaymentProgress } from "./settlement";
import { settlementFixture, submissionStore } from "./settlement-fixture";
import { toBase64 } from "../../lib/payments/signing-payload";

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

  it("missing signatures cannot claim and declined authorization without submission has no invented lease", async () => {
    const f = await setup();
    for (const state of ["signing", "declined", "unresolved"] as const) {
      const attempt = { ...f.attempt, state, signatures: f.attempt.signatures.slice(1) };
      const events: string[] = [];
      const memory = submissionStore(attempt, events, f.deps.now);
      expect(await createPaymentProgress({ ...f.deps, store: memory.store })(attempt.id)).toEqual(attempt);
      expect(events).toEqual([]);
    }
    expect(f.events).toEqual([]);
  });
});
