import { z } from 'zod';
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { equalBytes, fromBase64, type FrozenPayment, type Submission } from './payment.js';
import { ProofFailure } from './errors.js';
import type { PaymentPlan } from '../../../src/lib/payments/payment-core.js';
import { assertDevnet, checkPaymentFee, preparePayment } from '../../../src/server/payments/preflight.js';

const integer = z.number().int().nonnegative().safe();
const tokenBalance = z.object({
  accountIndex: integer, mint: z.string(), owner: z.string(),
  uiTokenAmount: z.object({ amount: z.string().regex(/^[0-9]+$/), decimals: integer }),
});
const chainTransaction = z.object({
  slot: integer, transaction: z.tuple([z.string(), z.literal('base64')]),
  meta: z.object({
    err: z.unknown().nullable(), fee: integer, preBalances: z.array(integer), postBalances: z.array(integer),
    preTokenBalances: z.array(tokenBalance), postTokenBalances: z.array(tokenBalance),
  }).nullable(),
});
export const receiptSchema = z.strictObject({
  reference: z.string(), explorerUrl: z.string(), confirmationStatus: z.literal('finalized'), slot: integer,
  sellerWallet: z.string(), sellerIncrease: z.string(), payerDecreases: z.tuple([z.string(), z.string()]),
  feeLamports: z.string(), observedAt: z.string(),
});
export type Receipt = z.infer<typeof receiptSchema>;
export type Observation =
  | { kind: 'unresolved'; reason: string }
  | { kind: 'failed'; reason: 'finalized_execution_error' }
  | { kind: 'finalized'; receipt: Receipt };
export type Simulation = { kind: 'signature_refused' } | { kind: 'inconclusive'; reason: 'simulation_did_not_prove_signature_refusal' };
export class RpcRejected extends Error {
  constructor(readonly code: number) { super('RPC rejected request'); }
}
type FeePayment = Readonly<{ plan: Pick<PaymentPlan, 'feePayer'>; messageBase64: string }>;
export interface ProofRpc {
  prepare(plan: PaymentPlan): Promise<{ blockhash: string; lastValidBlockHeight: string }>;
  send(submission: Submission): Promise<string>;
  observe(payment: FrozenPayment, submission: Submission): Promise<Observation>;
  simulateIncomplete(transactionBase64: string): Promise<Simulation>;
  checkFee(payment: FeePayment): Promise<{ feeLamports: string }>;
  height(): Promise<bigint>;
}

export class DevnetRpc implements ProofRpc {
  constructor(private readonly url: string) {
    try { const url = new URL(this.url); if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(); }
    catch { throw new ProofFailure('CONFIG_INVALID'); }
  }

  async call(method: string, params: readonly unknown[]): Promise<unknown> {
    let response;
    try { response = await fetch(this.url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }); } catch { throw new ProofFailure('RPC_UNAVAILABLE'); }
    if (!response.ok) throw new ProofFailure('RPC_UNAVAILABLE');
    const envelope = z.object({ result: z.unknown().optional(), error: z.unknown().optional() }).parse(await response.json());
    if (envelope.error !== undefined) throw new RpcRejected(z.object({ code: z.number().int() }).parse(envelope.error).code);
    if (envelope.result === undefined) throw new Error('RPC result unavailable');
    return envelope.result;
  }

  private async assertDevnet(): Promise<void> { return assertDevnet(this); }

  async prepare(plan: PaymentPlan): Promise<{ blockhash: string; lastValidBlockHeight: string }> {
    const lifetime = await preparePayment({ plan, rpc: this });
    return { blockhash: lifetime.blockhash, lastValidBlockHeight: String(lifetime.lastValidBlockHeight) };
  }

  async height(): Promise<bigint> { await this.assertDevnet(); return BigInt(integer.parse(await this.call('getBlockHeight', [{ commitment: 'confirmed' }]))); }

  async send(submission: Submission): Promise<string> {
    await this.assertDevnet();
    return z.string().parse(await this.call('sendTransaction', [submission.signedBase64, {
      encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0,
    }]));
  }

  async checkFee(payment: FeePayment): Promise<{ feeLamports: string }> {
    return checkPaymentFee({ ...payment, rpc: this });
  }

  async simulateIncomplete(transactionBase64: string): Promise<Simulation> {
    await this.assertDevnet();
    try {
      const result = z.object({ value: z.object({ err: z.unknown() }) }).parse(await this.call('simulateTransaction', [transactionBase64, {
        encoding: 'base64', commitment: 'confirmed', sigVerify: true, replaceRecentBlockhash: false,
      }]));
      if (result.value.err === 'SignatureFailure') return { kind: 'signature_refused' };
    } catch (error) {
      if (error instanceof RpcRejected && error.code === -32003) return { kind: 'signature_refused' };
    }
    return { kind: 'inconclusive', reason: 'simulation_did_not_prove_signature_refusal' };
  }

  async observe(payment: FrozenPayment, submission: Submission): Promise<Observation> {
    await this.assertDevnet();
    const result = z.object({ value: z.tuple([z.object({
      confirmationStatus: z.enum(['processed', 'confirmed', 'finalized']).nullable(), err: z.unknown().nullable(),
    }).nullable()]) }).parse(await this.call('getSignatureStatuses', [[submission.reference], { searchTransactionHistory: true }]));
    const status = result.value[0];
    if (!status || status.confirmationStatus !== 'finalized') {
      const expired = await this.height() > BigInt(payment.lastValidBlockHeight);
      return { kind: 'unresolved', reason: expired ? 'lifetime_exceeded_no_finalized_evidence' : 'awaiting_finalized_evidence' };
    }
    const resultTx = await this.call('getTransaction', [submission.reference, {
      encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0,
    }]);
    if (resultTx === null) return { kind: 'unresolved', reason: 'finalized_metadata_unavailable' };
    const tx = chainTransaction.parse(resultTx);
    if (!equalBytes(fromBase64(tx.transaction[0]), fromBase64(submission.signedBase64)) || !tx.meta) {
      return { kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch' };
    }
    if (status.err !== null || tx.meta.err !== null) return { kind: 'failed', reason: 'finalized_execution_error' };
    const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(fromBase64(submission.signedBase64)).messageBytes);
    if (message.version !== 'legacy') return { kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch' };
    const expected = [
      ...payment.plan.contributions.map(payer => ({ wallet: payer.wallet, token: payer.sourceTokenAccount, delta: -BigInt(payer.units) })),
      { wallet: payment.plan.sellerWallet, token: payment.plan.sellerTokenAccount, delta: BigInt(payment.plan.total) },
    ];
    for (const account of expected) {
      const before = tx.meta.preTokenBalances.filter(balance => balance.owner === account.wallet && balance.mint === payment.plan.mint);
      const after = tx.meta.postTokenBalances.filter(balance => balance.owner === account.wallet && balance.mint === payment.plan.mint);
      if (before.length !== 1 || after.length !== 1 || !before[0] || !after[0]
        || before[0].accountIndex !== after[0].accountIndex || message.staticAccounts[before[0].accountIndex] !== account.token || before[0].uiTokenAmount.decimals !== 6
        || after[0].uiTokenAmount.decimals !== 6
        || BigInt(after[0].uiTokenAmount.amount) - BigInt(before[0].uiTokenAmount.amount) !== account.delta) {
        return { kind: 'unresolved', reason: 'token_balance_evidence_mismatch' };
      }
    }
    const meta = tx.meta;
    if (meta.preBalances.length !== meta.postBalances.length || meta.preBalances.length === 0
      || !meta.preBalances.every((before, index) => before - (meta.postBalances[index] ?? -1) === (index === 0 ? meta.fee : 0))) {
      return { kind: 'unresolved', reason: 'fee_balance_evidence_mismatch' };
    }
    return { kind: 'finalized', receipt: {
      reference: submission.reference, explorerUrl: `https://explorer.solana.com/tx/${submission.reference}?cluster=devnet`,
      confirmationStatus: 'finalized', slot: tx.slot, sellerWallet: payment.plan.sellerWallet,
      sellerIncrease: payment.plan.total, payerDecreases: [payment.plan.contributions[0].units, payment.plan.contributions[1].units],
      feeLamports: String(meta.fee), observedAt: new Date().toISOString(),
    } };
  }
}
