import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const evidence = JSON.parse(readFileSync(new URL('./devnet-20261107.json', import.meta.url), 'utf8'));
const reference = evidence.report.transactionReference;
const queries = [
  ['getGenesisHash', []],
  ['getSignatureStatuses', [[reference], { searchTransactionHistory: true }]],
  ['getTransaction', [reference, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]],
];
const responses = await Promise.all(queries.map(async ([method, params]) => {
  const response = await fetch('https://api.devnet.solana.com', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  assert.equal(response.ok, true, `${method} HTTP failure`);
  const envelope = await response.json();
  assert.equal(envelope.error, undefined, `${method} RPC failure`);
  return envelope.result;
}));
const [genesis, statuses, transaction] = responses;
assert.equal(genesis, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
assert.equal(statuses.value[0]?.confirmationStatus, 'finalized');
assert.equal(statuses.value[0]?.err, null);
assert.equal(transaction?.meta?.err, null);
assert.equal(transaction.slot, evidence.independentChain.slot);
assert.equal(createHash('sha256').update(Buffer.from(transaction.transaction[0], 'base64')).digest('hex'), evidence.durableBeforeRestart.signedHash);
assert.equal(transaction.meta.fee, 10_000);
assert.deepEqual(transaction.meta.preTokenBalances, evidence.independentChain.preTokenBalances);
assert.deepEqual(transaction.meta.postTokenBalances, evidence.independentChain.postTokenBalances);
assert.deepEqual(transaction.meta.preBalances, evidence.independentChain.preLamports);
assert.deepEqual(transaction.meta.postBalances, evidence.independentChain.postLamports);
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), reference, slot: transaction.slot, confirmationStatus: 'finalized', signedWireMatches: true, historicalBalancesMatch: true, feeLamports: transaction.meta.fee }, null, 2));
