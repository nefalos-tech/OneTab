import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Coordinator } from '../src/coordinator.js';
import { startServer } from '../src/server.js';
import { FakeRpc, syntheticFixture } from './fixtures.js';

test('loopback HTTP boundaries isolate roles and exclude private authorization from public responses and bundle', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onetab-http-')); const rpc = new FakeRpc();
  const proof = new Coordinator({ stateFile: join(directory, 'proof.sqlite'), rpc });
  const port = 45000 + Math.floor(Math.random() * 10000); const origin = `http://127.0.0.1:${port}`;
  const server = startServer({ proof, port, distDirectory: resolve('dist') });
  try {
    await once(server, 'listening');
    const untouched = await fetch(`${origin}/api/view`); assert.deepEqual(await untouched.json(), { kind: 'unprepared' });
    assert.equal((await fetch(origin)).status, 200);
    const f = await syntheticFixture(); const roles = await proof.initialize(f.payment);
    const firstRole = roles.find(value => value.slot === 0); const secondRole = roles.find(value => value.slot === 1);
    if (!firstRole || !secondRole) throw new Error();
    const request = (path: string, slot = 0, body: unknown = {}, requestOrigin = origin) => fetch(`${origin}/api/${path}`, {
      method: 'POST', headers: { origin: requestOrigin, authorization: `Bearer ${slot === 0 ? firstRole.capability : secondRole.capability}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal((await fetch(`${origin}/api/submit`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await request('submit', 0, {}, 'https://foreign.invalid')).status, 403);
    assert.equal((await request('submit', 1)).status, 403);
    assert.equal((await fetch(`${origin}/.private/proof.sqlite`)).status, 401);
    assert.equal((await fetch(`${origin}/src/cli.ts`)).status, 401);
    const payload = await fetch(`${origin}/api/payload`, { headers: { authorization: `Bearer ${firstRole.capability}` } });
    assert.equal(payload.status, 200); assert.equal((await payload.json()).transactionBase64, f.payment.transactionBase64);
    const first = await f.approval(0); const second = await f.approval(1);
    const uploads = await Promise.all([request('approval', 0, first), request('approval', 1, second), request('approval', 0, first)]);
    assert.ok(uploads.every(response => response.status === 200));
    const submissions = await Promise.all([request('submit'), request('submit'), request('submit')]);
    assert.ok(submissions.every(response => response.status === 200)); assert.equal(rpc.sends.length, 1);
    const response = await fetch(`${origin}/api/view`); assert.equal(response.headers.get('cache-control'), 'no-store');
    const publicText = await response.text();
    const assetText = readdirSync('dist/assets').filter(file => file.endsWith('.js')).map(file => readFileSync(join('dist/assets', file), 'utf8')).join('');
    for (const privateValue of [firstRole.capability, secondRole.capability, first.signatureBase64, second.signatureBase64, rpc.sends[0]?.signedBase64]) {
      if (!privateValue) throw new Error(); assert.equal(publicText.includes(privateValue), false); assert.equal(assetText.includes(privateValue), false);
    }
    assert.equal(assetText.includes('node:sqlite'), false); assert.equal(assetText.includes('SOLANA_RPC_URL'), false);
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    proof.close(); rmSync(directory, { recursive: true, force: true });
  }
});
