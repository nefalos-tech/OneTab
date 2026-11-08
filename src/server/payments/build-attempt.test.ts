import { describe, expect, it } from "vitest";
import { AccountState, getMintEncoder, getTokenEncoder, TOKEN_PROGRAM_ADDRESS, type TokenArgs } from "@solana-program/token";
import type { ReadonlyUint8Array } from "@solana/kit";
import { fromBase64, toBase64, validateSigningPayload } from "../../lib/payments/signing-payload";
import { key, paymentFixture } from "../../lib/payments/test-fixtures";
import { buildSigningPayload } from "./build-attempt";
import { DEVNET_GENESIS_HASH, type PaymentRpc } from "./preflight";

function encodedAccount(data: ReadonlyUint8Array) {
  return { value: { owner: TOKEN_PROGRAM_ADDRESS, executable: false, data: [toBase64(data), "base64"] } };
}

async function preflightFixture(count: 2 | 3 = 3) {
  const f = await paymentFixture(count);
  const tokens = [...f.plan.contributions.map(payer => ({ wallet: payer.wallet, token: payer.sourceTokenAccount, minimum: payer.units })),
    { wallet: f.plan.sellerWallet, token: f.plan.sellerTokenAccount, minimum: 0n }];
  const tokenData = (wallet: TokenArgs["owner"], amount: bigint, patch: Partial<TokenArgs> = {}) => getTokenEncoder().encode({
    mint: f.plan.mint, owner: wallet, amount, delegate: null, state: AccountState.Initialized,
    isNative: null, delegatedAmount: 0n, closeAuthority: null, ...patch,
  });
  const mintData = getMintEncoder().encode({ mintAuthority: null, supply: 100n, decimals: 6, isInitialized: true, freezeAuthority: null });
  const accounts = new Map<string, unknown>([[f.plan.mint, encodedAccount(mintData)]]);
  for (const token of tokens) accounts.set(token.token, encodedAccount(tokenData(token.wallet, token.minimum)));
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const replies: Record<string, unknown> = {
    getGenesisHash: DEVNET_GENESIS_HASH, getBalance: { value: 15000 }, getFeeForMessage: { value: 15000 },
    getLatestBlockhash: { value: { blockhash: key(20), lastValidBlockHeight: 100 } },
  };
  const rpc: PaymentRpc = { async call(method, params) {
    calls.push({ method, params });
    return method === "getAccountInfo" ? accounts.get(String(params[0])) ?? { value: null } : replies[method];
  } };
  const build = () => buildSigningPayload({ ...f.room, config: f.config, attemptId: f.payload.attemptId, rpc });
  return { ...f, tokens, tokenData, mintData, calls, replies, rpc, accounts, build };
}

describe("B1 payment construction and preflight", () => {
  for (const count of [2, 3] satisfies (2 | 3)[]) {
    it(`constructs a ${count}-payer payload after actual account and exact fee checks`, async () => {
      const f = await preflightFixture(count);
      const payload = await f.build();
      expect(payload).toEqual(f.payload);
      expect(toBase64((await validateSigningPayload({ ...f, payload })).message.transactionBytes)).toBe(payload.transactionBase64);
      expect(f.calls.filter(call => call.method === "getAccountInfo").map(call => call.params)).toEqual([
        f.plan.mint, ...f.tokens.map(token => token.token),
      ].map(account => [account, { encoding: "base64", commitment: "confirmed" }]));
      expect(f.calls.find(call => call.method === "getFeeForMessage")?.params).toEqual([payload.messageBase64, { commitment: "confirmed" }]);
      expect(fromBase64(payload.transactionBase64).length).toBeGreaterThan(fromBase64(payload.messageBase64).length);
      expect(f.calls.some(call => ["sendTransaction", "simulateTransaction"].includes(call.method))).toBe(false);
    });
  }

  it("rejects the wrong genesis before account reads", async () => {
    const f = await preflightFixture();
    f.replies.getGenesisHash = "mainnet";
    await expect(f.build()).rejects.toMatchObject({ code: "WRONG_NETWORK" });
    expect(f.calls.map(call => call.method)).toEqual(["getGenesisHash"]);
  });

  it("rejects missing, foreign-owned, executable or invalid mint data", async () => {
    const f = await preflightFixture();
    for (const account of [
      { value: null }, { value: { ...encodedAccount(f.mintData).value, owner: key(40) } },
      { value: { ...encodedAccount(f.mintData).value, executable: true } },
      encodedAccount(f.mintData.slice(0, 81)),
      encodedAccount(getMintEncoder().encode({ mintAuthority: null, supply: 100n, decimals: 9, isInitialized: true, freezeAuthority: null })),
      encodedAccount(getMintEncoder().encode({ mintAuthority: null, supply: 100n, decimals: 6, isInitialized: false, freezeAuthority: null })),
    ]) {
      f.accounts.set(f.plan.mint, account);
      await expect(f.build()).rejects.toMatchObject({ code: "MINT_INVALID" });
    }
    expect(f.calls.some(call => call.method === "getLatestBlockhash")).toBe(false);
  });

  it("checks every payer and seller token account owner, mint, state and authority flags", async () => {
    const f = await preflightFixture();
    for (const token of f.tokens) {
      const valid = f.accounts.get(token.token);
      f.accounts.set(token.token, { value: null });
      await expect(f.build()).rejects.toMatchObject({ code: "TOKEN_ACCOUNT_MISSING" });
      for (const invalid of [
        { value: { ...encodedAccount(f.tokenData(token.wallet, token.minimum)).value, owner: key(40) } },
        { value: { ...encodedAccount(f.tokenData(token.wallet, token.minimum)).value, executable: true } },
        encodedAccount(f.tokenData(token.wallet, token.minimum).slice(0, 164)),
        ...[
          { mint: key(40) }, { owner: key(40) }, { state: AccountState.Frozen }, { state: AccountState.Uninitialized },
          { delegate: key(40) }, { isNative: 1n }, { closeAuthority: key(40) },
        ].map(patch => encodedAccount(f.tokenData(token.wallet, token.minimum, patch))),
      ]) {
        f.accounts.set(token.token, invalid);
        await expect(f.build()).rejects.toMatchObject({ code: "TOKEN_ACCOUNT_INVALID" });
      }
      f.accounts.set(token.token, valid);
    }
    expect(f.calls.some(call => call.method === "getLatestBlockhash")).toBe(false);
  });

  it("rejects each underfunded payer before fetching the blockhash", async () => {
    const f = await preflightFixture();
    for (const payer of f.plan.contributions) {
      const valid = f.accounts.get(payer.sourceTokenAccount);
      f.accounts.set(payer.sourceTokenAccount, encodedAccount(f.tokenData(payer.wallet, payer.units - 1n)));
      await expect(f.build()).rejects.toMatchObject({ code: "INSUFFICIENT_USDC" });
      f.accounts.set(payer.sourceTokenAccount, valid);
    }
    expect(f.calls.some(call => call.method === "getLatestBlockhash")).toBe(false);
  });

  it("requires organizer SOL to cover the exact message fee and rejects a null quote", async () => {
    const f = await preflightFixture();
    f.replies.getBalance = { value: 0 };
    await expect(f.build()).rejects.toMatchObject({ code: "INSUFFICIENT_SOL" });
    expect(f.calls.some(call => call.method === "getLatestBlockhash")).toBe(false);
    f.replies.getBalance = { value: 14999 };
    await expect(f.build()).rejects.toMatchObject({ code: "INSUFFICIENT_SOL" });
    f.replies.getBalance = { value: 15000 };
    f.replies.getFeeForMessage = { value: null };
    await expect(f.build()).rejects.toMatchObject({ code: "FEE_UNAVAILABLE" });
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "15000"]) {
      f.replies.getFeeForMessage = { value };
      await expect(f.build()).rejects.toThrow();
    }
  });

  it("rejects malformed RPC lifetime and account encodings", async () => {
    const f = await preflightFixture();
    for (const value of [
      { blockhash: "invalid", lastValidBlockHeight: 100 }, { blockhash: key(20), lastValidBlockHeight: -1 },
      { blockhash: key(20), lastValidBlockHeight: "100" }, { blockhash: key(20), lastValidBlockHeight: 1.5 },
      { blockhash: key(20), lastValidBlockHeight: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      f.replies.getLatestBlockhash = { value };
      await expect(f.build()).rejects.toThrow();
    }
    f.accounts.set(f.plan.mint, { value: { ...encodedAccount(f.mintData).value, data: ["%%%", "base64"] } });
    await expect(f.build()).rejects.toThrow();
  });

  it("snapshots checkout, config, participants and attempt identity before async preparation", async () => {
    const f = await preflightFixture();
    const input = { ...f.room, config: f.config, attemptId: f.payload.attemptId, rpc: f.rpc };
    const building = buildSigningPayload(input);
    input.attemptId = "00000000-0000-4000-8000-000000000003";
    input.checkout.id = "00000000-0000-4000-8000-000000000004";
    input.checkout.totalUnits = "100";
    input.participants.reverse();
    input.config.mint = key(40);
    expect(await building).toEqual(f.payload);
  });
});
