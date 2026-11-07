import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Coordinator } from '../src/coordinator.js';
import { prepareExperiment } from '../src/setup.js';
import { FakeRpc, syntheticFixture } from './fixtures.js';

async function killAt(stateFile: string, fixtureFile: string, boundary: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./crash-child.ts', import.meta.url)), stateFile, fixtureFile, boundary], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', data => { stderr += String(data); });
  const outcome = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(outcome.signal, 'SIGKILL', stderr); assert.equal(outcome.code, null);
}

for (const boundary of ['before_submission_commit', 'after_submission_commit', 'after_dispatch_claim', 'after_send']) {
  test(`real SQLite recovery after child-process SIGKILL at ${boundary}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'onetab-crash-')); const stateFile = join(directory, 'proof.sqlite');
    const rpc = new FakeRpc(); let proof = new Coordinator({ stateFile, rpc });
    try {
      const f = await syntheticFixture(); await proof.initialize(f.payment);
      await proof.upload(0, await f.approval(0)); const second = await f.approval(1);
      if (boundary === 'after_dispatch_claim' || boundary === 'after_send') await proof.upload(1, second);
      const fixtureFile = join(directory, 'synthetic-fixture.json');
      writeFileSync(fixtureFile, JSON.stringify({ payment: f.payment, second }), { mode: 0o600 }); proof.close();
      await killAt(stateFile, fixtureFile, boundary);
      proof = new Coordinator({ stateFile, rpc });
      const recovered = proof.view(); if (recovered.kind !== 'experiment') throw new Error();
      assert.equal(recovered.messageHash, f.payment.messageHash);
      if (boundary === 'before_submission_commit') {
        assert.deepEqual(recovered.approvedSlots.map(value => value.slot), [0]); assert.equal(recovered.transactionReference, null);
        assert.equal(existsSync(`${stateFile}.sends`), false); await proof.upload(1, second); await proof.submit();
        assert.equal(rpc.sends.length, 1);
      } else {
        assert.deepEqual(recovered.approvedSlots.map(value => value.slot), [0, 1]); assert.ok(recovered.transactionReference);
        await proof.submit();
        assert.equal(rpc.sends.length, boundary === 'after_submission_commit' ? 1 : 0);
        assert.equal(proof.view().transactionReference, recovered.transactionReference);
        if (boundary === 'after_send') {
          const sends = readFileSync(`${stateFile}.sends`, 'utf8').trim().split('\n'); assert.equal(sends.length, 1);
          assert.equal(z.object({ reference: z.string() }).parse(JSON.parse(sends[0] ?? '')).reference, recovered.transactionReference);
        } else assert.equal(existsSync(`${stateFile}.sends`), false);
      }
      assert.equal(statSync(stateFile).mode & 0o777, 0o600);
    } finally { proof.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

test('interrupted invitation export reopens SQLite and re-exports the same private tokens and message', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onetab-crash-')); const stateFile = join(directory, 'proof.sqlite');
  const fixtureFile = join(directory, 'synthetic-fixture.json'); const f = await syntheticFixture();
  writeFileSync(fixtureFile, JSON.stringify({ payment: f.payment, second: await f.approval(1) }), { mode: 0o600 });
  await killAt(stateFile, fixtureFile, 'after_initialize');
  const rpc = new FakeRpc(); const proof = new Coordinator({ stateFile, rpc });
  try {
    const before = proof.view(); assert.equal(existsSync(`${stateFile}.invitations.json`), false);
    const roles = proof.privateInvitations();
    await prepareExperiment({ proof, rpc, stateFile, plan: f.plan, port: 4317 });
    assert.deepEqual(proof.view(), before); assert.deepEqual(proof.privateInvitations(), roles);
    const invitations = z.array(z.object({ slot: z.number(), url: z.string() })).parse(JSON.parse(readFileSync(`${stateFile}.invitations.json`, 'utf8')));
    for (const invitation of invitations) {
      const invite = z.object({ capability: z.string(), messageHash: z.string() }).parse(JSON.parse(new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('invite') ?? ''));
      assert.equal(proof.role(invite.capability), invitation.slot);
      assert.equal(invite.messageHash, proof.payment().messageHash);
    }
    assert.equal(statSync(`${stateFile}.invitations.json`).mode & 0o777, 0o600);
  } finally { proof.close(); rmSync(directory, { recursive: true, force: true }); }
});
