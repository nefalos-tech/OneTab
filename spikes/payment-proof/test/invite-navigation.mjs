import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { syntheticFixture } from './fixtures.ts';

const { values } = parseArgs({ options: { 'playwright-module': { type: 'string' }, 'browser-executable': { type: 'string' } } });
assert.ok(values['playwright-module'], 'Pass --playwright-module with an existing Playwright index.mjs path');
const { chromium } = await import(pathToFileURL(resolve(values['playwright-module'])).href);
const fixture = await syntheticFixture();
const invitations = [0, 1].map(slot => ({
  id: fixture.payment.id, slot, capability: (slot ? 'B' : 'A').repeat(43),
  plan: fixture.plan, planHash: fixture.payment.planHash, messageHash: fixture.payment.messageHash,
}));
const view = { kind: 'experiment', id: fixture.payment.id, planHash: fixture.payment.planHash,
  messageHash: fixture.payment.messageHash, state: 'collecting', approvedSlots: [] };
const signed = await Promise.all([0, 1].map(slot => fixture.walletReturn(slot)));
const assets = new Map();
for (const entry of readdirSync('dist', { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const absolute = resolve(entry.parentPath, entry.name);
  const path = `/${relative(resolve('dist'), absolute).split('\\').join('/')}`;
  assets.set(path === '/index.html' ? '/' : path, readFileSync(absolute));
}
const requests = [];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path.startsWith('/api/')) {
    const role = invitations.find(invite => request.headers.authorization === `Bearer ${invite.capability}`)?.slot ?? null;
    requests.push({ path, role });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(path === '/api/payload' ? fixture.payment : view));
    return;
  }
  const asset = assets.get(path);
  response.writeHead(asset ? 200 : 404, { 'content-type': path.endsWith('.js') ? 'text/javascript'
    : path.endsWith('.css') ? 'text/css' : 'text/html' });
  response.end(asset);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true,
  ...(values['browser-executable'] ? { executablePath: values['browser-executable'] } : {}) });
const key = 'onetab-p1-invitation';
const inviteUrl = slot => `${origin}/#invite=${encodeURIComponent(JSON.stringify(invitations[slot]))}`;
const mutations = () => requests.filter(request => request.path !== '/api/view' && request.path !== '/api/payload');
let failed = 0;

async function scenario(name, operation) {
  const context = await browser.newContext();
  await context.addInitScript(({ wallets, publicKeys, signedTransactions }) => {
    const accounts = wallets.map((wallet, slot) => ({ address: wallet, publicKey: Uint8Array.from(publicKeys[slot]),
      chains: ['solana:devnet'], features: ['solana:signTransaction'] }));
    const wallet = { version: '1.0.0', name: 'Synthetic invitation regression wallet',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', chains: ['solana:devnet'], accounts,
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts }) },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'],
          signTransaction: async ({ account }) => {
            sessionStorage.setItem('synthetic-sign-count', String(Number(sessionStorage.getItem('synthetic-sign-count')) + 1));
            if (window.holdSyntheticSign) await new Promise((resolveSign, rejectSign) => {
              window.completeSyntheticSign = reject => reject ? rejectSign({ code: 4001 }) : resolveSign();
            });
            return [{ signedTransaction: Uint8Array.from(signedTransactions[accounts.indexOf(account)]) }];
          } },
      } };
    window.addEventListener('wallet-standard:app-ready', event => event.detail.register(wallet));
  }, { wallets: fixture.plan.contributions.map(payer => payer.wallet),
    publicKeys: [0, 1].map(slot => [...fixture.publicKey(slot)]), signedTransactions: signed.map(bytes => [...bytes]) });
  const page = await context.newPage();
  requests.length = 0;
  try {
    await operation(page);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}

async function loaded(page, slot) {
  await page.waitForFunction(({ key, slot }) => location.hash === ''
    && JSON.parse(sessionStorage.getItem(key) ?? 'null')?.slot === slot
    && document.querySelector('#payment').textContent.includes('collecting'), { key, slot }, { timeout: 3000 });
}
async function connected(page, slot) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.waitForFunction(account => document.querySelector('#inventory').textContent.includes(account), fixture.plan.contributions[slot].wallet);
  await page.waitForFunction(() => !document.querySelector('#approve').disabled);
}
async function signedOnce(page, slot) {
  await page.getByRole('button', { name: 'Approve my contribution', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Independent sign-only approval verified' }).waitFor();
  assert.deepEqual(mutations(), [{ path: '/api/approval', role: slot }]);
}

try {
  await scenario('fresh invitation removes the fragment and signs only its payer slot', async page => {
    await page.goto(inviteUrl(0)); await loaded(page, 0);
    assert.equal(mutations().length, 0);
    assert.deepEqual(requests, [{ path: '/api/view', role: 0 }]);
    await connected(page, 0); await signedOnce(page, 0);
  });
  await scenario('same-document invitation from the inspection page loads the new role', async page => {
    await page.goto(origin); await page.locator('#payment').filter({ hasText: 'collecting' }).waitFor();
    await page.goto(inviteUrl(1)); await loaded(page, 1);
    assert.equal(mutations().length, 0);
    assert.equal(await page.evaluate(() => Number(sessionStorage.getItem('synthetic-sign-count'))), 0);
    await connected(page, 1); await signedOnce(page, 1);
  });
  await scenario('same-document payer change discards the previous wallet connection and capability', async page => {
    await page.goto(inviteUrl(0)); await loaded(page, 0); await connected(page, 0);
    await page.goto(inviteUrl(1)); await loaded(page, 1);
    assert.equal(await page.locator('#approve').isDisabled(), true);
    assert.equal((await page.locator('#inventory').textContent()).includes('"account"'), false);
    assert.equal(requests.at(-1).role, 1); assert.equal(mutations().length, 0);
    await connected(page, 1); await signedOnce(page, 1);
  });
  for (const fragment of ['#invite=%7Bbad-json', '#invite=']) {
    await scenario(`invalid incoming ${fragment === '#invite=' ? 'empty' : 'malformed'} invitation fails closed`, async page => {
      await page.goto(inviteUrl(0)); await loaded(page, 0); await connected(page, 0);
      requests.length = 0;
      await page.goto(`${origin}/${fragment}`);
      await page.waitForFunction(() => location.hash === '' && document.querySelector('#message').textContent.includes('Invalid private invitation'), null, { timeout: 3000 });
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
      assert.equal(await page.locator('#approve').isDisabled(), true);
      assert.equal(await page.locator('#submit').isDisabled(), true);
      assert.equal(requests.some(request => request.role !== null), false);
      assert.equal(mutations().length, 0);
      await page.reload();
      await page.locator('#payment').filter({ hasText: 'collecting' }).waitFor();
      assert.equal(requests.some(request => request.role !== null), false);
    });
  }
  for (const reject of [false, true]) {
    await scenario(`invitation change invalidates an old pending ${reject ? 'rejection' : 'signature'} before reload completes`, async page => {
      await page.goto(inviteUrl(0)); await loaded(page, 0); await connected(page, 0);
      await page.evaluate(() => { window.holdSyntheticSign = true; });
      await page.getByRole('button', { name: 'Approve my contribution', exact: true }).click();
      await page.waitForFunction(() => typeof window.completeSyntheticSign === 'function');
      let releaseReload;
      let reloadStarted;
      const started = new Promise(resolveStarted => { reloadStarted = resolveStarted; });
      const held = new Promise(resolveHeld => { releaseReload = resolveHeld; });
      await page.route(`${origin}/`, async route => { reloadStarted(); await held; await route.continue(); });
      try {
        await page.evaluate(url => { location.href = url; }, inviteUrl(1));
        await Promise.race([started, new Promise((_, rejectTimeout) => setTimeout(() => rejectTimeout(new Error('No document reload started')), 3000))]);
        await page.evaluate(reject => window.completeSyntheticSign(reject), reject);
        await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Wallet changed during approval'));
        assert.equal(await page.locator('#approve').isDisabled(), true);
        assert.equal(mutations().length, 0);
      } finally { releaseReload(); }
      await loaded(page, 1);
      assert.equal(mutations().length, 0);
    });
  }
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
}
console.log(`Invitation navigation regression ${failed ? 'FAILED' : 'PASSED'} in ${browser.version()}`);
process.exitCode = failed ? 1 : 0;
