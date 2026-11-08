import "server-only";
import { isRecord, isTokenUnits, looksLikeAddress } from "@/client/contracts";
import type { AttemptState, Base64, Participant, Receipt, SigningPayload } from "../../contracts";
import type { AttemptStore, Lease, ResolutionLease, StoredAttempt } from "./index";

type DbConfig = { readonly url: string; readonly key: string };
type JsonRecord = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SIGNATURE_REFERENCE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;
const RPC_ERRORS = ["CHECKOUT_NOT_FOUND", "ATTEMPT_NOT_FOUND", "FORBIDDEN", "ROOM_NOT_READY", "CHECKOUT_PAID", "RETRY_BLOCKED", "ATTEMPT_NOT_SIGNABLE", "SIGNATURES_INCOMPLETE", "MESSAGE_MISMATCH"] as const;

function config(): DbConfig {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (typeof url !== "string" || !URL.canParse(url) || typeof key !== "string" || key.length === 0) throw new Error("CONFIGURATION_UNAVAILABLE");
  return { url: url.replace(/\/$/, ""), key };
}

async function rpc(name: string, body: JsonRecord): Promise<unknown> {
  const settings = config();
  let response: Response;
  try {
    response = await fetch(`${settings.url}/rest/v1/rpc/${name}`, {
      method: "POST", cache: "no-store",
      headers: { apikey: settings.key, authorization: `Bearer ${settings.key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("CONFIGURATION_UNAVAILABLE");
  }
  if (!response.ok) {
    let text = "";
    try { text = await response.text(); } catch { /* The public error remains sanitized. */ }
    const code = RPC_ERRORS.find((candidate) => text.includes(candidate));
    throw new Error(code ?? "CONFIGURATION_UNAVAILABLE");
  }
  try { return await response.json(); } catch { throw new Error("CONFIGURATION_UNAVAILABLE"); }
}

function requiredRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new Error("CONFIGURATION_UNAVAILABLE");
  return value;
}
function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("CONFIGURATION_UNAVAILABLE");
  return value;
}
function isAttemptState(value: unknown): value is AttemptState {
  switch (value) {
    case "preparing": case "signing": case "submitting": case "unresolved": case "declined": case "confirmed": case "failed": case "expired": return true;
    default: return false;
  }
}
function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}
function validBase64(value: unknown, exactBytes?: number): value is Base64 {
  if (typeof value !== "string" || !BASE64.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && (exactBytes === undefined || decoded.length === exactBytes) && decoded.toString("base64") === value;
}
function parseLease(value: unknown): Lease | null {
  if (value === null) return null;
  const record = requiredRecord(value);
  const token = requiredString(record.token);
  const expiresAt = requiredString(record.expiresAt);
  if (!UUID.test(token) || !Number.isFinite(Date.parse(expiresAt))) throw new Error("CONFIGURATION_UNAVAILABLE");
  return { token, expiresAt };
}
function parseParticipant(value: unknown): Participant {
  const row = requiredRecord(value);
  if (!Number.isInteger(row.slot) || typeof row.slot !== "number" || row.slot < 0 || row.slot > 2 || typeof row.wallet !== "string" || !looksLikeAddress(row.wallet) || typeof row.shareUnits !== "string" || !isTokenUnits(row.shareUnits) || typeof row.ready !== "boolean") throw new Error("CONFIGURATION_UNAVAILABLE");
  return { slot: row.slot, wallet: row.wallet, shareUnits: row.shareUnits, ready: row.ready };
}
function parsePayload(value: unknown): SigningPayload | null {
  if (value === null) return null;
  const row = requiredRecord(value);
  const payment = requiredRecord(row.payment);
  if (typeof row.attemptId !== "string" || !UUID.test(row.attemptId) || typeof row.checkoutId !== "string" || !UUID.test(row.checkoutId) || !validBase64(row.transactionBase64) || !validBase64(row.messageBase64) || typeof row.messageHash !== "string" || !/^[0-9a-f]{64}$/.test(row.messageHash) || typeof row.blockhash !== "string" || !looksLikeAddress(row.blockhash) || typeof row.lastValidBlockHeight !== "string" || !isTokenUnits(row.lastValidBlockHeight) || payment.network !== "devnet" || typeof payment.mint !== "string" || !looksLikeAddress(payment.mint) || !Number.isInteger(payment.tokenDecimals) || typeof payment.tokenDecimals !== "number" || payment.tokenDecimals < 0 || payment.tokenDecimals > 255 || typeof payment.sellerWallet !== "string" || !looksLikeAddress(payment.sellerWallet) || typeof payment.sellerTokenAccount !== "string" || !looksLikeAddress(payment.sellerTokenAccount) || typeof payment.feePayerWallet !== "string" || !looksLikeAddress(payment.feePayerWallet) || !Array.isArray(payment.contributions)) throw new Error("CONFIGURATION_UNAVAILABLE");
  const contributions = payment.contributions.map((entry) => {
    const item = requiredRecord(entry);
    if (typeof item.slot !== "number" || !Number.isInteger(item.slot) || item.slot < 0 || item.slot > 2 || typeof item.wallet !== "string" || !looksLikeAddress(item.wallet) || typeof item.amountUnits !== "string" || !isTokenUnits(item.amountUnits) || typeof item.sourceTokenAccount !== "string" || !looksLikeAddress(item.sourceTokenAccount)) throw new Error("CONFIGURATION_UNAVAILABLE");
    return { slot: item.slot, wallet: item.wallet, amountUnits: item.amountUnits, sourceTokenAccount: item.sourceTokenAccount };
  });
  return { attemptId: row.attemptId, checkoutId: row.checkoutId, transactionBase64: row.transactionBase64, messageBase64: row.messageBase64, messageHash: row.messageHash, blockhash: row.blockhash, lastValidBlockHeight: row.lastValidBlockHeight, payment: { network: "devnet", mint: payment.mint, tokenDecimals: payment.tokenDecimals, sellerWallet: payment.sellerWallet, sellerTokenAccount: payment.sellerTokenAccount, feePayerWallet: payment.feePayerWallet, contributions } };
}
function parseReceipt(value: unknown): Receipt | null {
  if (value === null) return null;
  const row = requiredRecord(value);
  if (typeof row.transactionReference !== "string" || !SIGNATURE_REFERENCE.test(row.transactionReference) || row.confirmationStatus !== "finalized" || typeof row.sellerWallet !== "string" || !looksLikeAddress(row.sellerWallet) || typeof row.totalUnits !== "string" || !isTokenUnits(row.totalUnits) || typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt)) || typeof row.explorerUrl !== "string" || !Array.isArray(row.contributions)) throw new Error("CONFIGURATION_UNAVAILABLE");
  const contributions = row.contributions.map((value) => {
    const item = requiredRecord(value);
    if (typeof item.slot !== "number" || !Number.isInteger(item.slot) || item.slot < 0 || item.slot > 2 || typeof item.wallet !== "string" || !looksLikeAddress(item.wallet) || typeof item.amountUnits !== "string" || !isTokenUnits(item.amountUnits)) throw new Error("CONFIGURATION_UNAVAILABLE");
    return { slot: item.slot, wallet: item.wallet, amountUnits: item.amountUnits };
  });
  return { transactionReference: row.transactionReference, confirmationStatus: "finalized", sellerWallet: row.sellerWallet, totalUnits: row.totalUnits, contributions, observedAt: row.observedAt, explorerUrl: row.explorerUrl };
}
function parseAttempt(value: unknown): StoredAttempt {
  const row = requiredRecord(value);
  if (typeof row.id !== "string" || !UUID.test(row.id) || typeof row.checkoutId !== "string" || !UUID.test(row.checkoutId) || !isAttemptState(row.state) || typeof row.safelyResolved !== "boolean" || (row.observedError !== null && typeof row.observedError !== "string") || !Array.isArray(row.participants) || !Array.isArray(row.signatures)) throw new Error("CONFIGURATION_UNAVAILABLE");
  const signatures = row.signatures.map((value) => {
    const signature = requiredRecord(value);
    if (typeof signature.signerWallet !== "string" || !looksLikeAddress(signature.signerWallet) || !validBase64(signature.signatureBase64, 64)) throw new Error("CONFIGURATION_UNAVAILABLE");
    return { signerWallet: signature.signerWallet, signatureBase64: signature.signatureBase64 };
  });
  let submission: StoredAttempt["submission"] = null;
  if (row.submission !== null) {
    const value = requiredRecord(row.submission);
    if (!validBase64(value.transactionBase64) || typeof value.transactionReference !== "string" || !SIGNATURE_REFERENCE.test(value.transactionReference)) throw new Error("CONFIGURATION_UNAVAILABLE");
    submission = { transactionBase64: value.transactionBase64, transactionReference: value.transactionReference };
  }
  return { id: row.id, checkoutId: row.checkoutId, state: row.state, safelyResolved: row.safelyResolved, observedError: nullableString(row.observedError), participants: row.participants.map(parseParticipant), preparationLease: parseLease(row.preparationLease), submissionLease: parseLease(row.submissionLease), resolutionLease: parseLease(row.resolutionLease), signingPayload: parsePayload(row.signingPayload), signatures, submission, receipt: parseReceipt(row.receipt) };
}
function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}
function parseReturnedAttempt(value: unknown): StoredAttempt {
  return parseAttempt(one(value));
}

export const postgresAttemptStore: AttemptStore = {
  async reserveAttempt(input) { return parseReturnedAttempt(await rpc("reserve_attempt", { p_checkout_id: input.checkoutId, p_organizer_wallet: input.organizerWallet, p_retry_of_attempt_id: input.retryOfAttemptId })); },
  async claimPreparation(input) { return parseLease(one(await rpc("claim_attempt_preparation", { p_attempt_id: input.attemptId }))); },
  async freezeMessage(input) { return parseReturnedAttempt(await rpc("freeze_attempt_message", { p_attempt_id: input.attemptId, p_lease_token: input.leaseToken, p_payload: input.payload })); },
  async putVerifiedSignature(input) { return parseReturnedAttempt(await rpc("put_attempt_signature", { p_attempt_id: input.attemptId, p_signer_wallet: input.signerWallet, p_message_hash: input.messageHash, p_signature: input.signatureBase64 })); },
  async claimSubmission(input) { return parseLease(one(await rpc("claim_attempt_submission", { p_attempt_id: input.attemptId, p_transaction_bytes: input.transactionBase64, p_transaction_reference: input.transactionReference }))); },
  async failPreparation(input) { return parseReturnedAttempt(await rpc("record_attempt_outcome", { p_attempt_id: input.attemptId, p_lease_token: input.leaseToken, p_outcome: { state: "failed", safelyResolved: true, error: input.error } })); },
  async recordOutcome(input) { return parseReturnedAttempt(await rpc("record_attempt_outcome", { p_attempt_id: input.attemptId, p_lease_token: input.leaseToken, p_outcome: input.outcome })); },
  async getAttempt(input) {
    const value = one(await rpc("get_attempt", { p_attempt_id: input.attemptId }));
    return value === null ? null : parseAttempt(value);
  },
  async declineAttempt(input) { return parseReturnedAttempt(await rpc("decline_attempt", { p_attempt_id: input.attemptId, p_signer_wallet: input.signerWallet })); },
  async claimResolution(input): Promise<ResolutionLease | null> { return parseLease(one(await rpc("claim_attempt_resolution", { p_attempt_id: input.attemptId }))); },
};
