import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockhash, getAddressDecoder, getBase58Decoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder, getTransactionEncoder, signatureBytes,
} from '@solana/kit';
import {
  buildPaymentMessage, createPaymentPlan, inspectPaymentMessage, type PayerSource,
} from '../src/payment-core.js';
import {
  inspectFinalizedPayment, parseSignatureStatus, type ExpectedSettlement, type SignatureStatus,
} from '../src/chain-inspection.js';
import { toBase64 } from '../src/payment.js';

const key = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));
const finalized = { kind: 'finalized', executionError: false } satisfies SignatureStatus;
const failed = { kind: 'finalized', executionError: true } satisfies SignatureStatus;
const u64Max = (1n << 64n) - 1n;

async function settlementFixture(count: 2 | 3) {
  const keys = await Promise.all([0, 1, 2].map(() => crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])));
  const payers = await Promise.all(keys.map(async (pair, index) => ({
    pair, wallet: getAddressDecoder().decode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    sourceTokenAccount: key(index + 4),
  })));
  payers.sort((left, right) => left.wallet < right.wallet ? 1 : -1);
  const [first, second, third] = payers;
  if (!first || !second || !third) throw new Error('Expected three independent synthetic keys');
  const plan = createPaymentPlan({
    totalUnits: 10n, sellerWallet: key(7), sellerTokenAccount: key(8),
    payers: count === 2 ? [first, second] satisfies [PayerSource, PayerSource]
      : [first, second, third] satisfies [PayerSource, PayerSource, PayerSource],
  });
  const lifetime = { blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
  const candidate = await buildPaymentMessage(plan, lifetime);
  const message = await inspectPaymentMessage(candidate, { plan, blockhash: lifetime.blockhash, messageHash: candidate.messageHash });
  const transaction = getTransactionDecoder().decode(message.transactionBytes);
  const signatures = { ...transaction.signatures };
  for (const payer of payers.slice(0, count)) {
    signatures[payer.wallet] = signatureBytes(new Uint8Array(await crypto.subtle.sign(
      'Ed25519', payer.pair.privateKey, Uint8Array.from(message.messageBytes).buffer,
    )));
  }
  const organizer = signatures[plan.feePayer];
  if (!organizer) throw new Error('Expected organizer signature');
  const signedBytes = Uint8Array.from(getTransactionEncoder().encode({ ...transaction, signatures }));
  const expected: ExpectedSettlement = {
    plan, messageBytes: message.messageBytes, transactionBytes: signedBytes,
    reference: getBase58Decoder().decode(organizer),
  };
  const compiled = getCompiledTransactionMessageDecoder().decode(message.messageBytes);
  if (compiled.version !== 'legacy') throw new Error('Expected legacy payment');
  const accounts = [
    ...plan.contributions.map(payer => ({
      wallet: payer.wallet, token: payer.sourceTokenAccount, before: payer.units, after: 0n,
    })),
    { wallet: plan.sellerWallet, token: plan.sellerTokenAccount, before: 0n, after: plan.totalUnits },
  ];
  const tokenBalances = (stage: 'before' | 'after') => accounts.map(account => ({
    accountIndex: compiled.staticAccounts.indexOf(account.token), mint: plan.mint, owner: account.wallet,
    uiTokenAmount: { decimals: 6, amount: String(account[stage]) },
  }));
  const tx = {
    slot: 123, transaction: [toBase64(signedBytes), 'base64'] satisfies [string, 'base64'],
    meta: {
      err: null, fee: count * 5000,
      preBalances: compiled.staticAccounts.map(() => 1000000),
      postBalances: compiled.staticAccounts.map((_, index) => index === 0 ? 1000000 - count * 5000 : 1000000),
      preTokenBalances: tokenBalances('before'), postTokenBalances: tokenBalances('after'),
    },
  };
  return { expected, tx, compiled };
}

test('status parsing requires one complete explicit error field and leaves earlier commitments pending', () => {
  for (const confirmationStatus of [null, 'processed', 'confirmed']) {
    for (const err of [null, { InstructionError: [1, 'Custom'] }]) {
      assert.deepEqual(parseSignatureStatus({ value: [{ confirmationStatus, err }] }), { kind: 'pending' });
    }
  }
  assert.deepEqual(parseSignatureStatus({ value: [null] }), { kind: 'pending' });
  assert.deepEqual(parseSignatureStatus({ value: [{ confirmationStatus: 'finalized', err: null }] }), finalized);
  assert.deepEqual(parseSignatureStatus({ value: [{ confirmationStatus: 'finalized', err: 'InsufficientFundsForFee' }] }), failed);
  for (const raw of [
    null, undefined, {}, { value: [] }, { value: [null, null] }, { value: {} },
    { value: [{ confirmationStatus: 'finalized' }] }, { value: [{ confirmationStatus: 'finalized', err: undefined }] },
    { value: [{ err: null }] }, { value: [{ confirmationStatus: 'unknown', err: null }] },
  ]) assert.deepEqual(parseSignatureStatus(raw), { kind: 'unavailable' });
});

for (const count of [2, 3] satisfies (2 | 3)[]) {
  test(`complete real synthetic ${count}-payer signatures and exact finalized metadata yield ordered settlement evidence`, async () => {
    const f = await settlementFixture(count);
    const rawBefore = structuredClone(f.tx);
    const bytesBefore = Uint8Array.from(f.expected.transactionBytes);
    const inspection = inspectFinalizedPayment(f.expected, finalized, f.tx);
    assert.deepEqual(inspection, { kind: 'finalized', evidence: {
      reference: f.expected.reference, slot: 123, feeLamports: BigInt(count * 5000), sellerIncrease: 10n,
      payerDecreases: count === 2 ? [5n, 5n] : [4n, 3n, 3n],
    } });
    assert.deepEqual(f.tx, rawBefore);
    assert.deepEqual(f.expected.transactionBytes, bytesBefore);
    assert.equal(JSON.stringify(inspection, (_, value: unknown) => typeof value === 'bigint' ? String(value) : value)
      .includes(f.tx.transaction[0]), false);
    if (count === 3) {
      assert.notDeepEqual(f.expected.plan.contributions.slice(1).map(payer => payer.wallet), f.compiled.staticAccounts.slice(1, 3));
    }
    f.tx.meta.preTokenBalances.reverse();
    f.tx.meta.postTokenBalances.reverse();
    assert.deepEqual(inspectFinalizedPayment(f.expected, finalized, f.tx), inspection);
  });
}

test('stored reference, exact canonical wire, pinned message and every signer slot bind the fetched identity', async () => {
  const f = await settlementFixture(3);
  const decoded = getTransactionDecoder().decode(f.expected.transactionBytes);
  const organizer = f.expected.plan.feePayer;
  const third = f.expected.plan.contributions[2];
  if (!third) throw new Error('Expected three payers');
  const wrongPlan = createPaymentPlan({
    totalUnits: 10n, sellerWallet: f.expected.plan.sellerWallet, sellerTokenAccount: f.expected.plan.sellerTokenAccount,
    payers: [
      f.expected.plan.contributions[0], f.expected.plan.contributions[1],
      { ...third, wallet: key(90) },
    ],
  });
  const zeroSignature = getTransactionEncoder().encode({ ...decoded, signatures: { ...decoded.signatures, [organizer]: null } });
  const versionedMessage = getCompiledTransactionMessageEncoder().encode({ ...f.compiled, version: 0, addressTableLookups: [] });
  const signaturePrefix = f.expected.transactionBytes.slice(0, 1 + 3 * 64);
  const versionedBytes = Uint8Array.of(...signaturePrefix, ...versionedMessage);
  const targets = [
    { ...f.expected, reference: 'unrelated-reference' },
    { ...f.expected, messageBytes: Uint8Array.of(...f.expected.messageBytes, 0) },
    { ...f.expected, plan: wrongPlan },
    { ...f.expected, transactionBytes: zeroSignature },
    { ...f.expected, transactionBytes: Uint8Array.of(...f.expected.transactionBytes, 0) },
    { ...f.expected, transactionBytes: f.expected.transactionBytes.slice(0, -1) },
    { ...f.expected, transactionBytes: Uint8Array.of(255) },
    { ...f.expected, messageBytes: versionedMessage, transactionBytes: versionedBytes },
  ];
  for (const expected of targets) {
    const tx = { ...f.tx, transaction: [toBase64(expected.transactionBytes), 'base64'] };
    assert.deepEqual(inspectFinalizedPayment(expected, finalized, tx), {
      kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch',
    });
  }
  for (const encoded of ['', '!!!!', 'AB==', toBase64(zeroSignature), `${f.tx.transaction[0]}\n`]) {
    assert.deepEqual(inspectFinalizedPayment(f.expected, finalized, { ...f.tx, transaction: [encoded, 'base64'] }), {
      kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch',
    });
  }
});

test('each required signer must carry its own nonzero 64-byte signature in the stored wire', async () => {
  const f = await settlementFixture(3);
  const decoded = getTransactionDecoder().decode(f.expected.transactionBytes);
  for (const payer of f.expected.plan.contributions) {
    const bytes = getTransactionEncoder().encode({ ...decoded, signatures: { ...decoded.signatures, [payer.wallet]: null } });
    assert.deepEqual(inspectFinalizedPayment({ ...f.expected, transactionBytes: bytes }, finalized,
      { ...f.tx, transaction: [toBase64(bytes), 'base64'] }), {
      kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch',
    });
  }
});

test('definitive execution failure requires matching finalized identity, complete metadata and outcome agreement', async () => {
  const f = await settlementFixture(3);
  const error = { InstructionError: [1, 'Custom'] };
  const failedTx = { ...f.tx, meta: { ...f.tx.meta, err: error } };
  assert.deepEqual(inspectFinalizedPayment(f.expected, failed, failedTx), { kind: 'failed', reason: 'finalized_execution_error' });
  const reported = parseSignatureStatus({ value: [{ confirmationStatus: 'finalized', err: 'InsufficientFundsForFee' }] });
  assert.equal(reported.kind, 'finalized');
  if (reported.kind !== 'finalized') throw new Error('Expected finalized status');
  assert.deepEqual(inspectFinalizedPayment(f.expected, reported, failedTx), { kind: 'failed', reason: 'finalized_execution_error' });
  for (const [status, tx] of [[failed, f.tx], [finalized, failedTx]] satisfies [Extract<SignatureStatus, { kind: 'finalized' }>, unknown][]) {
    assert.deepEqual(inspectFinalizedPayment(f.expected, status, tx), {
      kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch',
    });
  }
  assert.deepEqual(inspectFinalizedPayment({ ...f.expected, reference: 'other' }, failed, failedTx), {
    kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch',
  });
  assert.deepEqual(inspectFinalizedPayment(f.expected, failed, { ...failedTx, meta: null }), {
    kind: 'unresolved', reason: 'transaction_identity_or_metadata_mismatch',
  });
  assert.deepEqual(inspectFinalizedPayment(f.expected, failed, null), {
    kind: 'unresolved', reason: 'finalized_metadata_unavailable',
  });
});

test('malformed or partial RPC metadata stays unresolved with an explicit unavailable reason', async () => {
  const f = await settlementFixture(3);
  const missingError = Object.fromEntries(Object.entries(f.tx.meta).filter(([name]) => name !== 'err'));
  const malformed: unknown[] = [
    undefined, {}, { ...f.tx, slot: -1 }, { ...f.tx, transaction: [f.tx.transaction[0], 'jsonParsed'] },
    { ...f.tx, meta: {} }, { ...f.tx, meta: missingError }, { ...f.tx, meta: { ...f.tx.meta, err: undefined } },
  ];
  for (const field of ['slot', 'fee'] satisfies ('slot' | 'fee')[]) {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '123']) {
      malformed.push(field === 'slot' ? { ...f.tx, slot: value } : { ...f.tx, meta: { ...f.tx.meta, fee: value } });
    }
  }
  for (const raw of malformed) {
    assert.deepEqual(inspectFinalizedPayment(f.expected, failed, raw), {
      kind: 'unresolved', reason: 'rpc_observation_unavailable',
    });
  }
});

test('every payer including the third and the seller require unambiguous pre and post token evidence', async () => {
  const f = await settlementFixture(3);
  for (const stage of ['preTokenBalances', 'postTokenBalances'] satisfies ('preTokenBalances' | 'postTokenBalances')[]) {
    for (const [index, balance] of f.tx.meta[stage].entries()) {
      const variants = [
        f.tx.meta[stage].filter((_, candidate) => candidate !== index),
        [...f.tx.meta[stage], balance],
        [...f.tx.meta[stage], { ...balance, owner: key(90), mint: key(91) }],
        [...f.tx.meta[stage], { ...balance, accountIndex: f.compiled.staticAccounts.length }],
      ];
      for (const patch of [
        { accountIndex: 0 }, { accountIndex: f.compiled.staticAccounts.length },
        { mint: key(90) }, { owner: key(91) },
        { uiTokenAmount: { ...balance.uiTokenAmount, decimals: 9 } },
        { uiTokenAmount: { ...balance.uiTokenAmount, amount: String(BigInt(balance.uiTokenAmount.amount) + 1n) } },
      ]) variants.push(f.tx.meta[stage].map((value, candidate) => candidate === index ? { ...value, ...patch } : value));
      for (const balances of variants) {
        assert.deepEqual(inspectFinalizedPayment(f.expected, finalized, {
          ...f.tx, meta: { ...f.tx.meta, [stage]: balances },
        }), { kind: 'unresolved', reason: 'token_balance_evidence_mismatch' }, `${stage} account ${index}`);
      }
    }
  }
});

test('token amount parsing enforces uint64 values and accepts exact deltas at the maximum', async () => {
  const f = await settlementFixture(3);
  for (const stage of ['preTokenBalances', 'postTokenBalances'] satisfies ('preTokenBalances' | 'postTokenBalances')[]) {
    for (const amount of ['', '-1', '1.5', '1e2', 'NaN', String(u64Max + 1n)]) {
      const tx = structuredClone(f.tx);
      const third = tx.meta[stage][2];
      if (!third) throw new Error('Expected third payer evidence');
      third.uiTokenAmount.amount = amount;
      assert.deepEqual(inspectFinalizedPayment(f.expected, finalized, tx), {
        kind: 'unresolved', reason: 'rpc_observation_unavailable',
      });
    }
  }
  for (const [index, payer] of f.expected.plan.contributions.entries()) {
    const before = f.tx.meta.preTokenBalances[index];
    const after = f.tx.meta.postTokenBalances[index];
    if (!before || !after) throw new Error('Expected payer evidence');
    before.uiTokenAmount.amount = String(u64Max);
    after.uiTokenAmount.amount = String(u64Max - payer.units);
  }
  const sellerBefore = f.tx.meta.preTokenBalances[3];
  const sellerAfter = f.tx.meta.postTokenBalances[3];
  if (!sellerBefore || !sellerAfter) throw new Error('Expected seller evidence');
  sellerBefore.uiTokenAmount.amount = String(u64Max - f.expected.plan.totalUnits);
  sellerAfter.uiTokenAmount.amount = String(u64Max);
  assert.equal(inspectFinalizedPayment(f.expected, finalized, f.tx).kind, 'finalized');
});

test('SOL evidence covers every compiled account and only the organizer loses the exact fee', async () => {
  const f = await settlementFixture(3);
  const third = f.expected.plan.contributions[2];
  if (!third) throw new Error('Expected three payers');
  const thirdIndex = f.compiled.staticAccounts.indexOf(third.wallet);
  for (const stage of ['preBalances', 'postBalances'] satisfies ('preBalances' | 'postBalances')[]) {
    for (const balances of [[], [f.tx.meta[stage][0]], f.tx.meta[stage].slice(0, -1), [...f.tx.meta[stage], 1000000]]) {
      assert.deepEqual(inspectFinalizedPayment(f.expected, finalized, { ...f.tx, meta: { ...f.tx.meta, [stage]: balances } }), {
        kind: 'unresolved', reason: 'fee_balance_evidence_mismatch',
      });
    }
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const balances = f.tx.meta[stage].map((balance, index) => index === thirdIndex ? value : balance);
      assert.deepEqual(inspectFinalizedPayment(f.expected, finalized, { ...f.tx, meta: { ...f.tx.meta, [stage]: balances } }), {
        kind: 'unresolved', reason: 'rpc_observation_unavailable',
      });
    }
  }
  for (const [index, balance] of f.tx.meta.postBalances.entries()) {
    const postBalances = f.tx.meta.postBalances.map((value, candidate) => candidate === index ? balance - 1 : value);
    assert.deepEqual(inspectFinalizedPayment(f.expected, finalized, { ...f.tx, meta: { ...f.tx.meta, postBalances } }), {
      kind: 'unresolved', reason: 'fee_balance_evidence_mismatch',
    });
  }
  assert.ok(thirdIndex > 0);
  assert.deepEqual(inspectFinalizedPayment(f.expected, finalized, {
    ...f.tx, meta: { ...f.tx.meta, fee: f.tx.meta.fee - 1 },
  }), { kind: 'unresolved', reason: 'fee_balance_evidence_mismatch' });
});
