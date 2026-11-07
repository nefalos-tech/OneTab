import { describe, expect, it, vi } from "vitest";
import { DEVNET_GENESIS_HASH as DEVNET_GENESIS } from "./preflight.js";
import { createPaymentRpc, observePayment, parseChainStatus } from "./rpc.js";
import { settlementFixture } from "./settlement-fixture.js";

const absent = (slot = 1001) => ({ context: { slot }, value: [null] });

describe("RPC boundary", () => {
  it("preserves absent, earlier commitments, unknown commitment, and finalized slots", () => {
    expect(parseChainStatus(absent())).toEqual({ kind: "absent", contextSlot: 1001n });
    for (const confirmationStatus of ["processed", "confirmed", null, "future"]) {
      expect(parseChainStatus({ context: { slot: 9 }, value: [{ slot: 8, err: "failure", confirmationStatus }] })).toEqual({
        kind: "nonfinal", contextSlot: 9n, transactionSlot: 8n, executionError: true,
        commitment: confirmationStatus === "processed" || confirmationStatus === "confirmed" ? confirmationStatus : "unknown",
      });
    }
    for (const raw of [null, { value: [null] }, absent(-1), absent(Number.MAX_SAFE_INTEGER + 1),
      { context: { slot: 9 }, value: [] }, { context: { slot: 9 }, value: [null, null] },
      { context: { slot: 9 }, value: [{ slot: 8, confirmationStatus: "finalized" }] },
    ]) expect(parseChainStatus(raw).kind).toBe("unavailable");
    expect(parseChainStatus({ context: { slot: 9 }, value: [{ slot: 10, err: null, confirmationStatus: "finalized" }] }).kind).toBe("inconsistent");
  });

  it("bounds mutable-cache advancement with F then cache-only S then P", async () => {
    const { expected } = await settlementFixture();
    const calls: [string, readonly unknown[]][] = [];
    const rpc = { async call(method: string, params: readonly unknown[]) {
      calls.push([method, params]);
      if (method === "getGenesisHash") return DEVNET_GENESIS;
      if (method === "getEpochInfo") return { absoluteSlot: 1000, blockHeight: 251 };
      if (method === "getSignatureStatuses") return absent();
      if (method === "getSlot") return 1002;
      throw new Error();
    } };
    expect((await observePayment({ rpc, expected, backendAssurance: "coherent_backend_and_retention_established" })).kind).toBe("recent_absence");
    expect(calls).toEqual([
      ["getGenesisHash", []], ["getEpochInfo", [{ commitment: "finalized" }]],
      ["getSignatureStatuses", [[expected.reference], { searchTransactionHistory: false }]],
      ["getSlot", [{ commitment: "processed", minContextSlot: 1001 }]],
    ]);
  });

  it("unverified affinity, a cache advancing during lookup, and unavailable bounds cannot expire", async () => {
    const { expected } = await settlementFixture();
    for (const patch of ["unverified", "advanced", "regression", "failed-P", "failed-F", "equal-height", "unsafe-F"]) {
      const calls: string[] = [];
      const rpc = { async call(method: string) {
        calls.push(method);
        if (method === "getGenesisHash") return DEVNET_GENESIS;
        if (method === "getEpochInfo") {
          if (patch === "failed-F") throw new Error("private URL");
          return { absoluteSlot: 1000, blockHeight: patch === "equal-height" ? 250 : patch === "unsafe-F" ? Number.MAX_SAFE_INTEGER + 1 : 251 };
        }
        if (method === "getSignatureStatuses") return absent();
        if (method === "getSlot") {
          if (patch === "failed-P") throw new Error();
          return patch === "advanced" ? 1149 : patch === "regression" ? 1000 : 1002;
        }
        throw new Error();
      } };
      expect((await observePayment({ rpc, expected, backendAssurance: patch === "unverified" ? "unverified" : "coherent_backend_and_retention_established" })).kind).toBe("historical_absence");
      expect(calls.filter(call => call === "getSignatureStatuses")).toHaveLength(2);
    }
  });

  it("old positive history resolves despite failed F and uses legacy-compatible transaction reads", async () => {
    const f = await settlementFixture();
    const calls: [string, readonly unknown[]][] = [];
    const rpc = { async call(method: string, params: readonly unknown[]) {
      calls.push([method, params]);
      if (method === "getGenesisHash") return DEVNET_GENESIS;
      if (method === "getEpochInfo") throw new Error();
      if (method === "getSignatureStatuses") return (params[1] as { searchTransactionHistory: boolean }).searchTransactionHistory
        ? { context: { slot: 1001 }, value: [{ slot: 500, err: null, confirmationStatus: "finalized" }] } : absent();
      if (method === "getTransaction") return f.transaction;
      throw new Error();
    } };
    expect((await observePayment({ rpc, expected: f.expected })).kind).toBe("finalized");
    expect(calls.at(-1)).toEqual(["getTransaction", [f.expected.reference, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]]);
  });

  it("history context regression or unavailable archives cannot establish absence", async () => {
    const { expected } = await settlementFixture();
    for (const history of ["regression", "unavailable"]) {
      const rpc = { async call(method: string, params: readonly unknown[]) {
        if (method === "getGenesisHash") return DEVNET_GENESIS;
        if (method === "getEpochInfo") return { absoluteSlot: 1000, blockHeight: 10000 };
        if (method === "getSlot") return 1002;
        if (method === "getSignatureStatuses") {
          if ((params[1] as { searchTransactionHistory: boolean }).searchTransactionHistory) {
            if (history === "unavailable") throw new Error("private archive URL");
            return absent(999);
          }
          return absent();
        }
        throw new Error();
      } };
      expect((await observePayment({ rpc, expected, backendAssurance: "coherent_backend_and_retention_established" })).kind)
        .toBe(history === "regression" ? "inconsistent" : "unavailable");
    }
  });

  it("rejects the wrong cluster before observation and sanitizes transport failures", async () => {
    const f = await settlementFixture();
    const call = vi.fn(async () => "wrong-cluster");
    expect((await observePayment({ rpc: { call }, expected: f.expected })).kind).toBe("unavailable");
    expect(call).toHaveBeenCalledTimes(1);
    for (const response of [
      new Response("private secret", { status: 500 }), new Response("malformed secret"),
      Response.json({ jsonrpc: "2.0", id: 1, error: { message: "private credential" } }),
      Response.json({ jsonrpc: "2.0", id: 2, result: null }), Response.json({ jsonrpc: "2.0", id: 1 }),
    ]) {
      const rpc = createPaymentRpc({ url: "https://example.test?token=private", fetch: vi.fn(async () => response) });
      await expect(rpc.call("getEpochInfo", [])).rejects.toMatchObject({ code: "RPC_UNAVAILABLE", message: "The payment network is unavailable. Check this attempt again." });
    }
    expect(() => createPaymentRpc({ url: "file:///private" })).toThrow("Payment configuration is unavailable.");
    const transport = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new Error("credential and private provider URL");
    });
    await expect(createPaymentRpc({ url: "https://example.test", timeoutMs: 1, fetch: transport }).call("getSlot", [])).rejects.toMatchObject({ code: "RPC_UNAVAILABLE" });
  });
});
