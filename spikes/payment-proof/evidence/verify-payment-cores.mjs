import assert, { AssertionError } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { buildPaymentMessage, createPaymentPlan, equalBytes, inspectPaymentMessage } from '../../../src/lib/payments/payment-core.ts';
import { assembleSignedPayment, verifyPayerSignature } from '../../../src/lib/payments/signature-core.ts';
import { inspectFinalizedPayment, parseSignatureStatus } from '../src/chain-inspection.ts';

const rpc = 'https://api.devnet.solana.com';
const expected = Object.freeze({
  reference: '55uWRbS4rUHdxLTr87h3S9JJdMoHDRAjj8gxh8b6FFQCo8idbTU8ypFt23jJhR9dmVjtvupY68ytso5AJFJDn2Ve',
  planHash: 'e3cd1706e2252f8aaf228ac93497f28937432443bf915572b512ab626225ac1b',
  messageHash: 'e3acd08148f63fe3889c454b996a65d6084ae7cafb2d66efebf8f8daaf429c83',
  signedWireHash: 'e50344171cc051df1470fc37278f3f8deaca04f03bbe0377e7988a2d1aea9ad4',
  genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  slot: 519612865,
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();

async function verify() {
  const evidence = JSON.parse(readFileSync(new URL('./devnet-20261107.json', import.meta.url), 'utf8'));
  const { report, independentChain } = evidence;
  assert.equal(report.transactionReference, expected.reference, 'Recorded reference changed');
  assert.equal(independentChain.transactionReference, expected.reference, 'Independent reference changed');
  assert.equal(report.planHash, expected.planHash, 'Recorded plan hash changed');
  assert.equal(digest(JSON.stringify(report.plan)), expected.planHash, 'Recorded plan changed');
  assert.equal(report.messageHash, expected.messageHash, 'Recorded message hash changed');
  assert.equal(independentChain.signedWireHash, expected.signedWireHash, 'Recorded signed wire changed');
  assert.equal(evidence.durableBeforeRestart.signedHash, expected.signedWireHash, 'Durable signed wire changed');
  assert.equal(report.state, 'finalized', 'Recorded payment is not finalized');
  assert.equal(independentChain.slot, expected.slot, 'Recorded slot changed');

  const queries = [
    ['getGenesisHash', []],
    ['getSignatureStatuses', [[expected.reference], { searchTransactionHistory: true }]],
    ['getTransaction', [expected.reference, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]],
  ];
  const [genesis, statuses, chain] = await Promise.all(queries.map(async ([method, params], index) => {
    const id = index + 1;
    const response = await fetch(rpc, {
      method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(15_000),
    });
    assert(response.ok, `${method} HTTP failure`);
    const envelope = await response.json();
    assert.equal(envelope.jsonrpc, '2.0', `${method} invalid RPC envelope`);
    assert.equal(envelope.id, id, `${method} RPC response ID mismatch`);
    assert.equal(envelope.error, undefined, `${method} RPC failure`);
    return envelope.result;
  }));
  assert.equal(genesis, expected.genesis, 'Devnet genesis mismatch');
  assert.equal(statuses.value[0]?.confirmationStatus, 'finalized', 'Transaction is not finalized');
  assert.equal(statuses.value[0]?.err, null, 'Finalized status has an execution error');
  assert.equal(statuses.value[0]?.slot, expected.slot, 'Status slot mismatch');
  assert.equal(chain?.meta?.err, null, 'Transaction metadata has an execution error');
  assert.equal(chain?.slot, expected.slot, 'Transaction slot mismatch');
  assert.equal(chain.transaction[1], 'base64', 'Unexpected transaction encoding');
  const signedWire = Buffer.from(chain.transaction[0], 'base64');
  assert(signedWire.toString('base64') === chain.transaction[0], 'Noncanonical transaction base64');
  assert.equal(digest(signedWire), expected.signedWireHash, 'Public signed-wire hash mismatch');

  const transaction = getTransactionDecoder().decode(signedWire);
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const plan = createPaymentPlan({
    totalUnits: BigInt(report.plan.total), sellerWallet: report.plan.sellerWallet,
    sellerTokenAccount: report.plan.sellerTokenAccount, payers: report.plan.contributions,
  });
  const message = await buildPaymentMessage(plan, {
    blockhash: compiled.lifetimeToken, lastValidBlockHeight: BigInt(report.lastValidBlockHeight),
  });
  assert.equal(message.messageHash, expected.messageHash, 'Rebuilt message hash mismatch');
  assert.equal(digest(transaction.messageBytes), expected.messageHash, 'Chain message hash mismatch');
  assert(equalBytes(message.messageBytes, transaction.messageBytes), 'Rebuilt and chain message bytes differ');
  const inspected = await inspectPaymentMessage(message, {
    plan, blockhash: compiled.lifetimeToken, messageHash: expected.messageHash,
  });

  const target = { plan, message: inspected };
  const signatures = await Promise.all(plan.contributions.map(payer => verifyPayerSignature(target, {
    wallet: payer.wallet, signatureBytes: transaction.signatures[payer.wallet],
  })));
  const assembled = await assembleSignedPayment(target, signatures);
  assert.equal(assembled.reference, expected.reference, 'Assembled reference mismatch');
  assert(equalBytes(assembled.transactionBytes, signedWire), 'Checked assembly differs from public wire');
  assert.equal(digest(assembled.transactionBytes), expected.signedWireHash, 'Assembled signed-wire hash mismatch');

  const status = parseSignatureStatus(statuses);
  assert.deepEqual(status, { kind: 'finalized', executionError: false }, 'P4 status mismatch');
  const result = inspectFinalizedPayment({
    plan, messageBytes: inspected.messageBytes, transactionBytes: assembled.transactionBytes,
    reference: expected.reference,
  }, status, chain);
  assert.deepEqual(result, { kind: 'finalized', evidence: {
    reference: expected.reference, slot: expected.slot, feeLamports: 10_000n,
    sellerIncrease: 4_000_000n, payerDecreases: [2_000_000n, 2_000_000n],
  } }, 'P4 historical settlement mismatch');
  assert.deepEqual(chain.meta.preTokenBalances, independentChain.preTokenBalances, 'Historical token pre-balances differ');
  assert.deepEqual(chain.meta.postTokenBalances, independentChain.postTokenBalances, 'Historical token post-balances differ');
  assert.deepEqual(chain.meta.preBalances, independentChain.preLamports, 'Historical SOL pre-balances differ');
  assert.deepEqual(chain.meta.postBalances, independentChain.postLamports, 'Historical SOL post-balances differ');
  assert.equal(chain.meta.fee, 10_000, 'Historical fee differs');
  assert.equal(report.receipt.slot, result.evidence.slot, 'Recorded receipt slot differs');
  assert.equal(report.receipt.sellerIncrease, String(result.evidence.sellerIncrease), 'Recorded seller receipt differs');
  assert.deepEqual(report.receipt.payerDecreases, result.evidence.payerDecreases.map(String), 'Recorded payer receipt differs');
  assert.equal(report.receipt.feeLamports, String(result.evidence.feeLamports), 'Recorded fee receipt differs');

  console.log(JSON.stringify({
    revision: { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 },
    environment: { node: process.version, network: 'devnet', rpc }, observedAt: new Date().toISOString(),
    scope: 'historical-two-wallet-public-chain-revalidation', ...expected,
    checks: { recordedPins: true, p2Message: true, p3Signatures: signatures.length,
      p3CheckedAssembly: true, p4FinalizedReceipt: true, historicalBalances: true },
    receipt: { slot: result.evidence.slot, feeLamports: String(result.evidence.feeLamports),
      sellerIncrease: String(result.evidence.sellerIncrease), payerDecreases: result.evidence.payerDecreases.map(String) },
  }, null, 2));
}

await verify().catch(error => {
  console.error(JSON.stringify({ observedAt: new Date().toISOString(), passed: false,
    error: error instanceof AssertionError ? error.message.split('\n')[0] : 'Verification could not complete' }));
  process.exitCode = 1;
});
