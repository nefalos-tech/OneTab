import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockhash, getAddressDecoder, getBase58Decoder, getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder, getTransactionDecoder, getTransactionEncoder, signatureBytes,
  type Address, type ReadonlyUint8Array,
} from '@solana/kit';
import { buildPaymentMessage, createPaymentPlan, equalBytes, inspectPaymentMessage } from '../../../src/lib/payments/payment-core.js';
import {
  assembleSignedPayment, assembleTrustedSignatures, verifyPayerSignature, verifyWalletSignature,
  type PayerSignature, type SignatureTarget,
} from '../../../src/lib/payments/signature-core.js';

const syntheticAddress = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));
const lifetime = { blockhash: blockhash(syntheticAddress(30)), lastValidBlockHeight: 100n };

async function fixture(count: 2 | 3 = 3) {
  const records = await Promise.all([0, 1, 2].map(async index => {
    const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    return { key, wallet: getAddressDecoder().decode(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey))),
      sourceTokenAccount: syntheticAddress(20 + index) };
  }));
  const [organizer, second, third] = records;
  assert.ok(organizer && second && third);
  let plan = createPaymentPlan({ totalUnits: 6_000_002n, sellerWallet: syntheticAddress(10),
    sellerTokenAccount: syntheticAddress(11), payers: count === 2 ? [organizer, second] : [organizer, second, third] });
  let message = await buildPaymentMessage(plan, lifetime);
  if (count === 3 && Object.keys(getTransactionDecoder().decode(message.transactionBytes).signatures)[1] === second.wallet) {
    plan = createPaymentPlan({ totalUnits: plan.totalUnits, sellerWallet: plan.sellerWallet,
      sellerTokenAccount: plan.sellerTokenAccount, payers: [organizer, third, second] });
    message = await buildPaymentMessage(plan, lifetime);
  }
  const target: SignatureTarget = { plan, message: await inspectPaymentMessage(message, {
    plan, blockhash: lifetime.blockhash, messageHash: message.messageHash,
  }) };
  async function sign(wallet: Address, source = target.message): Promise<PayerSignature> {
    const record = records.find(value => value.wallet === wallet);
    assert.ok(record);
    return { wallet, signatureBytes: new Uint8Array(await crypto.subtle.sign(
      'Ed25519', record.key.privateKey, Uint8Array.from(source.messageBytes).buffer,
    )) };
  }
  const inputs = await Promise.all(plan.contributions.map(payer => sign(payer.wallet)));
  function walletReturn(input: PayerSignature, source = target.message): ReadonlyUint8Array {
    const original = getTransactionDecoder().decode(source.transactionBytes);
    return getTransactionEncoder().encode({ ...original,
      signatures: { ...original.signatures, [input.wallet]: signatureBytes(input.signatureBytes) } });
  }
  return { target, inputs, sign, walletReturn };
}

const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

test('real two- and three-payer signatures assemble identically for every upload order in compiled wallet slots', async () => {
  for (const count of [2, 3] satisfies (2 | 3)[]) {
    const { target, inputs } = await fixture(count);
    const compiledOrder = Object.keys(getTransactionDecoder().decode(target.message.transactionBytes).signatures);
    if (count === 3) assert.notDeepEqual(compiledOrder, target.plan.contributions.map(payer => payer.wallet));
    const expected = await assembleSignedPayment(target, inputs);
    for (const order of count === 3 ? permutations : [[0, 1], [1, 0]]) {
      const ordered = order.map(index => {
        const input = inputs[index];
        assert.ok(input);
        return input;
      });
      const signed = await assembleSignedPayment(target, ordered);
      assert.deepEqual(signed, expected);
      assert.deepEqual(assembleTrustedSignatures(target, ordered), expected);
      const decoded = getTransactionDecoder().decode(signed.transactionBytes);
      assert.ok(equalBytes(decoded.messageBytes, target.message.messageBytes));
      for (const input of inputs) assert.ok(equalBytes(decoded.signatures[input.wallet] ?? new Uint8Array(), input.signatureBytes));
      const organizer = inputs.find(input => input.wallet === target.plan.feePayer);
      assert.ok(organizer);
      assert.equal(signed.reference, getBase58Decoder().decode(organizer.signatureBytes));
      assert.ok(equalBytes(signed.transactionBytes.slice(1, 65), organizer.signatureBytes));
    }
  }
});

test('checked assembly rejects missing, duplicate, unexpected, zero, malformed, wrong-key and old-message inputs', async () => {
  const { target, inputs, sign } = await fixture();
  const [first, second] = inputs;
  assert.ok(first && second);
  const changedMessage = await buildPaymentMessage(target.plan, { ...lifetime, blockhash: blockhash(syntheticAddress(31)) });
  const stale = await sign(first.wallet, changedMessage);
  const invalid = [
    { ...first, wallet: syntheticAddress(40) },
    { ...first, signatureBytes: new Uint8Array(64) },
    { ...first, signatureBytes: new Uint8Array(63).fill(7) },
    { ...first, signatureBytes: new Uint8Array(65).fill(7) },
    { ...first, signatureBytes: second.signatureBytes }, stale,
  ];
  for (const input of invalid) {
    await assert.rejects(verifyPayerSignature(target, input));
    await assert.rejects(assembleSignedPayment(target, [input, ...inputs.slice(1)]));
  }
  for (const incomplete of [[], inputs.slice(1), [first, first, second], [...inputs, first]]) {
    await assert.rejects(assembleSignedPayment(target, incomplete));
    assert.throws(() => assembleTrustedSignatures(target, incomplete));
  }
});

test('earlier verification never substitutes for checked assembly reverification', async () => {
  const { target, inputs } = await fixture();
  const first = inputs[0];
  assert.ok(first);
  const verified = await verifyPayerSignature(target, first);
  const bytes = Uint8Array.from(verified.signatureBytes);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  await assert.rejects(assembleSignedPayment(target, [{ ...verified, signatureBytes: bytes }, ...inputs.slice(1)]));
  const changed = await buildPaymentMessage(target.plan, { ...lifetime, blockhash: blockhash(syntheticAddress(31)) });
  await assert.rejects(assembleSignedPayment({ ...target, message: changed }, inputs));
});

test('wallet returns require the expected payer alone, the exact message and canonical serialization', async () => {
  const { target, inputs, sign, walletReturn } = await fixture();
  for (const input of inputs) assert.deepEqual(await verifyWalletSignature(target, input.wallet, walletReturn(input)), input);
  const [first, second] = inputs;
  assert.ok(first && second);
  await assert.rejects(verifyWalletSignature(target, first.wallet, target.message.transactionBytes), /Missing wallet signature/);
  await assert.rejects(verifyWalletSignature(target, second.wallet, walletReturn(first)), /Unexpected signature slot/);
  const full = assembleTrustedSignatures(target, inputs);
  await assert.rejects(verifyWalletSignature(target, first.wallet, full.transactionBytes), /Unexpected signature slot/);
  const changed = await buildPaymentMessage(target.plan, { ...lifetime, blockhash: blockhash(syntheticAddress(31)) });
  await assert.rejects(verifyWalletSignature(target, first.wallet, walletReturn(await sign(first.wallet, changed), changed)), /Wallet changed transaction/);
  await assert.rejects(verifyWalletSignature(target, first.wallet, Uint8Array.of(...walletReturn(first), 1)), /Wallet changed transaction/);
  await assert.rejects(verifyWalletSignature(target, first.wallet, new Uint8Array([3, 1, 2])));
  await assert.rejects(verifyWalletSignature(target, first.wallet, walletReturn({ ...first, signatureBytes: second.signatureBytes })), /Invalid signature/);
});

test('signature targets reject changed, noncanonical, presigned and mismatched signer messages', async () => {
  const { target, inputs, walletReturn } = await fixture();
  const first = inputs[0];
  assert.ok(first);
  const compiled = getCompiledTransactionMessageDecoder().decode(target.message.messageBytes);
  const changed = await buildPaymentMessage(target.plan, { ...lifetime, blockhash: blockhash(syntheticAddress(31)) });
  const incorrectSigners = getCompiledTransactionMessageEncoder().encode({ ...compiled,
    staticAccounts: compiled.staticAccounts.map(account => account === first.wallet ? syntheticAddress(40) : account) });
  const invalidTargets = [
    { ...target.message, messageBytes: changed.messageBytes },
    { ...target.message, transactionBytes: Uint8Array.of(...target.message.transactionBytes, 1) },
    { ...target.message, transactionBytes: walletReturn(first) },
    { ...target.message, messageBytes: incorrectSigners,
      transactionBytes: Uint8Array.of(3, ...new Uint8Array(192), ...incorrectSigners) },
  ];
  for (const message of invalidTargets) {
    await assert.rejects(verifyPayerSignature({ ...target, message }, first));
    await assert.rejects(assembleSignedPayment({ ...target, message }, inputs));
    assert.throws(() => assembleTrustedSignatures({ ...target, message }, inputs));
  }
});

test('verification snapshots signature and message aliases before the first await and returns separate bytes', async () => {
  const { target, inputs } = await fixture();
  const first = inputs[0];
  assert.ok(first);
  const signatureBytes = Uint8Array.from(first.signatureBytes);
  const messageBytes = Uint8Array.from(target.message.messageBytes);
  const transactionBytes = Uint8Array.from(target.message.transactionBytes);
  const mutableTarget = { plan: target.plan, message: { ...target.message, messageBytes, transactionBytes } };
  const input = { ...first, signatureBytes };
  const verifying = verifyPayerSignature(mutableTarget, input);
  signatureBytes.fill(0);
  messageBytes.fill(0);
  transactionBytes.fill(0);
  input.wallet = syntheticAddress(40);
  const verified = await verifying;
  assert.deepEqual(verified, first);
  assert.notEqual(verified.signatureBytes, first.signatureBytes);
  new Uint8Array(verified.signatureBytes.buffer, verified.signatureBytes.byteOffset, verified.signatureBytes.byteLength).fill(0);
  assert.deepEqual(await verifyPayerSignature(target, first), first);
});

test('checked assembly snapshots every collection member before awaiting and produces independent output arrays', async () => {
  const { target, inputs } = await fixture();
  const expected = assembleTrustedSignatures(target, inputs);
  const mutable = inputs.map(input => ({ wallet: input.wallet, signatureBytes: Uint8Array.from(input.signatureBytes) }));
  const messageBytes = Uint8Array.from(target.message.messageBytes);
  const transactionBytes = Uint8Array.from(target.message.transactionBytes);
  const assembling = assembleSignedPayment({ plan: target.plan, message: { ...target.message, messageBytes, transactionBytes } }, mutable);
  for (const input of mutable) { input.signatureBytes.fill(0); input.wallet = syntheticAddress(40); }
  mutable.splice(0);
  messageBytes.fill(0);
  transactionBytes.fill(0);
  const result = await assembling;
  assert.deepEqual(result, expected);
  assert.notEqual(result.transactionBytes, expected.transactionBytes);
  const outputAlias = new Uint8Array(result.transactionBytes.buffer, result.transactionBytes.byteOffset, result.transactionBytes.byteLength);
  outputAlias.fill(0);
  assert.deepEqual(await assembleSignedPayment(target, inputs), expected);
});

test('wallet verification snapshots returned bytes and returns an independent signature', async () => {
  const { target, inputs, walletReturn } = await fixture();
  const first = inputs[0];
  assert.ok(first);
  const returned = Uint8Array.from(walletReturn(first));
  const verifying = verifyWalletSignature(target, first.wallet, returned);
  returned.fill(0);
  const result = await verifying;
  assert.deepEqual(result, first);
  const alias = new Uint8Array(result.signatureBytes.buffer, result.signatureBytes.byteOffset, result.signatureBytes.byteLength);
  alias.fill(0);
  assert.deepEqual(await verifyWalletSignature(target, first.wallet, walletReturn(first)), first);
});

test('trusted diagnostic assembly preserves missing placeholders and the organizer-derived reference', async () => {
  const { target, inputs } = await fixture();
  const first = inputs[0];
  assert.ok(first);
  const empty = assembleTrustedSignatures(target, [], { incompleteDiagnostic: true });
  assert.equal(empty.reference, null);
  assert.ok(equalBytes(empty.transactionBytes, target.message.transactionBytes));
  const incomplete = assembleTrustedSignatures(target, inputs.slice(1), { incompleteDiagnostic: true });
  assert.equal(incomplete.reference, null);
  assert.equal(getTransactionDecoder().decode(incomplete.transactionBytes).signatures[target.plan.feePayer], null);
  const organizerOnly = assembleTrustedSignatures(target, [first], { incompleteDiagnostic: true });
  assert.equal(organizerOnly.reference, getBase58Decoder().decode(first.signatureBytes));
  for (const bad of [[first, first], [{ ...first, wallet: syntheticAddress(40) }],
    [{ ...first, signatureBytes: new Uint8Array(64) }], [{ ...first, signatureBytes: new Uint8Array(63) }]]) {
    assert.throws(() => assembleTrustedSignatures(target, bad, { incompleteDiagnostic: true }));
  }
  const structurallyValid = inputs.map(input => ({ ...input, signatureBytes: new Uint8Array(64).fill(7) }));
  assert.ok(assembleTrustedSignatures(target, structurallyValid).reference);
  await assert.rejects(assembleSignedPayment(target, structurallyValid));
});
