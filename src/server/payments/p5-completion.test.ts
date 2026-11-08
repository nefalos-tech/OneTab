import { describe, expect, it } from "vitest";
import type { PaymentRpc } from "./preflight";
import { DEVNET_GENESIS_HASH } from "./preflight";
import { projectAttempt } from "./service";
import { createPaymentProgress } from "./settlement";
import { serviceFixture } from "./test-fixtures";

describe("P5 service and fake-store checks", () => {
  it("service and fake store only: a declined authorization blocks replacement", async () => {
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

  it("unverified progress blocks expiry and a fresh retry", async () => {
    const f = await serviceFixture();
    const latest = f.replies.getLatestBlockhash as { value: { blockhash: string } };
    f.replies.getLatestBlockhash = { value: { blockhash: latest.value.blockhash, lastValidBlockHeight: 250 } };
    await f.prepare();
    const stored = await f.upload(0);
    await f.service.addSignature(stored);
    const seen: string[] = [];
    const rpc: PaymentRpc = { async call(method) {
      seen.push(method);
      if (method === "getGenesisHash") return DEVNET_GENESIS_HASH;
      if (method === "getEpochInfo") return { absoluteSlot: 1000, blockHeight: 251 };
      if (method === "getSignatureStatuses") return { context: { slot: 1001 }, value: [null] };
      if (method === "getSlot") return 1002;
      throw new Error(`Unexpected ${method}`);
    } };
    const held = await createPaymentProgress({
      store: f.store, readCheckout: async () => f.room.checkout, config: f.config, rpc,
      now: () => new Date(f.store.now),
    })(f.current().id);
    expect(held).toMatchObject({
      id: stored.attemptId, state: "signing", safelyResolved: false, submission: null, receipt: null,
    });
    expect(held.signatures).toEqual([{ signerWallet: stored.wallet, signatureBase64: stored.signatureBase64 }]);
    expect(projectAttempt({ attempt: held, room: await f.store.readRoom() })).toMatchObject({
      id: stored.attemptId, state: "signing", canRetry: false, receipt: null, signedWallets: [stored.wallet],
    });
    await expect(f.service.prepare({
      checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: held.id,
    })).rejects.toMatchObject({ code: "RETRY_BLOCKED" });
    const same = await f.service.prepare({
      checkoutId: f.room.checkout.id, wallet: f.organizer.wallet, retryOfAttemptId: null,
    });
    expect(same).toMatchObject({ id: held.id, state: "signing", canRetry: false, receipt: null, signedWallets: [stored.wallet] });
    expect(f.store.attempts.size).toBe(1);
    expect(f.store.attempts.get(held.id)?.signatures).toEqual([
      { signerWallet: stored.wallet, signatureBase64: stored.signatureBase64 },
    ]);
    expect((await f.store.readRoom()).phase).toBe("paying");
    expect(seen).not.toContain("sendTransaction");
    expect(f.calls).not.toContain("sendTransaction");
  });
});
