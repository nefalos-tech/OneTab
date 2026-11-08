import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import type { PaymentRpc } from "./preflight";
import { DEVNET_GENESIS_HASH } from "./preflight";
import { projectAttempt } from "./service";
import { createPaymentProgress } from "./settlement";
import { serviceFixture } from "./test-fixtures";

describe("P5 local mock completion", () => {
  it("keeps a declined authorization in place and blocks a replacement", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const stored = await f.upload(0);
    await f.service.addSignature(stored);
    const declined = await f.service.decline({ attemptId: f.current().id, wallet: f.organizer.wallet });
    expect(declined).toMatchObject({
      id: stored.attemptId,
      state: "declined",
      canRetry: false,
      receipt: null,
      transactionReference: null,
      signedWallets: [f.organizer.wallet],
    });
    expect(f.current().signatures).toEqual([{ signerWallet: stored.wallet, signatureBase64: stored.signatureBase64 }]);
    await expect(f.service.prepare({
      checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: declined.id,
    })).rejects.toMatchObject({ code: "RETRY_BLOCKED" });
    const same = await f.service.prepare({
      checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null,
    });
    expect(same).toMatchObject({ id: declined.id, state: "declined", canRetry: false, receipt: null });
    expect(f.store.attempts.size).toBe(1);
    expect((await f.store.readRoom()).phase).toBe("paying");
    expect(f.calls).not.toContain("sendTransaction");
  });

  it("rejects the stored signature on a replaced attempt and leaves the fresh attempt unsigned", async () => {
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
    const expiredAttempt = await createPaymentProgress({
      store: f.store, readCheckout: async () => f.room.checkout, config: f.config, rpc,
      now: () => new Date(f.store.now), backendAssurance: "coherent_backend_and_retention_established",
    })(f.current().id);
    expect(expiredAttempt).toMatchObject({ id: old.attemptId, state: "expired", safelyResolved: true, submission: null, receipt: null });
    expect(projectAttempt({ attempt: expiredAttempt, room: await f.store.readRoom() }).canRetry).toBe(true);
    f.replies.getLatestBlockhash = { value: {
      blockhash: getAddressDecoder().decode(new Uint8Array(32).fill(21)), lastValidBlockHeight: 250,
    } };
    const replacement = await f.service.prepare({
      checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: expiredAttempt.id,
    });
    expect(replacement.id).not.toBe(expiredAttempt.id);
    expect(replacement).toMatchObject({ state: "signing", signedWallets: [], receipt: null, canRetry: false });
    await expect(f.service.addSignature(old)).rejects.toMatchObject({ code: "ATTEMPT_NOT_SIGNABLE" });
    await expect(f.service.addSignature({ ...old, attemptId: replacement.id })).rejects.toMatchObject({ code: "MESSAGE_MISMATCH" });
    expect(f.store.attempts.get(expiredAttempt.id)?.signatures).toEqual([
      { signerWallet: old.wallet, signatureBase64: old.signatureBase64 },
    ]);
    expect(f.store.attempts.get(replacement.id)?.signatures).toEqual([]);
    expect(f.store.attempts.get(expiredAttempt.id)?.receipt).toBeNull();
    expect(f.store.attempts.get(replacement.id)?.receipt).toBeNull();
    expect(f.store.attempts.size).toBe(2);
    expect((await f.store.readRoom()).phase).toBe("paying");
    expect(f.calls).not.toContain("sendTransaction");
  });
});
