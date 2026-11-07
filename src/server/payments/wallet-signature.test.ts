import { getTransactionDecoder, getTransactionEncoder, signatureBytes } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { serviceFixture } from "./test-fixtures";
import { fromBase64, validateSigningPayload } from "../../lib/payments/signing-payload";
import { extractPaymentSignature } from "../../lib/payments/wallet-signature";
import { looksLikeAddress } from "../../client/contracts";
import { createPaymentHandlers } from "./http";

describe("validated browser signature extraction", () => {
  for (const count of [2, 3] satisfies (2 | 3)[]) {
    it(`extracts each ${count}-payer wallet approval into the HTTP upload shape`, async () => {
      const f = await serviceFixture(count);
      await f.prepare();
      const room = await f.store.readRoom();
      const payload = await f.service.signingPayload({ attemptId: f.current().id, wallet: f.organizer.wallet });
      const validated = await validateSigningPayload({ payload, room, config: f.config });
      for (let slot = 0; slot < count; slot++) {
        const expected = await f.upload(slot);
        const transaction = getTransactionDecoder().decode(fromBase64(payload.transactionBase64));
        const returned = getTransactionEncoder().encode({ ...transaction, signatures: {
          ...transaction.signatures, [expected.wallet]: signatureBytes(fromBase64(expected.signatureBase64)),
        } });
        const upload = await extractPaymentSignature({ validated, wallet: expected.wallet, transactionBytes: returned });
        expect(upload).toEqual({
          messageHash: payload.messageHash, signatureBase64: expected.signatureBase64,
        });
        const wallet = expected.wallet;
        if (!looksLikeAddress(wallet)) throw new Error("Fixture wallet invalid");
        const handlers = createPaymentHandlers({
          requireSession: async () => ({ ok: true, value: { wallet, expiresAt: "2026-11-08T00:00:00Z" } }),
          originAllowed: request => request.headers.get("origin") === "https://onetab.test",
          service: () => f.service,
        });
        const response = await handlers.addSignature(new Request("https://onetab.test/api/payment", {
          method: "POST", headers: { origin: "https://onetab.test" }, body: JSON.stringify(upload),
        }), payload.attemptId);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { signedWallets: expect.arrayContaining([wallet]) } });
      }
    });
  }

  it("rejects changed wallet transaction bytes instead of extracting an unchecked signature", async () => {
    const f = await serviceFixture();
    await f.prepare();
    const payload = f.current().signingPayload!;
    const validated = await validateSigningPayload({ payload, room: await f.store.readRoom(), config: f.config });
    const input = await f.upload(0);
    const transaction = getTransactionDecoder().decode(fromBase64(payload.transactionBase64));
    const returned = Uint8Array.from(getTransactionEncoder().encode({ ...transaction, signatures: {
      ...transaction.signatures, [input.wallet]: signatureBytes(fromBase64(input.signatureBase64)),
    } }));
    returned[returned.length - 1] = 7;
    await expect(extractPaymentSignature({ validated, wallet: input.wallet, transactionBytes: returned })).rejects.toThrow();
  });
});
