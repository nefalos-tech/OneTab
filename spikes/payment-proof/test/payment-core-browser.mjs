import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  blockhash, getAddressDecoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder, getTransactionEncoder, signatureBytes,
} from '@solana/kit';
import { build } from 'vite';
import { buildPaymentMessage, createPaymentPlan } from '../../../src/lib/payments/payment-core.ts';
import { paymentFixture, payloadForPlan } from '../../../src/lib/payments/test-fixtures.ts';

const syntheticAddress = value => getAddressDecoder().decode(new Uint8Array(32).fill(value));
const lifetime = { blockhash: blockhash(syntheticAddress(30)), lastValidBlockHeight: 100n };
const wireCandidate = candidate => ({
  transactionBytes: [...candidate.transactionBytes], messageBytes: [...candidate.messageBytes],
  messageHash: candidate.messageHash,
});
const wireInput = input => ({ ...input, totalUnits: String(input.totalUnits) });

function paymentInput(count) {
  return {
    totalUnits: count === 2 ? 4_000_001n : 6_000_002n,
    sellerWallet: syntheticAddress(10), sellerTokenAccount: syntheticAddress(11),
    payers: [12, 13, 14].slice(0, count).map(value => ({
      wallet: syntheticAddress(value), sourceTokenAccount: syntheticAddress(value + 10),
    })),
  };
}

function changedMessage(candidate, change) {
  const transaction = getTransactionDecoder().decode(candidate.transactionBytes);
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const messageBytes = getCompiledTransactionMessageEncoder().encode(change(compiled));
  return {
    transactionBytes: getTransactionEncoder().encode({ ...transaction, messageBytes }), messageBytes,
    messageHash: createHash('sha256').update(messageBytes).digest('hex'),
  };
}

export async function runPaymentCoreBrowserChecks({ chromium, browserExecutable }) {
  const bundle = await build({
    configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false, target: 'es2023', minify: false,
      lib: { entry: {
        'payment-core': fileURLToPath(new URL('../../../src/lib/payments/payment-core.ts', import.meta.url)),
        'signing-payload': fileURLToPath(new URL('../../../src/lib/payments/signing-payload.ts', import.meta.url)),
      }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    },
  });
  const bundles = Array.isArray(bundle) ? bundle : [bundle];
  assert.equal(bundles.length, 1, 'Expected one Vite library bundle');
  const assets = new Map(bundles[0].output.map(file => [
    `/${file.fileName}`, file.type === 'chunk' ? file.code : file.source,
  ]));
  assert.ok(assets.has('/payment-core.js'));
  assert.ok(assets.has('/signing-payload.js'));
  assets.set('/', '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>');
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const asset = assets.get(path);
    response.writeHead(asset === undefined ? 404 : 200, {
      'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html',
    });
    response.end(asset);
  });
  let browser;
  let failed = 0;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    const context = await browser.newContext();
    const externalRequests = [];
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests.push(route.request().url());
      await route.abort();
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async () => { await import('/payment-core.js'); });

    async function scenario(name, operation) {
      try {
        await operation();
        console.log(`PASS ${name}`);
      } catch (error) {
        failed++;
        console.error(`FAIL ${name}: ${error.message}`);
      }
    }

    for (const count of [2, 3]) {
      const input = paymentInput(count);
      const expected = wireCandidate(await buildPaymentMessage(createPaymentPlan(input), lifetime));
      await scenario(`browser ${count}-payer construction and inspection match Node bytes and hash`, async () => {
        const actual = await page.evaluate(async ({ input, lifetime }) => {
          const core = await import('/payment-core.js');
          const plan = core.createPaymentPlan({ ...input, totalUnits: BigInt(input.totalUnits) });
          const candidate = await core.buildPaymentMessage(plan, {
            ...lifetime, lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight),
          });
          const inspected = await core.inspectPaymentMessage(candidate, {
            plan, blockhash: lifetime.blockhash, messageHash: candidate.messageHash,
          });
          const wire = value => ({
            transactionBytes: [...value.transactionBytes], messageBytes: [...value.messageBytes],
            messageHash: value.messageHash,
          });
          return { built: wire(candidate), inspected: wire(inspected),
            shares: core.equalShares(plan.totalUnits, plan.contributions.length).map(String) };
        }, { input: wireInput(input), lifetime: { ...lifetime, lastValidBlockHeight: String(lifetime.lastValidBlockHeight) } });
        assert.deepEqual(actual.built, expected);
        assert.deepEqual(actual.inspected, expected);
        assert.deepEqual(actual.shares, count === 2 ? ['2000001', '2000000'] : ['2000001', '2000001', '2000000']);
      });
    }

    const input = paymentInput(3);
    const candidate = await buildPaymentMessage(createPaymentPlan(input), lifetime);
    const changedSeller = await buildPaymentMessage(createPaymentPlan({
      ...input, sellerTokenAccount: syntheticAddress(40),
    }), lifetime);
    const changedAmount = changedMessage(candidate, compiled => {
      const instructions = [...compiled.instructions];
      const third = instructions[4];
      const data = Uint8Array.from(third.data);
      const amount = new DataView(data.buffer);
      amount.setBigUint64(1, amount.getBigUint64(1, true) + 1n, true);
      instructions[4] = { ...third, data };
      return { ...compiled, instructions };
    });
    const changedSource = changedMessage(candidate, compiled => ({
      ...compiled, staticAccounts: compiled.staticAccounts.map(account =>
        account === input.payers[2].sourceTokenAccount ? syntheticAddress(41) : account),
    }));
    const changedBlockhash = await buildPaymentMessage(createPaymentPlan(input), {
      ...lifetime, blockhash: blockhash(syntheticAddress(31)),
    });
    const decoded = getTransactionDecoder().decode(candidate.transactionBytes);
    const signed = { ...candidate, transactionBytes: getTransactionEncoder().encode({
      ...decoded, signatures: { ...decoded.signatures,
        [input.payers[2].wallet]: signatureBytes(new Uint8Array(64).fill(7)) },
    }) };
    const rejections = [
      ['whole-plan seller mismatch with a recomputed hash', changedSeller, true],
      ['third-payer amount tampering with a recomputed hash', changedAmount, true],
      ['third-payer source tampering with a recomputed hash', changedSource, true],
      ['changed blockhash with a recomputed hash', changedBlockhash, true],
      ['malformed transaction encoding', { ...candidate, transactionBytes: candidate.transactionBytes.slice(0, 4) }, false],
      ['a preexisting third-payer signature', signed, false],
    ];
    for (const [name, malicious, changedHash] of rejections) {
      await scenario(`browser rejects ${name}`, async () => {
        if (changedHash) assert.notEqual(malicious.messageHash, candidate.messageHash);
        await assert.rejects(page.evaluate(async ({ input, candidate, expected }) => {
          const core = await import('/payment-core.js');
          const plan = core.createPaymentPlan({ ...input, totalUnits: BigInt(input.totalUnits) });
          await core.inspectPaymentMessage({ ...candidate,
            transactionBytes: Uint8Array.from(candidate.transactionBytes),
            messageBytes: Uint8Array.from(candidate.messageBytes),
          }, { ...expected, plan });
        }, { input: wireInput(input), candidate: wireCandidate(malicious),
          expected: { blockhash: lifetime.blockhash, messageHash: malicious.messageHash } }));
      });
    }

    for (const count of [2, 3]) {
      const fixture = await paymentFixture(count);
      await scenario(`browser validates the B1 ${count}-payer payload against independent room and config`, async () => {
        const actual = await page.evaluate(async fixture => {
          const validator = await import('/signing-payload.js');
          const validated = await validator.validateSigningPayload(fixture);
          return { transactionBase64: validator.toBase64(validated.message.transactionBytes),
            messageBase64: validator.toBase64(validated.message.messageBytes), messageHash: validated.message.messageHash,
            units: validated.plan.contributions.map(payer => String(payer.units)),
            attemptId: validated.target.attemptId, lastValidBlockHeight: String(validated.target.lastValidBlockHeight) };
        }, { payload: fixture.payload, room: fixture.room, config: fixture.config });
        assert.deepEqual(actual, { transactionBase64: fixture.payload.transactionBase64,
          messageBase64: fixture.payload.messageBase64, messageHash: fixture.payload.messageHash,
          units: fixture.room.participants.map(payer => payer.shareUnits), attemptId: fixture.payload.attemptId,
          lastValidBlockHeight: fixture.payload.lastValidBlockHeight });
      });

      const first = fixture.plan.contributions[0];
      const second = fixture.plan.contributions[1];
      const third = fixture.plan.contributions[2];
      const changedFirst = { ...first, sourceTokenAccount: syntheticAddress(41) };
      const foreign = createPaymentPlan({ totalUnits: fixture.plan.totalUnits,
        sellerWallet: fixture.plan.sellerWallet, sellerTokenAccount: fixture.plan.sellerTokenAccount,
        payers: third ? [changedFirst, second, third] : [changedFirst, second] });
      const invalid = [
        ['internally consistent foreign source account', { payload: await payloadForPlan(foreign) }],
        ['foreign seller', { payload: { ...fixture.payload, payment: { ...fixture.payload.payment, sellerWallet: syntheticAddress(40) } } }],
        ['stale attempt', { room: { ...fixture.room, attempt: { ...fixture.room.attempt, id: '00000000-0000-4000-8000-000000000003' } } }],
        ['stale height', { room: { ...fixture.room, attempt: { ...fixture.room.attempt, lastValidBlockHeight: '101' } } }],
        ['submitting attempt', { room: { ...fixture.room, attempt: { ...fixture.room.attempt, state: 'submitting' } } }],
        ['unverified mint config', { config: { ...fixture.config, mint: syntheticAddress(40) } }],
        ['noncanonical transaction base64', { payload: { ...fixture.payload, transactionBase64: fixture.payload.transactionBase64 + '\n' } }],
        ['oversized transaction encoding', { payload: { ...fixture.payload, transactionBase64: 'A'.repeat(1648) } }],
        ['reordered slots', { payload: { ...fixture.payload, payment: { ...fixture.payload.payment,
          contributions: [...fixture.payload.payment.contributions].reverse() } } }],
      ];
      for (const [name, change] of invalid) {
        await scenario(`browser rejects B1 ${count}-payer ${name}`, async () => {
          await assert.rejects(page.evaluate(async input => {
            const validator = await import('/signing-payload.js');
            await validator.validateSigningPayload(input);
          }, { payload: fixture.payload, room: fixture.room, config: fixture.config, ...change }));
        });
      }
      await scenario(`browser B1 ${count}-payer validation snapshots inputs before asynchronous derivation`, async () => {
        const actual = await page.evaluate(async input => {
          const validator = await import('/signing-payload.js');
          const pending = validator.validateSigningPayload(input);
          input.payload.payment.contributions.reverse();
          input.payload.messageHash = '0'.repeat(64);
          input.room.checkout.totalUnits = '100';
          input.room.participants.reverse();
          input.room.attempt = null;
          input.config.mint = input.room.checkout.sellerWallet;
          const validated = await pending;
          return validator.toBase64(validated.message.transactionBytes);
        }, { payload: fixture.payload, room: fixture.room, config: fixture.config });
        assert.equal(actual, fixture.payload.transactionBase64);
      });
    }
    assert.deepEqual(externalRequests, [], 'Browser checks must stay on the local asset server');
    console.log(`Payment core browser regression ${failed ? 'FAILED' : 'PASSED'} in ${browser.version()}`);
    return failed;
  } finally {
    try {
      await browser?.close();
    } finally {
      if (server.listening) {
        await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
      }
    }
  }
}
