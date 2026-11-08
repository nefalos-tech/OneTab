import { describe, expect, it } from "vitest";
import {
  address, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
} from "@solana/kit";
import { findAssociatedTokenPda, getTransferCheckedInstructionDataDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { RoomSnapshot, SigningPayload } from "../../contracts/index";
import { createPaymentPlan, DEVNET_USDC, sha256 } from "./payment-core";
import { createCheckoutPaymentPlan, fromBase64, toBase64, validateFrozenSigningPayload, validateSigningPayload } from "./signing-payload";
import { config, key, paymentFixture, payloadForPlan } from "./test-fixtures";

describe("B1 signing payload validation", () => {
  for (const count of [2, 3] satisfies (2 | 3)[]) {
    for (const total of [BigInt(count), 10n, 18446744073709551615n]) {
      it(`validates and decodes complete ${count}-payer bytes for total ${total}`, async () => {
        const f = await paymentFixture(count, total);
        const validated = await validateSigningPayload(f);
        expect(validated.target).toEqual({ attemptId: f.payload.attemptId, checkoutId: f.room.checkout.id, lastValidBlockHeight: 100n });
        expect(validated.plan).toEqual(f.plan);
        expect(toBase64(validated.message.transactionBytes)).toBe(f.payload.transactionBase64);
        expect(toBase64(validated.message.messageBytes)).toBe(f.payload.messageBase64);
        const transaction = getTransactionDecoder().decode(validated.message.transactionBytes);
        expect(Object.keys(transaction.signatures)).toHaveLength(count);
        expect(new Set(Object.keys(transaction.signatures))).toEqual(new Set(f.room.participants.map(payer => payer.wallet)));
        expect(Object.values(transaction.signatures).every(value => value === null)).toBe(true);
        const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
        expect(message.version).toBe("legacy");
        if (message.version !== "legacy") throw new Error("Expected legacy message");
        expect(message.lifetimeToken).toBe(f.payload.blockhash);
        expect(message.staticAccounts[0]).toBe(f.room.checkout.organizerWallet);
        expect(message.instructions).toHaveLength(count + 2);
        for (const [index, instruction] of message.instructions.slice(2).entries()) {
          if (!instruction.data || !instruction.accountIndices) throw new Error("Missing checked transfer");
          const payer = f.plan.contributions[index];
          if (!payer) throw new Error("Missing payer");
          expect(message.staticAccounts[instruction.programAddressIndex]).toBe(TOKEN_PROGRAM_ADDRESS);
          expect(instruction.accountIndices.map(account => message.staticAccounts[account])).toEqual([
            payer.sourceTokenAccount, f.plan.mint, f.plan.sellerTokenAccount, payer.wallet,
          ]);
          expect(getTransferCheckedInstructionDataDecoder().decode(instruction.data)).toEqual({ discriminator: 12, amount: payer.units, decimals: 6 });
        }
        expect(validated.plan.contributions.reduce((sum, payer) => sum + payer.units, 0n)).toBe(total);
      });
    }
  }

  it("pins the recorded P1 classic-token associated accounts", async () => {
    const vectors = [
      ["6bYQRpZ13aBZrYrgFtZEnePh5ADuY4KGdW6a2Hsmf8oU", "BvEVznZ4KqQmgmWPWZ3NDmfkcKEWQzobhtVKkTie7xKZ"],
      ["7dmYC9Ca4DdFEfQ9D5B6pQPmsgnHMU3qM5eaRNgpv7VB", "436apUGAkZ2aEqjFCRw46ywFXzhq2DHcScax9gpXgETW"],
      ["3uTY8tDn8N2yLh13bg53SHAHYzp4ZG2ConFVztiNVdW1", "FKaacyjitxPgjQ8mKY5AStxeBRLu7qKRxDiUySQWsedv"],
    ];
    for (const [owner, expected] of vectors) {
      if (!owner) throw new Error("Missing known owner");
      expect((await findAssociatedTokenPda({ owner: address(owner), mint: address(DEVNET_USDC), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]).toBe(expected);
    }
    const f = await paymentFixture(2);
    f.room.checkout.organizerWallet = vectors[0]?.[0] ?? "";
    f.room.checkout.sellerWallet = vectors[2]?.[0] ?? "";
    f.room.participants = f.room.participants.map((payer, index) => ({ ...payer, wallet: vectors[index]?.[0] ?? "" }));
    const plan = await createCheckoutPaymentPlan({ ...f.room, config });
    expect(plan.sellerTokenAccount).toBe(vectors[2]?.[1]);
    expect(plan.contributions.map(payer => payer.sourceTokenAccount)).toEqual(vectors.slice(0, 2).map(vector => vector[1]));
  });

  it("accepts the offset timestamp Postgres stores on a checkout", async () => {
    const f = await paymentFixture(2);
    f.room.checkout.createdAt = "2026-11-08T07:04:24.594424+00:00";
    await expect(createCheckoutPaymentPlan({ ...f.room, config })).resolves.toMatchObject({ feePayer: f.room.checkout.organizerWallet });
  });

  const summaryChanges: [string, (payload: SigningPayload) => void][] = [
    ["seller wallet", payload => { payload.payment.sellerWallet = key(40); }],
    ["seller token account", payload => { payload.payment.sellerTokenAccount = key(40); }],
    ["mint", payload => { payload.payment.mint = key(40); }],
    ["fee payer", payload => { payload.payment.feePayerWallet = key(40); }],
    ["amount", payload => { const payer = payload.payment.contributions[0]; if (payer) payer.amountUnits = "5"; }],
    ["signer", payload => { const payer = payload.payment.contributions[0]; if (payer) payer.wallet = key(40); }],
    ["source", payload => { const payer = payload.payment.contributions[0]; if (payer) payer.sourceTokenAccount = key(40); }],
    ["reordered slots", payload => { payload.payment.contributions.reverse(); }],
    ["duplicate slots", payload => { const payer = payload.payment.contributions[1]; if (payer) payer.slot = 0; }],
    ["out-of-range slot", payload => { const payer = payload.payment.contributions[1]; if (payer) payer.slot = 3; }],
  ];
  for (const [name, change] of summaryChanges) {
    it(`rejects a changed ${name}`, async () => {
      const f = await paymentFixture();
      change(f.payload);
      await expect(validateSigningPayload(f)).rejects.toThrow();
    });
  }

  it("rejects internally consistent bytes using foreign source or seller accounts", async () => {
    const f = await paymentFixture();
    const [first, second, third] = f.plan.contributions;
    if (!third) throw new Error("Expected three payers");
    for (const changed of [
      { sellerTokenAccount: key(40), payers: [first, second, third] satisfies [typeof first, typeof second, typeof third] },
      { sellerTokenAccount: f.plan.sellerTokenAccount,
        payers: [first, second, { ...third, sourceTokenAccount: key(40) }] satisfies [typeof first, typeof second, typeof third] },
    ]) {
      const malicious = createPaymentPlan({ totalUnits: f.plan.totalUnits, sellerWallet: f.plan.sellerWallet, ...changed });
      await expect(validateSigningPayload({ ...f, payload: await payloadForPlan(malicious) })).rejects.toThrow();
    }
  });

  it("rejects every changed transaction account role with a recomputed hash", async () => {
    const f = await paymentFixture();
    const tx = getTransactionDecoder().decode(fromBase64(f.payload.transactionBase64));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    for (const account of message.staticAccounts) {
      const messageBytes = getCompiledTransactionMessageEncoder().encode({ ...message,
        staticAccounts: message.staticAccounts.map(value => value === account ? key(40) : value) });
      const payload = { ...f.payload, messageBase64: toBase64(messageBytes), messageHash: await sha256(messageBytes),
        transactionBase64: toBase64(Uint8Array.of(message.header.numSignerAccounts,
          ...new Uint8Array(64 * message.header.numSignerAccounts), ...messageBytes)) };
      await expect(validateSigningPayload({ ...f, payload })).rejects.toThrow();
    }
  });

  const roomChanges: [string, (room: RoomSnapshot) => void][] = [
    ["seller", room => { room.checkout.sellerWallet = key(40); }],
    ["amount", room => { room.checkout.totalUnits = "11"; }],
    ["mint", room => { room.checkout.mint = key(40); }],
    ["organizer", room => { room.checkout.organizerWallet = key(40); }],
    ["membership", room => { const payer = room.participants[1]; if (payer) payer.wallet = key(40); }],
    ["participant order", room => { room.participants.reverse(); }],
    ["duplicate participant slot", room => { const payer = room.participants[1]; if (payer) payer.slot = 0; }],
    ["unready member", room => { const payer = room.participants[1]; if (payer) payer.ready = false; }],
    ["stale attempt", room => { if (room.attempt) room.attempt.id = "00000000-0000-4000-8000-000000000003"; }],
    ["stale height", room => { if (room.attempt) room.attempt.lastValidBlockHeight = "101"; }],
    ["absent attempt", room => { room.attempt = null; }],
    ["non-signing attempt", room => { if (room.attempt) room.attempt.state = "confirmed"; }],
    ["non-paying room", room => { room.phase = "paid"; }],
  ];
  for (const [name, change] of roomChanges) {
    it(`rejects a trusted room with changed ${name}`, async () => {
      const f = await paymentFixture();
      change(f.room);
      await expect(validateSigningPayload(f)).rejects.toThrow();
    });
  }

  it("requires the verified Devnet USDC configuration", async () => {
    const f = await paymentFixture();
    for (const patch of [{ mint: key(40) }, { tokenDecimals: 9 }, { network: "mainnet" }, { confirmationTarget: "confirmed" }]) {
      await expect(Reflect.apply(validateSigningPayload, undefined, [{ ...f, config: { ...f.config, ...patch } }])).rejects.toThrow();
    }
  });

  it("validates frozen server bytes during recovery while browser signing rejects a submitting room", async () => {
    const f = await paymentFixture();
    if (!f.room.attempt) throw new Error("Missing current attempt");
    f.room.attempt.state = "submitting";
    await expect(validateSigningPayload(f)).rejects.toThrow();
    const result = await validateFrozenSigningPayload({ ...f, ...f.room,
      attemptId: f.room.attempt.id, lastValidBlockHeight: "100" });
    expect(toBase64(result.message.transactionBytes)).toBe(f.payload.transactionBase64);
    await expect(validateFrozenSigningPayload({ ...f, ...f.room,
      attemptId: f.room.attempt.id, lastValidBlockHeight: "101" })).rejects.toThrow();
  });

  it("rejects oversized base64 before allocation and decoded bytes beyond the legacy packet limit", async () => {
    const f = await paymentFixture();
    for (const field of ["transactionBase64", "messageBase64"]) {
      for (const value of ["A".repeat(1648), toBase64(new Uint8Array(1233))]) {
        await expect(validateSigningPayload({ ...f, payload: { ...f.payload, [field]: value } })).rejects.toThrow();
      }
    }
  });

  it("rejects zero shares, noncanonical decimals, malformed encodings and stale payload identifiers", async () => {
    const f = await paymentFixture();
    for (const value of ["0", "01", "+1", "1.0", "1e3", "18446744073709551616"]) {
      const payload = structuredClone(f.payload);
      const payer = payload.payment.contributions[0];
      if (payer) payer.amountUnits = value;
      await expect(validateSigningPayload({ ...f, payload })).rejects.toThrow();
    }
    for (const patch of [
      { transactionBase64: "%%%" }, { transactionBase64: f.payload.transactionBase64 + "\n" },
      { messageBase64: f.payload.messageBase64.slice(0, -1) }, { messageBase64: "" },
      { messageHash: f.payload.messageHash.toUpperCase() }, { messageHash: "0".repeat(64) },
      { lastValidBlockHeight: "0100" }, { lastValidBlockHeight: "18446744073709551616" },
      { checkoutId: "00000000-0000-4000-8000-000000000003" }, { attemptId: "not-a-uuid" },
      { blockhash: key(40) },
    ]) await expect(validateSigningPayload({ ...f, payload: { ...f.payload, ...patch } })).rejects.toThrow();
    for (const totalUnits of ["0", "1", "2", "18446744073709551616"]) {
      await expect(createCheckoutPaymentPlan({ ...f.room, checkout: { ...f.room.checkout, totalUnits }, config })).rejects.toThrow();
    }
  });

  it("copies payload, trusted room and config before the first await", async () => {
    const f = await paymentFixture();
    const expected = structuredClone(f.payload);
    const validating = validateSigningPayload(f);
    f.payload.payment.contributions.reverse();
    f.payload.payment.sellerWallet = key(40);
    f.payload.messageHash = "0".repeat(64);
    f.room.checkout.totalUnits = "12";
    f.room.participants.reverse();
    const first = f.room.participants[0];
    if (!first) throw new Error("Missing first payer");
    first.wallet = key(40);
    f.room.attempt = null;
    f.config.mint = key(40);
    const result = await validating;
    expect(toBase64(result.message.transactionBytes)).toBe(expected.transactionBase64);
    expect(result.plan.totalUnits).toBe(10n);
    expect(result.target.attemptId).toBe(expected.attemptId);
    expect(Object.isFrozen(result.target)).toBe(true);
    expect(Object.isFrozen(result.plan)).toBe(true);
  });
});
