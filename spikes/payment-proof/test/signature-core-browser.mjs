import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { blockhash, getAddressDecoder, getTransactionDecoder, getTransactionEncoder, signatureBytes } from '@solana/kit';
import { build } from 'vite';
import { buildPaymentMessage, createPaymentPlan } from '../src/payment-core.ts';
import { assembleSignedPayment } from '../src/signature-core.ts';

const syntheticAddress = value => getAddressDecoder().decode(new Uint8Array(32).fill(value));
const wireMessage = message => ({ ...message,
  transactionBytes: [...message.transactionBytes], messageBytes: [...message.messageBytes] });
const wireSigned = signed => ({ reference: signed.reference, transactionBytes: [...signed.transactionBytes] });
const lifetime = { blockhash: blockhash(syntheticAddress(30)), lastValidBlockHeight: 100n };

export async function runSignatureCoreBrowserChecks({ chromium, browserExecutable }) {
  const bundle = await build({
    configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false, target: 'es2023', minify: false,
      lib: { entry: {
        'signature-core': fileURLToPath(new URL('../src/signature-core.ts', import.meta.url)),
        'payment-core': fileURLToPath(new URL('../src/payment-core.ts', import.meta.url)),
      }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    },
  });
  const bundles = Array.isArray(bundle) ? bundle : [bundle];
  assert.equal(bundles.length, 1);
  const assets = new Map(bundles[0].output.map(file => [
    `/${file.fileName}`, file.type === 'chunk' ? file.code : file.source,
  ]));
  assert.ok(assets.has('/signature-core.js'));
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
    async function scenario(name, operation) {
      try { await operation(); console.log(`PASS ${name}`); }
      catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
    }

    let threePayer;
    for (const count of [2, 3]) {
      const publicKeys = await page.evaluate(async count => {
        globalThis.p3Keys = await Promise.all(Array.from({ length: count }, () => crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])));
        return Promise.all(globalThis.p3Keys.map(async key => [...new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey))]));
      }, count);
      const wallets = publicKeys.map(bytes => getAddressDecoder().decode(Uint8Array.from(bytes)));
      let input = { totalUnits: 6_000_002n, sellerWallet: syntheticAddress(10), sellerTokenAccount: syntheticAddress(11),
        payers: wallets.map((wallet, index) => ({ wallet, sourceTokenAccount: syntheticAddress(20 + index) })) };
      let plan = createPaymentPlan(input);
      let message = await buildPaymentMessage(plan, lifetime);
      if (count === 3 && Object.keys(getTransactionDecoder().decode(message.transactionBytes).signatures)[1] === wallets[1]) {
        input = { ...input, payers: [input.payers[0], input.payers[2], input.payers[1]] };
        plan = createPaymentPlan(input);
        message = await buildPaymentMessage(plan, lifetime);
      }
      await scenario(`browser native WebCrypto verifies and assembles ${count} payers with Node byte parity`, async () => {
        const actual = await page.evaluate(async ({ input, message, wallets, lifetime }) => {
          const payments = await import('/payment-core.js');
          const signatures = await import('/signature-core.js');
          const plan = payments.createPaymentPlan({ ...input, totalUnits: BigInt(input.totalUnits) });
          const candidate = { ...message, messageBytes: Uint8Array.from(message.messageBytes), transactionBytes: Uint8Array.from(message.transactionBytes) };
          const target = { plan, message: await payments.inspectPaymentMessage(candidate, { plan, blockhash: lifetime.blockhash, messageHash: message.messageHash }) };
          const inputs = await Promise.all(plan.contributions.map(async payer => ({ wallet: payer.wallet,
            signatureBytes: new Uint8Array(await crypto.subtle.sign('Ed25519', globalThis.p3Keys[wallets.indexOf(payer.wallet)].privateKey, Uint8Array.from(target.message.messageBytes).buffer)) })));
          for (const input of inputs) await signatures.verifyPayerSignature(target, input);
          const signed = await signatures.assembleSignedPayment(target, inputs);
          globalThis.p3Case = { target, inputs };
          return { inputs: inputs.map(input => ({ wallet: input.wallet, signatureBytes: [...input.signatureBytes] })),
            signed: { reference: signed.reference, transactionBytes: [...signed.transactionBytes] } };
        }, { input: { ...input, totalUnits: String(input.totalUnits) }, message: wireMessage(message), wallets,
          lifetime: { blockhash: lifetime.blockhash } });
        const inputs = actual.inputs.map(input => ({ ...input, signatureBytes: Uint8Array.from(input.signatureBytes) }));
        const expected = await assembleSignedPayment({ plan, message }, inputs);
        assert.deepEqual(actual.signed, wireSigned(expected));
        if (count === 3) {
          assert.notDeepEqual(Object.keys(getTransactionDecoder().decode(message.transactionBytes).signatures), plan.contributions.map(payer => payer.wallet));
          threePayer = { plan, message, inputs, expected };
        }
      });
    }
    assert.ok(threePayer, 'Three-payer signing setup must succeed');
    for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      await scenario(`browser assembles three-payer upload order ${order.join(',')}`, async () => {
        const actual = await page.evaluate(async order => {
          const core = await import('/signature-core.js');
          const { target, inputs } = globalThis.p3Case;
          const signed = await core.assembleSignedPayment(target, order.map(index => inputs[index]));
          return { reference: signed.reference, transactionBytes: [...signed.transactionBytes] };
        }, order);
        assert.deepEqual(actual, wireSigned(threePayer.expected));
      });
    }
    const { plan, message, inputs } = threePayer;
    const changedMessage = await buildPaymentMessage(plan, { ...lifetime, blockhash: blockhash(syntheticAddress(31)) });
    const invalidInputs = [
      ['missing payer', inputs.slice(1)], ['duplicate payer', [inputs[0], inputs[0], inputs[2]]],
      ['unexpected payer', [{ ...inputs[0], wallet: syntheticAddress(40) }, ...inputs.slice(1)]],
      ['zero signature', [{ ...inputs[0], signatureBytes: new Uint8Array(64) }, ...inputs.slice(1)]],
      ['wrong-key signature', [{ ...inputs[0], signatureBytes: inputs[1].signatureBytes }, ...inputs.slice(1)]],
    ];
    for (const [name, invalid] of invalidInputs) await scenario(`browser checked assembly rejects ${name}`, async () => {
      await assert.rejects(page.evaluate(async inputs => {
        const core = await import('/signature-core.js');
        await core.assembleSignedPayment(globalThis.p3Case.target, inputs.map(input => ({ ...input, signatureBytes: Uint8Array.from(input.signatureBytes) })));
      }, invalid.map(input => ({ ...input, signatureBytes: [...input.signatureBytes] }))));
    });
    await scenario('browser checked assembly rejects signatures for an old message', async () => {
      await assert.rejects(page.evaluate(async message => {
        const core = await import('/signature-core.js');
        const { target, inputs } = globalThis.p3Case;
        await core.assembleSignedPayment({ ...target, message: { ...message, messageBytes: Uint8Array.from(message.messageBytes), transactionBytes: Uint8Array.from(message.transactionBytes) } }, inputs);
      }, wireMessage(changedMessage)));
    });
    const original = getTransactionDecoder().decode(message.transactionBytes);
    const returned = getTransactionEncoder().encode({ ...original,
      signatures: { ...original.signatures, [inputs[0].wallet]: signatureBytes(inputs[0].signatureBytes) } });
    await scenario('browser verifies an own-slot wallet return and snapshots its bytes', async () => {
      const actual = await page.evaluate(async returned => {
        const core = await import('/signature-core.js');
        const { target, inputs } = globalThis.p3Case;
        const bytes = Uint8Array.from(returned);
        const pending = core.verifyWalletSignature(target, inputs[0].wallet, bytes);
        bytes.fill(0);
        const result = await pending;
        return { wallet: result.wallet, signatureBytes: [...result.signatureBytes] };
      }, [...returned]);
      assert.deepEqual(actual, { wallet: inputs[0].wallet, signatureBytes: [...inputs[0].signatureBytes] });
    });
    for (const [name, bytes] of [
      ['missing own signature', message.transactionBytes], ['another populated slot', threePayer.expected.transactionBytes],
      ['changed message', changedMessage.transactionBytes], ['noncanonical transaction', Uint8Array.of(...returned, 1)],
    ]) await scenario(`browser wallet return rejects ${name}`, async () => {
      await assert.rejects(page.evaluate(async returned => {
        const core = await import('/signature-core.js');
        const { target, inputs } = globalThis.p3Case;
        await core.verifyWalletSignature(target, inputs[0].wallet, Uint8Array.from(returned));
      }, [...bytes]));
    });
    await scenario('browser snapshots the complete signature collection and message before awaiting', async () => {
      const actual = await page.evaluate(async () => {
        const core = await import('/signature-core.js');
        const { target, inputs } = globalThis.p3Case;
        const message = { ...target.message, messageBytes: Uint8Array.from(target.message.messageBytes), transactionBytes: Uint8Array.from(target.message.transactionBytes) };
        const mutable = inputs.map(input => ({ ...input, signatureBytes: Uint8Array.from(input.signatureBytes) }));
        const pending = core.assembleSignedPayment({ ...target, message }, mutable);
        for (const input of mutable) input.signatureBytes.fill(0);
        mutable.length = 0;
        message.messageBytes.fill(0);
        message.transactionBytes.fill(0);
        const signed = await pending;
        return { reference: signed.reference, transactionBytes: [...signed.transactionBytes] };
      });
      assert.deepEqual(actual, wireSigned(threePayer.expected));
    });
    assert.deepEqual(externalRequests, [], 'Signature checks must stay on the local asset server');
    console.log(`Signature core browser regression ${failed ? 'FAILED' : 'PASSED'} in ${browser.version()}`);
    return failed;
  } finally {
    try { await browser?.close(); }
    finally {
      if (server.listening) await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
    }
  }
}
