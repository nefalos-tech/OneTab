import {
  getBase58Decoder, getBase64Decoder, getBase64Encoder, getCompiledTransactionMessageDecoder,
  getTransactionDecoder, getTransactionEncoder, type ReadonlyUint8Array,
} from '@solana/kit';
import { z } from 'zod';
import { equalBytes, type PaymentPlan, type Payers } from './payment-core.js';

const integer = z.number().int().nonnegative().safe();
const executionError = z.unknown().refine(value => value !== undefined, 'RPC err must be explicitly present');
const statusResponse = z.object({ value: z.tuple([z.object({
  confirmationStatus: z.enum(['processed', 'confirmed', 'finalized']).nullable(), err: executionError,
}).nullable()]) });
const tokenBalance = z.object({
  accountIndex: integer, mint: z.string(), owner: z.string(),
  uiTokenAmount: z.object({
    amount: z.string().regex(/^[0-9]+$/).pipe(z.string().refine(value => BigInt(value) <= (1n << 64n) - 1n)),
    decimals: integer,
  }),
});
const chainTransaction = z.object({
  slot: integer, transaction: z.tuple([z.string(), z.literal('base64')]),
  meta: z.object({
    err: executionError, fee: integer, preBalances: z.array(integer), postBalances: z.array(integer),
    preTokenBalances: z.array(tokenBalance), postTokenBalances: z.array(tokenBalance),
  }).nullable(),
});

export type SignatureStatus = Readonly<
  { kind: 'pending' } | { kind: 'unavailable' } | { kind: 'finalized'; executionError: boolean }
>;
export type ExpectedSettlement = Readonly<{
  plan: PaymentPlan; messageBytes: ReadonlyUint8Array; transactionBytes: ReadonlyUint8Array; reference: string;
}>;
export type SettlementEvidence = Readonly<{
  reference: string; slot: number; feeLamports: bigint; sellerIncrease: bigint; payerDecreases: Payers<bigint>;
}>;
export type EvidenceReason = 'rpc_observation_unavailable' | 'finalized_metadata_unavailable'
  | 'transaction_identity_or_metadata_mismatch' | 'token_balance_evidence_mismatch' | 'fee_balance_evidence_mismatch';
export type Inspection = Readonly<
  { kind: 'unresolved'; reason: EvidenceReason }
  | { kind: 'failed'; reason: 'finalized_execution_error' }
  | { kind: 'finalized'; evidence: SettlementEvidence }
>;

export function parseSignatureStatus(rawResult: unknown): SignatureStatus {
  const result = statusResponse.safeParse(rawResult);
  if (!result.success) return { kind: 'unavailable' };
  const status = result.data.value[0];
  if (!status || status.confirmationStatus !== 'finalized') return { kind: 'pending' };
  return { kind: 'finalized', executionError: status.err !== null };
}

function settlementMessage(expected: ExpectedSettlement) {
  try {
    const transactionBytes = Uint8Array.from(expected.transactionBytes);
    const messageBytes = Uint8Array.from(expected.messageBytes);
    const transaction = getTransactionDecoder().decode(transactionBytes);
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const signers = Object.keys(transaction.signatures);
    const organizer = transaction.signatures[expected.plan.feePayer];
    if (message.version !== 'legacy' || message.staticAccounts[0] !== expected.plan.feePayer
      || message.header.numSignerAccounts !== expected.plan.contributions.length
      || signers.length !== expected.plan.contributions.length
      || expected.plan.contributions.some(payer => !signers.includes(payer.wallet))
      || Object.values(transaction.signatures).some(signature => !signature || signature.length !== 64 || signature.every(byte => byte === 0))
      || !organizer || getBase58Decoder().decode(organizer) !== expected.reference
      || !equalBytes(messageBytes, transaction.messageBytes)
      || !equalBytes(transactionBytes, getTransactionEncoder().encode(transaction))) return null;
    return { message, transactionBytes };
  } catch { return null; }
}

export function inspectFinalizedPayment(expected: ExpectedSettlement,
  status: Extract<SignatureStatus, { kind: 'finalized' }>, rawTransaction: unknown): Inspection {
  const stored = settlementMessage(expected);
  if (rawTransaction === null) return { kind: 'unresolved', reason: 'finalized_metadata_unavailable' };
  const parsed = chainTransaction.safeParse(rawTransaction);
  if (!parsed.success) return { kind: 'unresolved', reason: 'rpc_observation_unavailable' };
  const tx = parsed.data;
  let fetchedBytes;
  try {
    fetchedBytes = getBase64Encoder().encode(tx.transaction[0]);
    if (getBase64Decoder().decode(fetchedBytes) !== tx.transaction[0]) throw new Error('Noncanonical base64');
  } catch { return { kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch' }; }
  if (!stored || !equalBytes(fetchedBytes, stored.transactionBytes) || !tx.meta) {
    return { kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch' };
  }
  const meta = tx.meta;
  if (status.executionError !== (meta.err !== null)) {
    return { kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch' };
  }
  if (status.executionError) return { kind: 'failed', reason: 'finalized_execution_error' };
  const expectedTokens = [
    ...expected.plan.contributions.map(payer => ({ wallet: payer.wallet, token: payer.sourceTokenAccount, delta: -payer.units })),
    { wallet: expected.plan.sellerWallet, token: expected.plan.sellerTokenAccount, delta: expected.plan.totalUnits },
  ];
  if (meta.preTokenBalances.length !== expectedTokens.length || meta.postTokenBalances.length !== expectedTokens.length) {
    return { kind: 'unresolved', reason: 'token_balance_evidence_mismatch' };
  }
  for (const account of expectedTokens) {
    const index = stored.message.staticAccounts.indexOf(account.token);
    const matches = (balance: z.infer<typeof tokenBalance>) => balance.accountIndex === index
      || (balance.owner === account.wallet && balance.mint === expected.plan.mint);
    const before = meta.preTokenBalances.filter(matches);
    const after = meta.postTokenBalances.filter(matches);
    if (index < 0 || before.length !== 1 || after.length !== 1 || !before[0] || !after[0]
      || before[0].accountIndex !== index || after[0].accountIndex !== index
      || before[0].owner !== account.wallet || after[0].owner !== account.wallet
      || before[0].mint !== expected.plan.mint || after[0].mint !== expected.plan.mint
      || before[0].uiTokenAmount.decimals !== expected.plan.decimals || after[0].uiTokenAmount.decimals !== expected.plan.decimals
      || BigInt(after[0].uiTokenAmount.amount) - BigInt(before[0].uiTokenAmount.amount) !== account.delta) {
      return { kind: 'unresolved', reason: 'token_balance_evidence_mismatch' };
    }
  }
  if (meta.preBalances.length !== stored.message.staticAccounts.length
    || meta.postBalances.length !== stored.message.staticAccounts.length
    || !meta.preBalances.every((before, index) => BigInt(before) - BigInt(meta.postBalances[index] ?? -1) === (index === 0 ? BigInt(meta.fee) : 0n))) {
    return { kind: 'unresolved', reason: 'fee_balance_evidence_mismatch' };
  }
  const contributions = expected.plan.contributions;
  const payerDecreases: Payers<bigint> = contributions.length === 2
    ? [contributions[0].units, contributions[1].units]
    : [contributions[0].units, contributions[1].units, contributions[2].units];
  return { kind: 'finalized', evidence: {
    reference: expected.reference, slot: tx.slot, feeLamports: BigInt(meta.fee),
    sellerIncrease: expected.plan.totalUnits, payerDecreases,
  } };
}
