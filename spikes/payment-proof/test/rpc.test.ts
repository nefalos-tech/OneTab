import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevnetRpc, RpcRejected } from '../src/rpc.js';
import { getCompiledTransactionMessageDecoder } from '@solana/kit';
import { assembleSubmission, fromBase64 } from '../src/payment.js';
import { syntheticFixture } from './fixtures.js';

class ScriptedRpc extends DevnetRpc {
  calls: { method: string; params: readonly unknown[] }[] = [];
  constructor(readonly replies: Record<string, unknown>) { super('https://invalid.test'); }
  override async call(method: string, params: readonly unknown[] = []): Promise<unknown> {
    this.calls.push({ method, params });
    const reply = this.replies[method];
    if (reply instanceof Error) throw reply;
    return reply;
  }
}
const genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

test('the full observed Devnet genesis permits read-only height checks', async () => {
  const rpc = new ScriptedRpc({ getGenesisHash: genesis, getBlockHeight: 50 });
  assert.equal(await rpc.height(), 50n);
});

test('explicit RPC code -32003 proves signature refusal while unrelated RPC codes remain inconclusive', async () => {
  for (const code of [-32003, -32002, -32603]) {
    const rpc = new ScriptedRpc({ getGenesisHash: genesis, simulateTransaction: new RpcRejected(code) });
    assert.deepEqual(await rpc.simulateIncomplete('synthetic-wire-marker'), code === -32003
      ? { kind: 'signature_refused' } : { kind: 'inconclusive', reason: 'simulation_did_not_prove_signature_refusal' });
    assert.deepEqual(rpc.calls.find(value => value.method === 'simulateTransaction')?.params, ['synthetic-wire-marker', {
      encoding: 'base64', commitment: 'confirmed', sigVerify: true, replaceRecentBlockhash: false,
    }]);
  }
});

async function observedFixture() {
  const f = await syntheticFixture();
  const submission = await assembleSubmission(f.payment, [await f.approval(0), await f.approval(1)]);
  const message = getCompiledTransactionMessageDecoder().decode(fromBase64(f.payment.messageBase64));
  if (message.version !== 'legacy') throw new Error('Expected legacy fixture');
  const accounts = [
    { token: f.plan.contributions[0].sourceTokenAccount, wallet: f.plan.contributions[0].wallet, before: '2000001', after: '0' },
    { token: f.plan.contributions[1].sourceTokenAccount, wallet: f.plan.contributions[1].wallet, before: '2000000', after: '0' },
    { token: f.plan.sellerTokenAccount, wallet: f.plan.sellerWallet, before: '0', after: '4000001' },
  ];
  const tokenBalances = (stage: 'before' | 'after') => accounts.map(account => ({
    accountIndex: message.staticAccounts.indexOf(account.token), mint: f.plan.mint, owner: account.wallet,
    uiTokenAmount: { decimals: 6, amount: account[stage] },
  }));
  const tx = {
    slot: 123, transaction: [submission.signedBase64, 'base64'], meta: {
      err: null, fee: 10000,
      preBalances: message.staticAccounts.map(() => 1000000),
      postBalances: message.staticAccounts.map((_, index) => index === 0 ? 990000 : 1000000),
      preTokenBalances: tokenBalances('before'), postTokenBalances: tokenBalances('after'),
    },
  };
  const rpc = new ScriptedRpc({ getGenesisHash: genesis, getSignatureStatuses: { value: [{ confirmationStatus: 'finalized', err: null }] }, getTransaction: tx, getBlockHeight: 50 });
  return { ...f, submission, tx, rpc };
}

test('only finalized matching transaction metadata and exact token and fee deltas create a receipt', async () => {
  const f = await observedFixture();
  for (const confirmationStatus of ['processed', 'confirmed']) {
    f.rpc.replies.getSignatureStatuses = { value: [{ confirmationStatus, err: null }] };
    assert.equal((await f.rpc.observe(f.payment, f.submission)).kind, 'unresolved');
  }
  f.rpc.replies.getSignatureStatuses = { value: [{ confirmationStatus: 'finalized', err: null }] };
  const observation = await f.rpc.observe(f.payment, f.submission);
  assert.equal(observation.kind, 'finalized');
  if (observation.kind !== 'finalized') throw new Error();
  assert.equal(observation.receipt.sellerIncrease, '4000001');
  assert.deepEqual(observation.receipt.payerDecreases, ['2000001', '2000000']);
  assert.equal(observation.receipt.feeLamports, '10000');
  assert.equal(observation.receipt.reference, f.submission.reference);
  assert.equal(JSON.stringify(observation).includes(f.submission.signedBase64), false);
});

test('finalized execution failure is definitive while expiry without settlement evidence stays unresolved', async () => {
  const f = await observedFixture();
  f.rpc.replies.getSignatureStatuses = { value: [{ confirmationStatus: 'finalized', err: { InstructionError: [1, 'Custom'] } }] };
  f.rpc.replies.getTransaction = { ...f.tx, meta: { ...f.tx.meta, err: { InstructionError: [1, 'Custom'] } } };
  assert.deepEqual(await f.rpc.observe(f.payment, f.submission), { kind: 'failed', reason: 'finalized_execution_error' });
  f.rpc.replies.getSignatureStatuses = { value: [null] }; f.rpc.replies.getBlockHeight = 101;
  assert.deepEqual(await f.rpc.observe(f.payment, f.submission), { kind: 'unresolved', reason: 'lifetime_exceeded_no_finalized_evidence' });
});

test('mismatched wire identity, missing metadata, token deltas, token indices and fee deltas never produce success', async () => {
  const f = await observedFixture();
  const seller = f.tx.meta.postTokenBalances[2]; if (!seller) throw new Error();
  const alternatives = [
    { ...f.tx, transaction: [f.payment.transactionBase64, 'base64'] },
    { ...f.tx, meta: null },
    { ...f.tx, meta: { ...f.tx.meta, postTokenBalances: [...f.tx.meta.postTokenBalances.slice(0, 2), { ...seller, uiTokenAmount: { amount: '4000000', decimals: 6 } }] } },
    { ...f.tx, meta: { ...f.tx.meta, postTokenBalances: [...f.tx.meta.postTokenBalances.slice(0, 2), { ...seller, accountIndex: 0 }] } },
    { ...f.tx, meta: { ...f.tx.meta, fee: 9999 } },
    null,
  ];
  for (const transaction of alternatives) {
    f.rpc.replies.getTransaction = transaction;
    assert.equal((await f.rpc.observe(f.payment, f.submission)).kind, 'unresolved');
  }
});

test('fee checks query the exact immutable message and enforce the actual quoted fee', async () => {
  const f = await syntheticFixture();
  const rpc = new ScriptedRpc({ getGenesisHash: genesis, getFeeForMessage: { value: 10000 }, getBalance: { value: 10000 } });
  assert.deepEqual(await rpc.checkFee(f.payment), { feeLamports: '10000' });
  assert.deepEqual(rpc.calls.find(value => value.method === 'getFeeForMessage')?.params, [f.payment.messageBase64, { commitment: 'confirmed' }]);
  rpc.replies.getBalance = { value: 9999 }; await assert.rejects(rpc.checkFee(f.payment), { code: 'INSUFFICIENT_SOL' });
  rpc.replies.getFeeForMessage = { value: null }; await assert.rejects(rpc.checkFee(f.payment), { code: 'FEE_UNAVAILABLE' });
});

test('an unrelated incomplete-transaction simulation failure is inconclusive', async () => {
  const rpc = new ScriptedRpc({ getGenesisHash: genesis, simulateTransaction: { value: { err: 'BlockhashNotFound' } } });
  assert.deepEqual(await rpc.simulateIncomplete(''), { kind: 'inconclusive', reason: 'simulation_did_not_prove_signature_refusal' });
});

test('the observed live SignatureFailure value is explicit first-signature refusal', async () => {
  const rpc = new ScriptedRpc({ getGenesisHash: genesis, simulateTransaction: { value: { err: 'SignatureFailure' } } });
  assert.deepEqual(await rpc.simulateIncomplete(''), { kind: 'signature_refused' });
});
