import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEVNET_USDC } from "../../src/lib/payments/payment-core";
import { fromBase64, toBase64 } from "../../src/lib/payments/signing-payload";
import { postgresAttemptStore } from "../../src/server/attempt-store/postgres";
import { buildSigningPayload } from "../../src/server/payments/build-attempt";
import { DEVNET_GENESIS_HASH, type PaymentRpc } from "../../src/server/payments/preflight";
import { createPaymentProgress } from "../../src/server/payments/settlement";
import { boundAttemptStore } from "../../src/server/payments/store-boundary";
import { serviceFixture } from "../../src/server/payments/test-fixtures";

const phase = process.env.B4_PHASE;
const attemptFile = process.env.B4_ATTEMPT_FILE;

async function roomCall(name: string, body: Record<string, unknown>): Promise<unknown> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Local PostgREST configuration is missing");
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed with HTTP ${response.status}: ${text}`);
  return text.length === 0 ? null : JSON.parse(text) as unknown;
}

describe("local PostgREST payment progress", () => {
  it("expires one partial attempt through the Postgres store", async () => {
    console.log(`progress-node ${process.execPath} ${process.version}`);
    expect(process.version).toBe("v24.22.1");
    expect(phase === "expire" || phase === "read").toBe(true);
    expect(attemptFile).toBeTruthy();
    const store = boundAttemptStore(postgresAttemptStore);
    if (phase === "read") {
      const attemptId = process.env.B4_ATTEMPT_ID;
      expect(attemptId).toMatch(/^[0-9a-f-]{36}$/);
      const stored = await store.getAttempt({ attemptId: attemptId! });
      expect(stored).toMatchObject({ id: attemptId, state: "expired", safelyResolved: true, submission: null });
      return;
    }
    const f = await serviceFixture();
    const latest = f.replies.getLatestBlockhash as { value: { blockhash: string } };
    f.replies.getLatestBlockhash = { value: { blockhash: latest.value.blockhash, lastValidBlockHeight: 250 } };
    const checkout = f.room.checkout;
    const payer = f.signers[1];
    if (!payer) throw new Error("Fixture payer missing");
    await roomCall("create_checkout", {
      p_id: checkout.id, p_client_request_id: "00000000-0000-4000-8000-000000000099", p_title: checkout.title,
      p_organizer_wallet: checkout.organizerWallet, p_seller_wallet: checkout.sellerWallet, p_total_units: 10,
      p_payer_count: 2, p_network: "devnet", p_mint: DEVNET_USDC, p_token_decimals: 6,
    });
    await roomCall("join_checkout", { p_checkout_id: checkout.id, p_wallet: payer.wallet });
    await roomCall("set_checkout_readiness", { p_checkout_id: checkout.id, p_wallet: checkout.organizerWallet, p_ready: true });
    await roomCall("set_checkout_readiness", { p_checkout_id: checkout.id, p_wallet: payer.wallet, p_ready: true });
    const reserved = await store.reserveAttempt({ checkoutId: checkout.id, organizerWallet: checkout.organizerWallet, retryOfAttemptId: null });
    const lease = await store.claimPreparation({ attemptId: reserved.id });
    if (!lease) throw new Error("Preparation lease was not issued");
    const payload = await buildSigningPayload({
      attemptId: reserved.id, checkout, participants: reserved.participants, config: f.config, rpc: f.rpc,
    });
    const frozen = await store.freezeMessage({ attemptId: reserved.id, leaseToken: lease.token, payload });
    const signature = await crypto.subtle.sign("Ed25519", payer.keys.privateKey, Uint8Array.from(fromBase64(payload.messageBase64)));
    const partial = await store.putVerifiedSignature({
      attemptId: reserved.id, signerWallet: payer.wallet, messageHash: payload.messageHash, signatureBase64: toBase64(new Uint8Array(signature)),
    });
    expect(partial.signatures).toHaveLength(1);
    expect(partial.signatures[0]?.signerWallet).not.toBe(payload.payment.feePayerWallet);
    expect(frozen.state).toBe("signing");
    const rpc: PaymentRpc = { async call(method) {
      if (method === "getGenesisHash") return DEVNET_GENESIS_HASH;
      if (method === "getEpochInfo") return { absoluteSlot: 1000, blockHeight: 251 };
      if (method === "getSlot") return 1002;
      throw new Error(`Unexpected ${method}`);
    } };
    const expired = await createPaymentProgress({
      store, readCheckout: async () => checkout, config: f.config, rpc, backendAssurance: "coherent_backend_and_retention_established",
    })(reserved.id);
    expect(expired).toMatchObject({ state: "expired", safelyResolved: true, submission: null });
    expect(expired.resolutionLease).toBeNull();
    writeFileSync(attemptFile!, `${expired.id}\n`);
  });
});
