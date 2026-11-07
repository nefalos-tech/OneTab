import { z } from "zod";
import { PaymentFailure } from "./errors.js";
import { assertDevnet, type PaymentRpc } from "./preflight.js";
import {
  decideReconciliation, type BackendAssurance, type ChainObservation, type KnownSubmission,
} from "./reconciliation.js";

const integer = z.number().int().nonnegative().safe();
const epoch = z.object({ absoluteSlot: integer, blockHeight: integer });
const statusResponse = z.object({ context: z.object({ slot: integer }), value: z.tuple([z.object({
  slot: integer, confirmationStatus: z.string().nullable(),
  err: z.unknown().refine(value => value !== undefined),
}).nullable()]) });
type StatusObservation = Exclude<ChainObservation, { kind: "recent_absence" } | { kind: "historical_absence" }>;

export function parseChainStatus(raw: unknown): StatusObservation {
  const parsed = statusResponse.safeParse(raw);
  if (!parsed.success) return { kind: "unavailable", reason: "rpc_observation_unavailable" };
  const contextSlot = BigInt(parsed.data.context.slot);
  const value = parsed.data.value[0];
  if (value === null) return { kind: "absent", contextSlot };
  const transactionSlot = BigInt(value.slot);
  if (transactionSlot > contextSlot) return { kind: "inconsistent", reason: "status_context_mismatch" };
  const fields = { contextSlot, transactionSlot, executionError: value.err !== null };
  if (value.confirmationStatus === "finalized") return { kind: "finalized", ...fields, rawTransaction: null };
  const commitment = value.confirmationStatus === "processed" || value.confirmationStatus === "confirmed"
    ? value.confirmationStatus : "unknown";
  return { kind: "nonfinal", commitment, ...fields };
}

export function createPaymentRpc(input: { url: string; timeoutMs?: number; fetch?: typeof fetch }): PaymentRpc {
  try {
    const url = new URL(input.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    if (input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0)) throw new Error();
  } catch { throw new PaymentFailure("CONFIGURATION_UNAVAILABLE"); }
  const transport = input.fetch ?? fetch;
  let id = 0;
  return {
    async call(method, params) {
      const requestId = ++id;
      try {
        const response = await transport(input.url, {
          method: "POST", headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(input.timeoutMs ?? 12_000),
          body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
        });
        if (!response.ok) throw new Error();
        const body = z.object({ jsonrpc: z.literal("2.0"), id: z.literal(requestId),
          result: z.unknown().optional(), error: z.unknown().optional() }).parse(await response.json());
        if (body.error !== undefined || body.result === undefined) throw new Error();
        return body.result;
      } catch { throw new PaymentFailure("RPC_UNAVAILABLE"); }
    },
  };
}

export async function observePayment(input: {
  rpc: PaymentRpc; expected: KnownSubmission; backendAssurance?: BackendAssurance;
}): Promise<ChainObservation> {
  const { rpc, expected } = input;
  const backendAssurance = input.backendAssurance ?? "unverified";
  try {
    await assertDevnet(rpc);
    // Keep F, S, P ordered. The cache may advance after S captures its context.
    let finalized: z.infer<typeof epoch> | null = null;
    try { finalized = epoch.parse(await rpc.call("getEpochInfo", [{ commitment: "finalized" }])); } catch { /* Positive evidence remains useful. */ }
    const readStatus = async (history: boolean) => parseChainStatus(await rpc.call("getSignatureStatuses", [
      [expected.reference], { searchTransactionHistory: history },
    ]));
    const withTransaction = async (status: StatusObservation): Promise<ChainObservation> => status.kind === "finalized"
      ? { ...status, rawTransaction: await rpc.call("getTransaction", [expected.reference, {
        commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0,
      }]) } : status;
    const status = await readStatus(false);
    if (status.kind !== "absent") return await withTransaction(status);
    if (finalized && BigInt(finalized.blockHeight) > expected.lastValidBlockHeight) {
      let afterLookup: number | null = null;
      try { afterLookup = integer.parse(await rpc.call("getSlot", [{
        commitment: "processed", minContextSlot: Number(status.contextSlot),
      }])); } catch { /* A failed bound can only fall back to positive history. */ }
      if (afterLookup !== null) {
        const absence = { kind: "recent_absence" as const, finalizedSlot: BigInt(finalized.absoluteSlot),
          finalizedBlockHeight: BigInt(finalized.blockHeight), statusContextSlot: status.contextSlot,
          afterLookupProcessedSlot: BigInt(afterLookup) };
        if (decideReconciliation({ expected, observation: absence, backendAssurance }).kind === "expired") return absence;
      }
    }
    const history = await readStatus(true);
    if ((history.kind === "absent" || history.kind === "nonfinal" || history.kind === "finalized")
      && history.contextSlot < status.contextSlot) return { kind: "inconsistent", reason: "history_context_regression" };
    return history.kind === "absent" ? { kind: "historical_absence", contextSlot: history.contextSlot,
      ...(finalized ? { finalizedBlockHeight: BigInt(finalized.blockHeight) } : {}) }
      : await withTransaction(history);
  } catch { return { kind: "unavailable", reason: "rpc_observation_unavailable" }; }
}

export async function sendPayment(input: {
  rpc: PaymentRpc; expected: KnownSubmission; transactionBase64: string; ownsLease: () => Promise<boolean>;
}): Promise<boolean> {
  await assertDevnet(input.rpc);
  const height = integer.parse(await input.rpc.call("getBlockHeight", [{ commitment: "processed" }]));
  if (BigInt(height) > input.expected.lastValidBlockHeight || !await input.ownsLease()) return false;
  const reference = await input.rpc.call("sendTransaction", [input.transactionBase64, {
    encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0,
  }]);
  if (reference !== input.expected.reference) throw new PaymentFailure("RPC_UNAVAILABLE");
  return true;
}
