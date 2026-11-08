import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import type { AttemptState } from "../../contracts/index";
import { fromBase64 } from "../../lib/payments/signing-payload";
import { PaymentFailure } from "./errors";
import { createPaymentService, projectAttempt } from "./service";
import { createPaymentProgress } from "./settlement";
import { serviceFixture } from "./test-fixtures";

const foreignWallet = getAddressDecoder().decode(new Uint8Array(32).fill(80));

function payer(f: Awaited<ReturnType<typeof serviceFixture>>, slot = 0) {
  const wallet = f.signers[slot]?.wallet;
  if (!wallet) throw new Error("Fixture payer missing");
  return { attemptId: f.current().id, wallet };
}

describe("payment preparation", () => {
  it("reserves one attempt and freezes one message across concurrent preparation and later retries", async () => {
    const f = await serviceFixture();
    const results = await Promise.all([f.prepare(), f.prepare(), f.prepare()]);
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    expect(f.store.attempts.size).toBe(1);
    expect(f.store.freezes).toBe(1);
    const payload = await f.service.signingPayload(payer(f));
    expect(await f.prepare()).toMatchObject({ id: payload.attemptId, state: "signing", signedWallets: [] });
    expect(f.store.freezes).toBe(1);
    expect(f.calls.filter(method => method === "getLatestBlockhash")).toHaveLength(1);
    expect(f.calls).not.toContain("sendTransaction");
  });

  it("denies a non-organizer and incomplete or unready membership before reserving", async () => {
    const f = await serviceFixture();
    await expect(f.service.prepare({ checkoutId: f.room.checkout.id, wallet: foreignWallet, retryOfAttemptId: null }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    f.room.participants[0]!.ready = false;
    await expect(f.prepare()).rejects.toMatchObject({ code: "ROOM_NOT_READY" });
    f.room.participants[0]!.ready = true;
    f.room.participants.pop();
    await expect(f.prepare()).rejects.toMatchObject({ code: "ROOM_NOT_READY" });
    expect(f.store.attempts.size).toBe(0);
    expect(f.calls).toEqual([]);
  });

  it("lets the atomic reservation reject readiness changes after the room read", async () => {
    const f = await serviceFixture();
    const readRoom = async () => {
      const snapshot = await f.store.readRoom();
      f.room.participants[0]!.ready = false;
      return snapshot;
    };
    const service = createPaymentService({ ...f.dependencies, readRoom });
    await expect(service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null }))
      .rejects.toMatchObject({ code: "ROOM_NOT_READY" });
    expect(f.store.attempts.size).toBe(0);
  });

  it("never exposes a payload during preparation and recovers the same attempt after a stale lease", async () => {
    const f = await serviceFixture();
    const reachedFee = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let first = true;
    const service = createPaymentService({ ...f.dependencies, rpc: { async call(method, params) {
      if (method === "getFeeForMessage" && first) {
        first = false;
        reachedFee.resolve();
        await resume.promise;
      }
      return f.rpc.call(method, params);
    } } });
    const preparing = service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null });
    const rejected = expect(preparing).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await reachedFee.promise;
    const id = f.current().id;
    await expect(service.signingPayload(payer(f))).rejects.toMatchObject({ code: "ATTEMPT_NOT_SIGNABLE" });
    expect(f.current().signingPayload).toBeNull();
    expect(await service.refresh(payer(f))).toMatchObject({ id, state: "preparing" });
    f.store.now += 30001;
    f.replies.getLatestBlockhash = { value: { blockhash: foreignWallet, lastValidBlockHeight: 120 } };
    expect(await service.refresh(payer(f))).toMatchObject({ id, state: "signing", lastValidBlockHeight: "120" });
    resume.resolve();
    await rejected;
    expect(f.current().signingPayload?.blockhash).toBe(foreignWallet);
    expect(f.store.freezes).toBe(1);
    expect(f.store.attempts.size).toBe(1);
    expect(f.progressCalls).toEqual([]);
  });

  it("closes pre-publication preflight failure with a safe code and allows only explicit replacement", async () => {
    const f = await serviceFixture();
    f.replies.getBalance = { value: 0 };
    await expect(f.prepare()).rejects.toMatchObject({ code: "INSUFFICIENT_SOL" });
    const failed = await f.prepare();
    expect(failed).toMatchObject({ state: "failed", canRetry: true, error: { code: "INSUFFICIENT_SOL" } });
    expect(f.current().signingPayload).toBeNull();
    f.replies.getBalance = { value: 15000 };
    await expect(f.service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet,
      retryOfAttemptId: "00000000-0000-4000-8000-000000000099" })).rejects.toMatchObject({ code: "RETRY_BLOCKED" });
    const replacement = await f.service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: failed.id });
    expect(replacement).toMatchObject({ state: "signing", signedWallets: [] });
    expect(replacement.id).not.toBe(failed.id);
    expect(await f.service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: failed.id }))
      .toMatchObject({ id: replacement.id, state: "signing" });
    expect(f.store.attempts.size).toBe(2);
    await expect(f.service.signingPayload({ attemptId: failed.id, wallet: f.organizer.wallet }))
      .rejects.toMatchObject({ code: "ATTEMPT_NOT_SIGNABLE" });
  });

  it("maps an unavailable RPC to a safe failure without exposing provider details", async () => {
    const f = await serviceFixture();
    const service = createPaymentService({ ...f.dependencies, rpc: { async call() { throw new Error("private provider URL"); } } });
    await expect(service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null }))
      .rejects.toMatchObject({ code: "RPC_UNAVAILABLE" });
    expect(f.current().observedError).toBe("RPC_UNAVAILABLE");
    expect(f.current().safelyResolved).toBe(true);
  });
});

describe("verified signature collection", () => {
  for (const count of [2, 3] satisfies (2 | 3)[]) {
    it(`retains concurrent uploads for ${count} payers and starts one final-signature progress pass`, async () => {
      const f = await serviceFixture(count);
      await f.prepare();
      const uploads = await Promise.all(f.signers.map((_, slot) => f.upload(slot)));
      await Promise.all(uploads.map(input => f.service.addSignature(input)));
      expect(f.current().signatures).toHaveLength(count);
      expect(new Set(f.current().signatures.map(signature => signature.signerWallet)).size).toBe(count);
      expect(f.progressCalls).toEqual([f.current().id]);
      expect((await f.service.submit(payer(f))).signedWallets).toEqual(f.signers.map(signer => signer.wallet));
      expect(f.progressCalls).toHaveLength(2);
      expect(f.room.participants.every(participant => participant.ready)).toBe(true);
    });
  }

  it("keeps concurrent final uploads after progress failure and recovers through explicit refresh", async () => {
    const f = await serviceFixture();
    await f.prepare();
    let progressCalls = 0;
    const service = createPaymentService({ ...f.dependencies, progress: async attemptId => {
      progressCalls++;
      if (progressCalls === 1) throw new PaymentFailure("RPC_UNAVAILABLE");
      const stored = await f.store.getAttempt({ attemptId });
      if (!stored) throw new Error("Fixture attempt missing");
      return stored;
    } });
    const inputs = await Promise.all([f.upload(0), f.upload(1)]);
    const results = await Promise.allSettled(inputs.map(input => service.addSignature(input)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "RPC_UNAVAILABLE" } });
    expect(f.current().signatures).toHaveLength(2);
    expect(progressCalls).toBe(1);
    for (const input of inputs) {
      expect(await service.addSignature(input)).toMatchObject({ id: input.attemptId, state: "signing",
        signedWallets: f.signers.map(signer => signer.wallet) });
    }
    expect(progressCalls).toBe(1);
    expect(await service.refresh(payer(f))).toMatchObject({ id: f.current().id, state: "signing" });
    expect(progressCalls).toBe(2);
    expect(f.store.attempts.size).toBe(1);
  });

  it("rejects wrong wallet, hash, signature bytes, message, attempt and collection state", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const valid = await f.upload(0);
    await expect(f.service.addSignature({ ...valid, wallet: foreignWallet })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.addSignature({ ...valid, wallet: f.signers[1]!.wallet })).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    await expect(f.service.addSignature({ ...valid, messageHash: "0".repeat(64) })).rejects.toMatchObject({ code: "MESSAGE_MISMATCH" });
    for (const signatureBase64 of ["", "not base64", "A".repeat(86) + "==", valid.signatureBase64.slice(0, -1)]) {
      await expect(f.service.addSignature({ ...valid, signatureBase64 })).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    }
    const different = await f.upload(0, new Uint8Array([1, 2, 3]));
    await expect(f.service.addSignature(different)).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    await expect(f.service.addSignature({ ...valid, attemptId: "00000000-0000-4000-8000-000000000099" }))
      .rejects.toMatchObject({ code: "ATTEMPT_NOT_FOUND" });
    f.current().state = "declined";
    await expect(f.service.addSignature(valid)).rejects.toMatchObject({ code: "ATTEMPT_NOT_SIGNABLE" });
    expect(f.current().signatures).toEqual([]);
    expect(f.progressCalls).toEqual([]);
  });

  it("validates the frozen payment before accepting signatures and ignores later room participant edits", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const input = await f.upload(0);
    const payload = f.current().signingPayload!;
    const bytes = fromBase64(payload.messageBase64);
    bytes[0] = 255;
    const original = payload.messageBase64;
    payload.messageBase64 = Buffer.from(bytes).toString("base64");
    await expect(f.service.addSignature(input)).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
    payload.messageBase64 = original;
    f.room.participants[0]!.wallet = foreignWallet;
    f.room.participants[0]!.ready = false;
    expect((await f.service.addSignature(input)).signedWallets).toEqual([f.organizer.wallet]);
  });

  it("returns identical verified uploads after collection closes without progressing again", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const input = await f.upload(0);
    await f.service.addSignature(input);
    const other = await f.upload(1);
    const states: AttemptState[] = ["submitting", "unresolved", "declined", "confirmed", "failed", "expired"];
    for (const state of states) {
      f.current().state = state;
      expect(await f.service.addSignature(input)).toMatchObject({ id: input.attemptId, state, signedWallets: [input.wallet] });
      await expect(f.service.addSignature(other)).rejects.toMatchObject({ code: "ATTEMPT_NOT_SIGNABLE" });
      await expect(f.service.addSignature({ ...input, signatureBase64: other.signatureBase64 }))
        .rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
      await expect(f.service.addSignature({ ...input, messageHash: "0".repeat(64) })).rejects.toMatchObject({ code: "MESSAGE_MISMATCH" });
    }
    expect(f.current().signatures).toHaveLength(1);
    expect(f.progressCalls).toEqual([]);
  });

  it("recovers an identical signature when the closed store rejects the put", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const input = await f.upload(0);
    const other = await f.upload(1);
    const put = f.store.putVerifiedSignature.bind(f.store);
    f.store.putVerifiedSignature = async value => {
      await put(value);
      f.current().state = "submitting";
      throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE");
    };
    await expect(f.service.addSignature(input)).resolves.toMatchObject({
      id: input.attemptId, state: "submitting", signedWallets: [input.wallet],
    });
    f.store.putVerifiedSignature = async () => { throw new PaymentFailure("ATTEMPT_NOT_SIGNABLE"); };
    await expect(f.service.addSignature(other)).rejects.toMatchObject({ code: "ATTEMPT_NOT_SIGNABLE" });
    await expect(f.service.addSignature({ ...input, signatureBase64: other.signatureBase64 }))
      .rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    expect(f.current().signatures).toHaveLength(1);
    expect(f.progressCalls).toEqual([]);
  });

  it("keeps decline and submission races in the atomic adapter", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const input = await f.upload(0);
    const put = f.store.putVerifiedSignature.bind(f.store);
    f.store.putVerifiedSignature = async value => {
      await f.store.declineAttempt({ attemptId: value.attemptId, signerWallet: value.signerWallet });
      return put(value);
    };
    await expect(f.service.addSignature(input)).rejects.toMatchObject({ code: "ATTEMPT_NOT_SIGNABLE" });
    expect(await f.service.decline(payer(f))).toMatchObject({ state: "declined", canRetry: false });
    expect(f.current().signatures).toEqual([]);
    f.current().state = "submitting";
    expect(await f.service.decline(payer(f))).toMatchObject({ state: "submitting", canRetry: false });
    expect((await f.service.refresh(payer(f))).state).toBe("submitting");
    expect(f.progressCalls).toEqual([f.current().id]);
  });

  it("preserves an accepted duplicate when collection closes during the atomic insert", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const input = await f.upload(0);
    const put = f.store.putVerifiedSignature.bind(f.store);
    f.store.putVerifiedSignature = async value => {
      await put(value);
      f.current().state = "submitting";
      return put(value);
    };
    expect(await f.service.addSignature(input)).toMatchObject({ state: "submitting", signedWallets: [input.wallet] });
    expect(f.current().signatures).toHaveLength(1);
    expect(f.progressCalls).toEqual([]);
  });

  it("rejects a conflicting stored signature without overwriting it", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const input = await f.upload(0);
    f.current().signatures.push({ signerWallet: input.wallet, signatureBase64: "a stored conflicting value" });
    await expect(f.service.addSignature(input)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(f.current().signatures[0]?.signatureBase64).toBe("a stored conflicting value");
  });

  it("requires frozen membership for payload, decline, submit and refresh", async () => {
    const f = await serviceFixture();
    await f.prepare();
    for (const operation of [f.service.signingPayload, f.service.decline, f.service.submit, f.service.refresh]) {
      await expect(operation({ attemptId: f.current().id, wallet: foreignWallet })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(f.progressCalls).toEqual([]);
  });

  it("projects no signatures, private bytes or lease tokens and never trusts a raw observed error", async () => {
    const f = await serviceFixture();
    await f.prepare();
    await f.service.addSignature(await f.upload(0));
    f.current().observedError = "private provider URL and secret bytes";
    f.current().submission = { transactionBase64: "private signed bytes", transactionReference: "public-reference" };
    const projected = projectAttempt({ attempt: f.current(), room: await f.store.readRoom() });
    expect(projected).toMatchObject({ signedWallets: [f.organizer.wallet], transactionReference: "public-reference",
      error: { code: "RPC_UNAVAILABLE" }, canRetry: false });
    expect(Object.keys(projected).sort()).toEqual([
      "canRetry", "error", "id", "lastValidBlockHeight", "receipt", "signedWallets", "state", "transactionReference",
    ]);
    const json = JSON.stringify(projected);
    expect(json).not.toContain("private");
    expect(json).not.toContain(f.current().signatures[0]!.signatureBase64);
    expect(json).not.toContain(f.current().preparationLease!.token);
    f.current().state = "expired";
    f.current().safelyResolved = true;
    expect(projectAttempt({ attempt: f.current(), room: { phase: "paid", attempt: { id: f.current().id } } }).canRetry).toBe(false);
    expect(projectAttempt({ attempt: f.current(), room: { phase: "paying", attempt: { id: "newer-attempt" } } }).canRetry).toBe(false);
  });

  it("closes a never-frozen decline and rejects the old resolution token on the fresh attempt", async () => {
    const f = await serviceFixture();
    const reserved = await f.store.reserveAttempt({ checkoutId: f.room.checkout.id, organizerWallet: f.organizer.wallet, retryOfAttemptId: null });
    let token: string | null = null;
    const claim = f.store.claimResolution.bind(f.store);
    f.store.claimResolution = async input => {
      const lease = await claim(input);
      token = lease?.token ?? token;
      return lease;
    };
    const progress = createPaymentProgress({
      store: f.store, rpc: f.rpc, config: f.config, now: () => new Date(f.store.now),
      readCheckout: async () => (await f.store.readRoom()).checkout,
    });
    const service = createPaymentService({ ...f.dependencies, progress });
    const closed = await service.decline({ attemptId: reserved.id, wallet: f.organizer.wallet });
    expect(token).toMatch(/^test-fence-/);
    expect(closed).toMatchObject({ id: reserved.id, state: "failed", canRetry: true, transactionReference: null, error: null });
    expect(f.calls).not.toContain("sendTransaction");
    expect(f.calls).not.toContain("getLatestBlockhash");
    expect(await service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null })).toMatchObject({ id: reserved.id, state: "failed" });
    await expect(f.store.recordOutcome({ attemptId: reserved.id, leaseToken: token ?? "", outcome: { state: "failed", error: null, safelyResolved: true } }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const replacement = await service.prepare({ checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: reserved.id });
    expect(replacement.id).not.toBe(reserved.id);
    expect(f.store.attempts.get(replacement.id)?.signatures).toEqual([]);
    await expect(service.addSignature({ attemptId: replacement.id, wallet: f.organizer.wallet, messageHash: "ab".repeat(32), signatureBase64: `${"A".repeat(86)}==` }))
      .rejects.toMatchObject({ code: "MESSAGE_MISMATCH" });
    expect(f.store.attempts.get(replacement.id)?.signatures).toEqual([]);
    await expect(f.store.recordOutcome({ attemptId: replacement.id, leaseToken: token ?? "", outcome: { state: "failed", error: null, safelyResolved: true } }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(f.store.recordOutcome({ attemptId: reserved.id, leaseToken: token ?? "", outcome: { state: "failed", error: null, safelyResolved: true } }))
      .rejects.toMatchObject({ code: "ATTEMPT_NOT_SIGNABLE" });
  });

  it("propagates typed store conflicts without interpreting arbitrary exception messages", async () => {
    const f = await serviceFixture();
    f.store.reserveAttempt = async () => { throw new PaymentFailure("RETRY_BLOCKED"); };
    await expect(f.prepare()).rejects.toMatchObject({ code: "RETRY_BLOCKED" });
  });
});
