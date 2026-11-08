import { inspectFinalizedPayment, type ExpectedSettlement, type SettlementEvidence } from "./chain-inspection";

export type BackendAssurance = "unverified" | "coherent_backend_and_retention_established";
export type KnownSubmission = ExpectedSettlement & Readonly<{ lastValidBlockHeight: bigint }>;
export type ChainObservation =
  | Readonly<{ kind: "unavailable" | "inconsistent"; reason: string }>
  | Readonly<{ kind: "nonfinal"; commitment: "processed" | "confirmed" | "unknown";
      contextSlot: bigint; transactionSlot: bigint; executionError: boolean }>
  | Readonly<{ kind: "finalized"; contextSlot: bigint; transactionSlot: bigint;
      executionError: boolean; rawTransaction: unknown }>
  | Readonly<{ kind: "recent_absence"; finalizedSlot: bigint; finalizedBlockHeight: bigint;
      statusContextSlot: bigint; afterLookupProcessedSlot: bigint }>
  | Readonly<{ kind: "historical_absence"; contextSlot: bigint; finalizedBlockHeight?: bigint }>
  | Readonly<{ kind: "absent"; contextSlot: bigint }>;
export type ReconciliationDecision =
  | Readonly<{ kind: "unresolved"; reason: string }>
  | Readonly<{ kind: "expired"; safelyResolved: true }>
  | Readonly<{ kind: "failed"; safelyResolved: true; reason: "finalized_execution_error" }>
  | Readonly<{ kind: "finalized"; evidence: SettlementEvidence }>;

export function blockhashExpired(input: Readonly<{
  lastValidBlockHeight: bigint; finalizedSlot: bigint; finalizedBlockHeight: bigint;
  statusContextSlot: bigint; afterLookupProcessedSlot: bigint; backendAssurance: BackendAssurance;
}>): boolean {
  const limit = input.lastValidBlockHeight;
  const upperHeight = input.finalizedBlockHeight + input.afterLookupProcessedSlot - input.finalizedSlot;
  return input.backendAssurance === "coherent_backend_and_retention_established" && limit >= 150n
    && input.finalizedBlockHeight > limit && input.statusContextSlot >= input.finalizedSlot
    && input.afterLookupProcessedSlot >= input.statusContextSlot && upperHeight - (limit - 150n) < 300n;
}

export function decideReconciliation(input: Readonly<{
  expected: KnownSubmission; observation: ChainObservation; backendAssurance: BackendAssurance;
}>): ReconciliationDecision {
  const { expected, observation: o, backendAssurance } = input;
  switch (o.kind) {
    case "unavailable": case "inconsistent": return { kind: "unresolved", reason: o.reason };
    case "nonfinal": return { kind: "unresolved", reason: "awaiting_finalized_evidence" };
    case "absent": case "historical_absence": return { kind: "unresolved", reason: "absence_without_coverage" };
    case "recent_absence": return blockhashExpired({
      lastValidBlockHeight: expected.lastValidBlockHeight, finalizedSlot: o.finalizedSlot,
      finalizedBlockHeight: o.finalizedBlockHeight, statusContextSlot: o.statusContextSlot,
      afterLookupProcessedSlot: o.afterLookupProcessedSlot, backendAssurance,
    }) ? { kind: "expired", safelyResolved: true } : { kind: "unresolved", reason: "absence_without_coverage" };
    case "finalized": {
      if (o.transactionSlot > o.contextSlot || typeof o.rawTransaction !== "object" || o.rawTransaction === null
        || !("slot" in o.rawTransaction) || typeof o.rawTransaction.slot !== "number"
        || !Number.isSafeInteger(o.rawTransaction.slot) || BigInt(o.rawTransaction.slot) !== o.transactionSlot) {
        return { kind: "unresolved", reason: "finalized_slot_mismatch" };
      }
      const result = inspectFinalizedPayment(expected, { kind: "finalized", executionError: o.executionError }, o.rawTransaction);
      return result.kind === "failed" ? { ...result, safelyResolved: true } : result;
    }
  }
}
