import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Coordinator } from '../src/coordinator.js';
import { toBase64 } from '../src/payment.js';
import { FakeRpc, syntheticFixture } from './fixtures.js';

test('a transient pre-dispatch observation failure remains sendable after recovery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onetab-proof-'));
  const rpc = new FakeRpc();
  const proof = new Coordinator({ stateFile: join(directory, 'proof.sqlite'), rpc });
  try {
    const f = await syntheticFixture();
    await proof.initialize(f.payment);
    await proof.upload(0, await f.approval(0));
    await proof.upload(1, await f.approval(1));
    const observe = rpc.observe.bind(rpc);
    rpc.observe = async () => { throw new Error('Synthetic transient network failure'); };
    await proof.refresh();
    assert.equal(rpc.sends.length, 0);
    rpc.observe = observe;
    await proof.submit();
    assert.equal(rpc.sends.length, 1);
  } finally { proof.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('first approval cannot send, concurrent and duplicate uploads preserve both approvals across close and reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onetab-proof-'));
  const stateFile = join(directory, 'proof.sqlite');
  const rpc = new FakeRpc();
  let proof = new Coordinator({ stateFile, rpc });
  const peer = new Coordinator({ stateFile, rpc });
  try {
    const f = await syntheticFixture();
    await proof.initialize(f.payment);
    const first = await f.approval(0); const second = await f.approval(1);
    await proof.upload(0, first);
    await assert.rejects(proof.submit());
    assert.equal(rpc.sends.length, 0);
    assert.deepEqual(await proof.simulateFirstSignature(), { kind: 'signature_refused' });
    await Promise.all([proof.upload(0, first), peer.upload(1, second), proof.upload(1, second)]);
    assert.deepEqual(proof.view().kind === 'experiment' ? proof.view().approvedSlots?.map(value => value.slot) : [], [0, 1]);
    const before = proof.view();
    proof.close(); proof = new Coordinator({ stateFile, rpc });
    assert.deepEqual(proof.view(), before);
    await Promise.all([proof.submit(), peer.submit(), proof.submit(), peer.submit()]);
    assert.equal(rpc.sends.length, 1);
    const reference = rpc.sends[0]?.reference;
    assert.ok(reference);
    assert.ok(rpc.observations.every(value => value === reference));
    await proof.submit();
    assert.equal(rpc.sends.length, 1);
    assert.equal(proof.view().transactionReference, reference);
    const report = JSON.stringify(proof.view());
    for (const secret of [first.signatureBase64, second.signatureBase64, rpc.sends[0]?.signedBase64, ...proof.privateInvitations().map(value => value.capability)]) {
      if (!secret) throw new Error('Expected private marker');
      assert.equal(report.includes(secret), false);
    }
  } finally { proof.close(); peer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('truly concurrent distinct payer uploads on separate SQLite connections remain complete', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onetab-proof-'));
  const stateFile = join(directory, 'proof.sqlite'); const rpc = new FakeRpc();
  const proof = new Coordinator({ stateFile, rpc }); const peer = new Coordinator({ stateFile, rpc });
  try {
    const f = await syntheticFixture(); await proof.initialize(f.payment);
    const [first, second] = await Promise.all([f.approval(0), f.approval(1)]);
    await Promise.all([proof.upload(0, first), peer.upload(1, second)]);
    const view = proof.view(); assert.equal(view.kind, 'experiment');
    if (view.kind !== 'experiment') throw new Error('Expected experiment');
    assert.deepEqual(view.approvedSlots.map(value => value.slot), [0, 1]); assert.equal(view.state, 'ready');
  } finally { proof.close(); peer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('invalid signatures, stale hashes, wrong roles and expired messages cannot collect or dispatch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onetab-proof-')); const rpc = new FakeRpc();
  const proof = new Coordinator({ stateFile: join(directory, 'proof.sqlite'), rpc });
  try {
    const f = await syntheticFixture(); await proof.initialize(f.payment);
    const first = await f.approval(0);
    await assert.rejects(proof.upload(1, first));
    await assert.rejects(proof.upload(0, { ...first, signatureBase64: toBase64(new Uint8Array(64)) }));
    await assert.rejects(proof.upload(0, { ...first, messageHash: '0'.repeat(64) }));
    assert.throws(() => proof.role('x'.repeat(43)));
    rpc.currentHeight = 101n;
    await assert.rejects(proof.signingPayload());
    await assert.rejects(proof.upload(0, first));
    await assert.rejects(proof.submit());
    assert.equal(rpc.sends.length, 0);
    const view = proof.view(); if (view.kind !== 'experiment') throw new Error();
    assert.equal(view.state, 'unresolved'); assert.equal(view.approvedSlots.length, 0);
  } finally { proof.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('decline stops collection and submission while preserving issued authorization records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onetab-proof-')); const rpc = new FakeRpc();
  const proof = new Coordinator({ stateFile: join(directory, 'proof.sqlite'), rpc });
  try {
    const f = await syntheticFixture(); await proof.initialize(f.payment);
    const first = await f.approval(0); await proof.upload(0, first);
    proof.decline(); await proof.upload(0, first);
    await assert.rejects(proof.upload(1, await f.approval(1)));
    await assert.rejects(proof.submit()); assert.equal(rpc.sends.length, 0);
    const view = proof.view(); if (view.kind !== 'experiment') throw new Error();
    assert.equal(view.state, 'declined'); assert.deepEqual(view.approvedSlots.map(value => value.slot), [0]);
  } finally { proof.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('lost send response reconciles the stored reference and terminal outcomes cannot regress', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onetab-proof-')); const rpc = new FakeRpc();
  const proof = new Coordinator({ stateFile: join(directory, 'proof.sqlite'), rpc });
  try {
    const f = await syntheticFixture(); await proof.initialize(f.payment);
    await proof.upload(0, await f.approval(0)); await proof.upload(1, await f.approval(1));
    rpc.sendError = true; await proof.submit(); assert.equal(rpc.sends.length, 1);
    const submission = rpc.sends[0]; if (!submission) throw new Error();
    rpc.observation = { kind: 'finalized', receipt: {
      reference: submission.reference, explorerUrl: `https://explorer.solana.com/tx/${submission.reference}?cluster=devnet`,
      confirmationStatus: 'finalized', slot: 123, sellerWallet: f.plan.sellerWallet,
      sellerIncrease: '4000001', payerDecreases: ['2000001', '2000000'], feeLamports: '10000', observedAt: new Date().toISOString(),
    } };
    await proof.refresh();
    const finalized = proof.view(); if (finalized.kind !== 'experiment') throw new Error();
    assert.equal(finalized.state, 'finalized'); assert.equal(finalized.receipt?.reference, submission.reference);
    rpc.observation = { kind: 'unresolved', reason: 'synthetic_late_unknown' };
    rpc.height = async () => { throw new Error('Synthetic offline RPC'); };
    await proof.submit(); assert.deepEqual(proof.view(), finalized); assert.equal(rpc.sends.length, 1);
  } finally { proof.close(); rmSync(directory, { recursive: true, force: true }); }
});

for (const field of ['frozen', 'signature', 'submission']) {
  test(`reopening refuses corrupted private ${field} data before send`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'onetab-proof-')); const rpc = new FakeRpc();
    const stateFile = join(directory, 'proof.sqlite'); let proof = new Coordinator({ stateFile, rpc });
    try {
      const f = await syntheticFixture(); await proof.initialize(f.payment);
      await proof.upload(0, await f.approval(0)); await proof.upload(1, await f.approval(1)); proof.close();
      const db = new DatabaseSync(stateFile);
      if (field === 'frozen') {
        db.exec('DROP TRIGGER immutable_experiment');
        db.prepare('UPDATE experiment SET frozen=?').run(JSON.stringify({ ...f.payment, messageHash: '0'.repeat(64) }));
      } else if (field === 'signature') {
        db.exec('DROP TRIGGER immutable_approval');
        db.prepare('UPDATE approvals SET body=? WHERE slot=0').run(JSON.stringify({ ...(await f.approval(0)), signatureBase64: toBase64(new Uint8Array(64)) }));
      } else {
        db.exec('DROP TRIGGER immutable_submission'); db.prepare('UPDATE submission SET hash=?').run('0'.repeat(64));
      }
      db.close(); proof = new Coordinator({ stateFile, rpc });
      await assert.rejects(proof.submit()); assert.equal(rpc.sends.length, 0);
    } finally { proof.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}
