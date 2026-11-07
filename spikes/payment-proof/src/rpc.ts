import { z } from 'zod';
import { getAddressDecoder } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { corePlanFromProofPlan, fromBase64, type FrozenPayment, type Submission } from './payment.js';
import { ProofFailure } from './errors.js';
import type { PaymentPlan } from './payment-core.js';
import { inspectFinalizedPayment, parseSignatureStatus } from './chain-inspection.js';

const integer = z.number().int().nonnegative().safe();
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

  private async assertDevnet(): Promise<void> {
    if (await this.call('getGenesisHash', []) !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new ProofFailure('WRONG_NETWORK');
  }

  private async account(key: string, mint = false): Promise<Uint8Array> {
    const account = z.object({ value: z.object({
      owner: z.string(), executable: z.boolean(),
      data: z.tuple([z.string(), z.literal('base64')]),
    }).nullable() }).parse(await this.call('getAccountInfo', [key, { encoding: 'base64', commitment: 'confirmed' }]));
    if (!account.value) throw new ProofFailure(mint ? 'MINT_INVALID' : 'TOKEN_ACCOUNT_MISSING');
    if (account.value.owner !== TOKEN_PROGRAM_ADDRESS || account.value.executable) throw new ProofFailure(mint ? 'MINT_INVALID' : 'TOKEN_ACCOUNT_INVALID');
    return fromBase64(account.value.data[0]);
  }

  async prepare(plan: PaymentPlan): Promise<{ blockhash: string; lastValidBlockHeight: string }> {
    await this.assertDevnet();
    const mint = await this.account(plan.mint, true);
    if (mint.length !== 82 || mint[44] !== 6 || mint[45] !== 1) throw new ProofFailure('MINT_INVALID');
    for (const account of [...plan.contributions.map(payer => ({
      wallet: payer.wallet, token: payer.sourceTokenAccount, minimum: payer.units,
    })), { wallet: plan.sellerWallet, token: plan.sellerTokenAccount, minimum: 0n }]) {
      const data = await this.account(account.token);
      if (data.length !== 165) throw new ProofFailure('TOKEN_ACCOUNT_INVALID');
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (getAddressDecoder().decode(data.subarray(0, 32)) !== plan.mint
        || getAddressDecoder().decode(data.subarray(32, 64)) !== account.wallet
        || data[108] !== 1 || view.getUint32(72, true) !== 0 || view.getUint32(109, true) !== 0
        || view.getUint32(129, true) !== 0) {
        throw new ProofFailure('TOKEN_ACCOUNT_INVALID');
      }
      if (view.getBigUint64(64, true) < account.minimum) throw new ProofFailure('INSUFFICIENT_USDC');
    }
    const balance = z.object({ value: integer }).parse(await this.call('getBalance', [plan.feePayer, { commitment: 'confirmed' }]));
    if (balance.value === 0) throw new ProofFailure('INSUFFICIENT_SOL');
    const latest = z.object({ value: z.object({ blockhash: z.string(), lastValidBlockHeight: integer }) })
      .parse(await this.call('getLatestBlockhash', [{ commitment: 'confirmed' }]));
    return { blockhash: latest.value.blockhash, lastValidBlockHeight: String(latest.value.lastValidBlockHeight) };
  }

  async height(): Promise<bigint> { await this.assertDevnet(); return BigInt(integer.parse(await this.call('getBlockHeight', [{ commitment: 'confirmed' }]))); }

  async send(submission: Submission): Promise<string> {
    await this.assertDevnet();
    return z.string().parse(await this.call('sendTransaction', [submission.signedBase64, {
      encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0,
    }]));
  }

  async checkFee(payment: FeePayment): Promise<{ feeLamports: string }> {
    await this.assertDevnet();
    const fee = z.object({ value: integer.nullable() }).parse(await this.call('getFeeForMessage', [payment.messageBase64, { commitment: 'confirmed' }]));
    const balance = z.object({ value: integer }).parse(await this.call('getBalance', [payment.plan.feePayer, { commitment: 'confirmed' }]));
    if (fee.value === null) throw new ProofFailure('FEE_UNAVAILABLE');
    if (balance.value < fee.value) throw new ProofFailure('INSUFFICIENT_SOL');
    return { feeLamports: String(fee.value) };
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
    const status = parseSignatureStatus(await this.call('getSignatureStatuses', [[submission.reference], { searchTransactionHistory: true }]));
    if (status.kind === 'unavailable') return { kind: 'unresolved', reason: 'rpc_observation_unavailable' };
    if (status.kind === 'pending') {
      const expired = await this.height() > BigInt(payment.lastValidBlockHeight);
      return { kind: 'unresolved', reason: expired ? 'lifetime_exceeded_no_finalized_evidence' : 'awaiting_finalized_evidence' };
    }
    const resultTx = await this.call('getTransaction', [submission.reference, {
      encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0,
    }]);
    const inspection = inspectFinalizedPayment({
      plan: corePlanFromProofPlan(payment.plan), messageBytes: fromBase64(payment.messageBase64),
      transactionBytes: fromBase64(submission.signedBase64), reference: submission.reference,
    }, status, resultTx);
    if (inspection.kind !== 'finalized') return inspection;
    const evidence = inspection.evidence;
    return { kind: 'finalized', receipt: {
      reference: submission.reference, explorerUrl: `https://explorer.solana.com/tx/${submission.reference}?cluster=devnet`,
      confirmationStatus: 'finalized', slot: evidence.slot, sellerWallet: payment.plan.sellerWallet,
      sellerIncrease: String(evidence.sellerIncrease),
      payerDecreases: [String(evidence.payerDecreases[0]), String(evidence.payerDecreases[1])],
      feeLamports: String(evidence.feeLamports), observedAt: new Date().toISOString(),
    } };
  }
}
