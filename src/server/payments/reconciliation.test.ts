import { describe, expect, it } from "vitest";
import { decideReconciliation, type ChainObservation } from "./reconciliation.js";
import { settlementFixture } from "./settlement-fixture.js";

const assured = "coherent_backend_and_retention_established";
const absence = { kind: "recent_absence" as const, finalizedSlot: 1000n, finalizedBlockHeight: 251n,
  statusContextSlot: 1001n, afterLookupProcessedSlot: 1002n };

describe("recent-cache expiry policy", () => {
  it("requires strict expired height, explicit assurance, and all three ordered bounds", async () => {
    const { expected } = await settlementFixture();
    const decide = (observation: ChainObservation, backendAssurance: "unverified" | typeof assured = assured) =>
      decideReconciliation({ expected, observation, backendAssurance });
    expect(decide(absence)).toEqual({ kind: "expired", safelyResolved: true });
    for (const observation of [
      { ...absence, finalizedBlockHeight: 250n }, { ...absence, finalizedBlockHeight: 249n },
      { ...absence, statusContextSlot: 999n }, { ...absence, afterLookupProcessedSlot: 1000n },
      { ...absence, afterLookupProcessedSlot: 1200n },
      { ...absence, finalizedBlockHeight: 399n, statusContextSlot: 1000n, afterLookupProcessedSlot: 1001n },
    ]) expect(decide(observation).kind).toBe("unresolved");
    expect(decide(absence, "unverified").kind).toBe("unresolved");
    expect(decide({ ...absence, finalizedBlockHeight: 399n, statusContextSlot: 1000n, afterLookupProcessedSlot: 1000n }).kind).toBe("expired");
    expect(decideReconciliation({ expected: { ...expected, lastValidBlockHeight: 149n }, observation: absence, backendAssurance: assured }).kind).toBe("unresolved");
  });

  it("never uses nonfinal errors, old history null, or unavailable reads as absence", async () => {
    const { expected } = await settlementFixture();
    for (const commitment of ["processed", "confirmed", "unknown"] as const) {
      for (const executionError of [true, false]) {
        expect(decideReconciliation({ expected, backendAssurance: assured, observation: {
          kind: "nonfinal", commitment, contextSlot: 1000n, transactionSlot: 900n, executionError,
        } }).kind).toBe("unresolved");
      }
    }
    for (const observation of [
      { kind: "historical_absence", contextSlot: 1000n }, { kind: "absent", contextSlot: 1000n },
      { kind: "unavailable", reason: "rpc_observation_unavailable" }, { kind: "inconsistent", reason: "context" },
    ] satisfies ChainObservation[]) expect(decideReconciliation({ expected, observation, backendAssurance: assured }).kind).toBe("unresolved");
  });

  it("requires exact finalized metadata, slot, bytes, execution result and balances", async () => {
    const f = await settlementFixture(3);
    const observation = { kind: "finalized" as const, contextSlot: 600n, transactionSlot: 500n,
      executionError: false, rawTransaction: f.transaction };
    const decide = (o: ChainObservation) => decideReconciliation({ expected: f.expected, observation: o, backendAssurance: "unverified" });
    expect(decide(observation).kind).toBe("finalized");
    for (const rawTransaction of [null, { ...f.transaction, slot: 501 }, { ...f.transaction, meta: null },
      { ...f.transaction, transaction: ["AAAA", "base64"] },
      { ...f.transaction, meta: { ...f.transaction.meta, err: "failure" } },
      { ...f.transaction, meta: { ...f.transaction.meta, postTokenBalances: [] } },
      { ...f.transaction, meta: { ...f.transaction.meta, postBalances: [] } },
    ]) expect(decide({ ...observation, rawTransaction }).kind).toBe("unresolved");
    expect(decide({ ...observation, contextSlot: 499n }).kind).toBe("unresolved");
    expect(decide({ ...observation, executionError: true, rawTransaction: {
      ...f.transaction, meta: { ...f.transaction.meta, err: "InstructionError" },
    } })).toEqual({ kind: "failed", reason: "finalized_execution_error", safelyResolved: true });
  });
});
