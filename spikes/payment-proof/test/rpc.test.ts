import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevnetRpc, RpcRejected } from '../src/rpc.js';
import { blockhash, getAddressDecoder, getCompiledTransactionMessageDecoder, type ReadonlyUint8Array } from '@solana/kit';
import { AccountState, getMintEncoder, getTokenEncoder, TOKEN_PROGRAM_ADDRESS, type TokenArgs } from '@solana-program/token';
import { buildPaymentMessage, createPaymentPlan, type PaymentPlan } from '../../../src/lib/payments/payment-core.js';
import { assembleSubmission, fromBase64, toBase64 } from '../src/payment.js';
import { syntheticFixture } from './fixtures.js';

class ScriptedRpc extends DevnetRpc {
  calls: { method: string; params: readonly unknown[] }[] = [];
  constructor(readonly replies: Record<string, unknown>, readonly accounts = new Map<string, unknown>()) { super('https://invalid.test'); }
  override async call(method: string, params: readonly unknown[] = []): Promise<unknown> {
    this.calls.push({ method, params });
    const reply = method === 'getAccountInfo' ? this.accounts.get(String(params[0])) ?? { value: null } : this.replies[method];
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

const fixedAddress = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));

function encodedAccount(data: ReadonlyUint8Array) {
  return { value: { owner: TOKEN_PROGRAM_ADDRESS, executable: false, data: [toBase64(data), 'base64'] } };
}

function tokenData(plan: PaymentPlan, wallet: TokenArgs['owner'], amount: bigint, patch: Partial<TokenArgs> = {}) {
  return getTokenEncoder().encode({
    mint: plan.mint, owner: wallet, amount, delegate: null, state: AccountState.Initialized,
    isNative: null, delegatedAmount: 0n, closeAuthority: null, ...patch,
  });
}

function preparedCoreFixture() {
  const plan = createPaymentPlan({
    totalUnits: 10n, sellerWallet: fixedAddress(7), sellerTokenAccount: fixedAddress(8), payers: [
      { wallet: fixedAddress(1), sourceTokenAccount: fixedAddress(4) },
      { wallet: fixedAddress(2), sourceTokenAccount: fixedAddress(5) },
      { wallet: fixedAddress(3), sourceTokenAccount: fixedAddress(6) },
    ],
  });
  const mintData = getMintEncoder().encode({ mintAuthority: null, supply: 100n, decimals: 6, isInitialized: true, freezeAuthority: null });
  const tokens = [
    ...plan.contributions.map(payer => ({ token: payer.sourceTokenAccount, wallet: payer.wallet, units: payer.units })),
    { token: plan.sellerTokenAccount, wallet: plan.sellerWallet, units: 0n },
  ];
  const accounts = new Map<string, unknown>([[plan.mint, encodedAccount(mintData)]]);
  for (const token of tokens) accounts.set(token.token, encodedAccount(tokenData(plan, token.wallet, token.units)));
  const rpc = new ScriptedRpc({
    getGenesisHash: genesis, getBalance: { value: 1 }, getFeeForMessage: { value: 15000 },
    getLatestBlockhash: { value: { blockhash: fixedAddress(20), lastValidBlockHeight: 100 } },
  }, accounts);
  return { plan, rpc, accounts, mintData, tokens };
}

test('three-payer preparation reads the exact configured mint, every source and the seller without signing or sending', async () => {
  const f = preparedCoreFixture();
  assert.deepEqual(await f.rpc.prepare(f.plan), { blockhash: fixedAddress(20), lastValidBlockHeight: '100' });
  assert.deepEqual(f.rpc.calls.map(call => call.method), [
    'getGenesisHash', 'getAccountInfo', 'getAccountInfo', 'getAccountInfo', 'getAccountInfo', 'getAccountInfo', 'getBalance', 'getLatestBlockhash',
  ]);
  assert.deepEqual(f.rpc.calls.filter(call => call.method === 'getAccountInfo').map(call => call.params),
    [f.plan.mint, ...f.tokens.map(token => token.token)].map(key => [key, { encoding: 'base64', commitment: 'confirmed' }]));
  assert.deepEqual(f.rpc.calls.find(call => call.method === 'getBalance')?.params, [f.plan.feePayer, { commitment: 'confirmed' }]);
  assert.deepEqual(f.plan.contributions.map(payer => payer.units), [4n, 3n, 3n]);
});

test('read-only preparation rejects wrong network before any account or fee read', async () => {
  const f = preparedCoreFixture();
  f.rpc.replies.getGenesisHash = 'mainnet-or-unrecognized-genesis';
  await assert.rejects(f.rpc.prepare(f.plan), { code: 'WRONG_NETWORK' });
  await assert.rejects(f.rpc.checkFee({ plan: f.plan, messageBase64: 'unused' }), { code: 'WRONG_NETWORK' });
  assert.deepEqual(f.rpc.calls.map(call => call.method), ['getGenesisHash', 'getGenesisHash']);
});

test('read-only preparation rejects missing, wrong-owner, executable, wrong-decimal and uninitialized mint accounts', async () => {
  const f = preparedCoreFixture();
  const valid = encodedAccount(f.mintData);
  const wrongDecimals = Uint8Array.from(f.mintData); wrongDecimals[44] = 9;
  const uninitialized = Uint8Array.from(f.mintData); uninitialized[45] = 0;
  for (const account of [
    { value: null }, { value: { ...valid.value, owner: fixedAddress(90) } },
    { value: { ...valid.value, executable: true } }, encodedAccount(wrongDecimals),
    encodedAccount(uninitialized), encodedAccount(f.mintData.slice(0, -1)),
  ]) {
    f.accounts.set(f.plan.mint, account);
    await assert.rejects(f.rpc.prepare(f.plan), { code: 'MINT_INVALID' });
  }
});

test('all three sources and the seller reject missing accounts, wrong owners, mint, wallet and unsupported token states', async () => {
  const f = preparedCoreFixture();
  for (const token of f.tokens) {
    const data = tokenData(f.plan, token.wallet, token.units);
    const valid = encodedAccount(data);
    f.accounts.set(token.token, { value: null });
    await assert.rejects(f.rpc.prepare(f.plan), { code: 'TOKEN_ACCOUNT_MISSING' });
    const states = [AccountState.Uninitialized, AccountState.Frozen];
    const unsupported = [
      { value: { ...valid.value, owner: fixedAddress(90) } },
      { value: { ...valid.value, executable: true } }, encodedAccount(data.slice(0, -1)),
      encodedAccount(tokenData(f.plan, token.wallet, token.units, { mint: fixedAddress(90) })),
      encodedAccount(tokenData(f.plan, token.wallet, token.units, { owner: fixedAddress(90) })),
      encodedAccount(tokenData(f.plan, token.wallet, token.units, { delegate: fixedAddress(90), delegatedAmount: 1n })),
      encodedAccount(tokenData(f.plan, token.wallet, token.units, { isNative: 1n })),
      encodedAccount(tokenData(f.plan, token.wallet, token.units, { closeAuthority: fixedAddress(90) })),
      ...states.map(state => encodedAccount(tokenData(f.plan, token.wallet, token.units, { state }))),
    ];
    for (const [offset, value] of [[72, 2], [108, 3], [109, 2], [129, 2]]) {
      if (offset === undefined || value === undefined) throw new Error('Expected malformed field fixture');
      const malformed = Uint8Array.from(data); malformed[offset] = value;
      unsupported.push(encodedAccount(malformed));
    }
    for (const account of unsupported) {
      f.accounts.set(token.token, account);
      await assert.rejects(f.rpc.prepare(f.plan), { code: 'TOKEN_ACCOUNT_INVALID' });
    }
    f.accounts.set(token.token, valid);
  }
});

test('malformed RPC account envelopes and binary encodings fail closed for mint and every token account', async () => {
  const f = preparedCoreFixture();
  for (const key of [f.plan.mint, ...f.tokens.map(token => token.token)]) {
    const valid = f.accounts.get(key);
    for (const account of [
      {}, { value: {} }, { value: { owner: TOKEN_PROGRAM_ADDRESS, executable: false, data: ['!!!!', 'base64'] } },
      { value: { owner: TOKEN_PROGRAM_ADDRESS, executable: false, data: ['AB==', 'base64'] } },
      { value: { owner: TOKEN_PROGRAM_ADDRESS, executable: false, data: ['', 'jsonParsed'] } },
      { value: { owner: TOKEN_PROGRAM_ADDRESS, executable: 'false', data: ['', 'base64'] } },
    ]) {
      f.accounts.set(key, account);
      await assert.rejects(f.rpc.prepare(f.plan));
    }
    f.accounts.set(key, valid);
  }
});

test('insufficient USDC in each payer including the third source stops preparation before blockhash selection', async () => {
  const f = preparedCoreFixture();
  for (const payer of f.plan.contributions) {
    const valid = f.accounts.get(payer.sourceTokenAccount);
    f.accounts.set(payer.sourceTokenAccount, encodedAccount(tokenData(f.plan, payer.wallet, payer.units - 1n)));
    await assert.rejects(f.rpc.prepare(f.plan), { code: 'INSUFFICIENT_USDC' });
    assert.equal(f.rpc.calls.some(call => call.method === 'getLatestBlockhash'), false);
    f.accounts.set(payer.sourceTokenAccount, valid);
  }
  f.rpc.replies.getBalance = { value: 0 };
  await assert.rejects(f.rpc.prepare(f.plan), { code: 'INSUFFICIENT_SOL' });
  assert.equal(f.rpc.calls.some(call => call.method === 'getLatestBlockhash'), false);
});

test('three-payer exact-message fee quote requires the exact organizer SOL balance and rejects an unavailable quote', async () => {
  const f = preparedCoreFixture();
  const prepared = await f.rpc.prepare(f.plan);
  const candidate = await buildPaymentMessage(f.plan, {
    blockhash: blockhash(prepared.blockhash), lastValidBlockHeight: BigInt(prepared.lastValidBlockHeight),
  });
  const payment = { plan: f.plan, messageBase64: toBase64(candidate.messageBytes) };
  f.rpc.replies.getBalance = { value: 15000 };
  assert.deepEqual(await f.rpc.checkFee(payment), { feeLamports: '15000' });
  assert.deepEqual(f.rpc.calls.find(call => call.method === 'getFeeForMessage')?.params,
    [payment.messageBase64, { commitment: 'confirmed' }]);
  assert.deepEqual(f.rpc.calls.filter(call => call.method === 'getBalance').map(call => call.params),
    [[f.plan.feePayer, { commitment: 'confirmed' }], [f.plan.feePayer, { commitment: 'confirmed' }]]);
  f.rpc.replies.getBalance = { value: 14999 };
  await assert.rejects(f.rpc.checkFee(payment), { code: 'INSUFFICIENT_SOL' });
  f.rpc.replies.getFeeForMessage = { value: null };
  await assert.rejects(f.rpc.checkFee(payment), { code: 'FEE_UNAVAILABLE' });
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '15000']) {
    f.rpc.replies.getFeeForMessage = { value };
    await assert.rejects(f.rpc.checkFee(payment));
  }
  assert.equal(f.rpc.calls.some(call => ['sendTransaction', 'simulateTransaction'].includes(call.method)), false);
});
