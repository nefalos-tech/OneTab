import { getCompiledTransactionMessageDecoder, getTransactionDecoder, getTransactionEncoder, signatureBytes } from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { looksLikeAddress } from "../../client/contracts";
import { fromBase64, validateSigningPayload } from "../../lib/payments/signing-payload";
import { extractPaymentSignature } from "../../lib/payments/wallet-signature";
import { createPaymentHandlers } from "./http";
import type { PaymentRpc } from "./preflight";
import { serviceFixture } from "./test-fixtures";

const { getRoom } = vi.hoisted(() => ({ getRoom: vi.fn() }));
vi.mock("../rooms/service", async importOriginal => ({
  ...await importOriginal<typeof import("../rooms/service")>(), getRoom,
}));

import { createPaymentRuntime } from "./runtime";

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); vi.useRealTimers(); });

describe("payment application composition", () => {
  for (const count of [2, 3] satisfies (2 | 3)[]) {
    it(`recovers ${count} concurrent HTTP approvals after a lost send response with the same receipt`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
      const f = await serviceFixture(count);
      getRoom.mockImplementation(async () => ({ ok: true, value: await f.store.readRoom() }));
      vi.stubEnv("SOLANA_CLUSTER", "devnet");
      vi.stubEnv("USDC_MINT", f.config.mint);
      vi.stubEnv("USDC_DECIMALS", "6");
      const sent: string[] = [];
      let transaction: unknown = null;
      const rpc: PaymentRpc = { async call(method, params) {
        if (method === "getEpochInfo") return { absoluteSlot: 500, blockHeight: 90 };
        if (method === "getBlockHeight") return 95;
        if (method === "getSignatureStatuses") return { context: { slot: 520 }, value: [transaction
          ? { slot: 500, confirmationStatus: "finalized", err: null } : null] };
        if (method === "getTransaction") return transaction;
        if (method !== "sendTransaction") return f.rpc.call(method, params);
        const bytes = String(params[0]);
        expect(f.current().submission?.transactionBase64).toBe(bytes);
        expect(f.current().submission?.transactionReference).toBeTruthy();
        expect(f.current().signatures).toHaveLength(count);
        sent.push(bytes);
        const message = getCompiledTransactionMessageDecoder().decode(
          getTransactionDecoder().decode(fromBase64(bytes)).messageBytes,
        );
        const amounts = count === 2 ? [5n, 5n] : [4n, 3n, 3n];
        const balances = [...f.plan.contributions.map((payer, index) => ({
          token: payer.sourceTokenAccount, wallet: payer.wallet, before: 100n, after: 100n - amounts[index]!,
        })), { token: f.plan.sellerTokenAccount, wallet: f.plan.sellerWallet, before: 200n, after: 210n }];
        const tokenBalances = (stage: "before" | "after") => balances.map(account => ({
          accountIndex: message.staticAccounts.indexOf(account.token), mint: f.config.mint, owner: account.wallet,
          uiTokenAmount: { amount: String(account[stage]), decimals: 6 },
        }));
        transaction = { slot: 500, transaction: [bytes, "base64"], meta: {
          err: null, fee: 5000 * count,
          preBalances: message.staticAccounts.map(() => 1000000),
          postBalances: message.staticAccounts.map((_, index) => index === 0 ? 1000000 - 5000 * count : 1000000),
          preTokenBalances: tokenBalances("before"), postTokenBalances: tokenBalances("after"),
        } };
        throw new Error("Synthetic lost response after provider accepted the transaction");
      } };
      const ports = { store: f.store, lifecycle: f.store, rpc };
      const handlers = (account: string) => {
        if (!looksLikeAddress(account)) throw new Error("Fixture wallet invalid");
        return createPaymentHandlers({
          requireSession: async () => ({ ok: true, value: { wallet: account, expiresAt: "2026-11-08T00:00:00Z" } }),
          originAllowed: request => request.headers.get("origin") === "https://onetab.test",
          service: () => createPaymentRuntime(ports),
        });
      };
      const request = (body?: unknown) => new Request("https://onetab.test/api/payment", {
        method: "POST", headers: { origin: "https://onetab.test" }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const organizer = handlers(f.organizer.wallet);
      const prepared = await Promise.all([organizer.prepare(request(), f.room.checkout.id), organizer.prepare(request(), f.room.checkout.id)]);
      expect(prepared.map(response => response.status)).toEqual([200, 200]);
      expect(f.store.attempts.size).toBe(1);
      const payloadResponse = await organizer.signingPayload(new Request("https://onetab.test/api/payment"), f.current().id);
      expect(payloadResponse.status).toBe(200);
      const { data: payload } = await payloadResponse.json();
      const validated = await validateSigningPayload({ payload, room: await f.store.readRoom(), config: f.config });
      const uploads = await Promise.all(f.signers.map(async (signer, index) => {
        const signature = await f.upload(index);
        const unsigned = getTransactionDecoder().decode(fromBase64(payload.transactionBase64));
        const returned = getTransactionEncoder().encode({ ...unsigned, signatures: {
          ...unsigned.signatures, [signer.wallet]: signatureBytes(fromBase64(signature.signatureBase64)),
        } });
        return { wallet: signer.wallet, body: await extractPaymentSignature({ validated, wallet: signer.wallet, transactionBytes: returned }) };
      }));
      const results = await Promise.all(uploads.map(upload => handlers(upload.wallet).addSignature(request(upload.body), payload.attemptId)));
      expect(results.map(response => response.status)).toEqual(Array(count).fill(200));
      expect(f.current().state).toBe("unresolved");
      expect(f.current().safelyResolved).toBe(false);
      expect(sent).toHaveLength(1);
      const identity = structuredClone(f.current().submission);
      const retry = await organizer.prepare(request({ retryOfAttemptId: payload.attemptId }), f.room.checkout.id);
      expect(retry.status).toBe(409);
      expect(await retry.json()).toMatchObject({ error: { code: "RETRY_BLOCKED" } });
      f.store.now += 30001;
      vi.setSystemTime(new Date(f.store.now));
      await Promise.all([organizer.refresh(request(), payload.attemptId), organizer.submit(request(), payload.attemptId)]);
      expect(f.current().state).toBe("confirmed");
      expect(f.current().submission).toEqual(identity);
      expect(f.current().receipt).toMatchObject({ transactionReference: identity?.transactionReference,
        confirmationStatus: "finalized", totalUnits: "10", sellerWallet: f.room.checkout.sellerWallet });
      expect(f.current().receipt?.contributions.map(payer => payer.amountUnits)).toEqual(count === 2 ? ["5", "5"] : ["4", "3", "3"]);
      expect((await f.store.readRoom()).phase).toBe("paid");
      for (const upload of uploads) {
        const replay = await handlers(upload.wallet).addSignature(request(upload.body), payload.attemptId);
        expect(replay.status).toBe(200);
        expect(await replay.json()).toMatchObject({ data: { state: "confirmed", canRetry: false,
          receipt: { transactionReference: identity?.transactionReference } } });
      }
      expect(sent).toEqual([identity?.transactionBase64]);
      expect(f.store.attempts.size).toBe(1);
      expect(f.calls.filter(method => method === "getLatestBlockhash")).toHaveLength(1);
    });
  }
});
