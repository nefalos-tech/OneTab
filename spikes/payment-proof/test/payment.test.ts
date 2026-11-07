import { test } from 'node:test';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  address, createTransactionMessage, getAddressDecoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder, getTransactionEncoder, setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice, signatureBytes, type TransactionMessage,
} from '@solana/kit';
import { getTransferCheckedInstructionDataDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  approvalSchema, assembleSubmission, assembleVerifiedApprovals, freezePayment, fromBase64, inspectPayment, planSchema, toBase64, unitsSchema,
  sha256, verifyApproval, verifyWalletReturn, type FrozenPayment,
} from '../src/payment.js';
import { randomAddress, syntheticFixture } from './fixtures.js';

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

test('synthetic two-payer payment uses deterministic integer remainder and exact expected signers', async () => {
  const f = await syntheticFixture();
  assert.equal(f.plan.contributions[0].units, '2000001');
  assert.equal(f.plan.contributions[1].units, '2000000');
  const inspected = await inspectPayment(f.payment, f.payment);
  assert.equal(inspected.messageHash, f.payment.messageHash);
  const transaction = getTransactionDecoder().decode(fromBase64(f.payment.transactionBase64));
  assert.deepEqual(Object.keys(transaction.signatures).sort(), f.plan.contributions.map(value => value.wallet).sort());
  assert.equal(Object.keys(transaction.signatures)[0], f.plan.feePayer);
  assert.ok(Object.values(transaction.signatures).every(value => value === null));
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (compiled.version !== 'legacy') throw new Error('Expected legacy test transaction');
  assert.deepEqual(compiled.header, { numSignerAccounts: 2, numReadonlySignerAccounts: 1, numReadonlyNonSignerAccounts: 3 });
  assert.equal(compiled.instructions.length, 4);
  const [limit, price] = compiled.instructions;
  if (!limit?.data || !price?.data) throw new Error('Expected explicit compute policy');
  for (const instruction of [limit, price]) {
    assert.equal(compiled.staticAccounts[instruction.programAddressIndex], COMPUTE_BUDGET_PROGRAM);
    assert.deepEqual(instruction.accountIndices ?? [], []);
  }
  assert.equal(limit.data.length, 5);
  assert.equal(limit.data[0], 2);
  assert.equal(new DataView(Uint8Array.from(limit.data).buffer).getUint32(1, true), 400_000);
  assert.equal(price.data.length, 9);
  assert.equal(price.data[0], 3);
  assert.equal(new DataView(Uint8Array.from(price.data).buffer).getBigUint64(1, true), 0n);
  for (const [index, instruction] of compiled.instructions.slice(2).entries()) {
    const payer = f.plan.contributions[index];
    if (!payer || !instruction.data || !instruction.accountIndices) throw new Error('Expected checked transfer');
    assert.equal(compiled.staticAccounts[instruction.programAddressIndex], TOKEN_PROGRAM_ADDRESS);
    assert.deepEqual(instruction.accountIndices.map((value): string | undefined => compiled.staticAccounts[value]), [payer.sourceTokenAccount, f.plan.mint, f.plan.sellerTokenAccount, payer.wallet]);
    assert.deepEqual(getTransferCheckedInstructionDataDecoder().decode(instruction.data), {
      discriminator: 12, amount: index === 0 ? 2000001n : 2000000n, decimals: 6,
    });
  }
});

test('synthetic unsigned-wallet auto-fees reproduce the transfer-only rejection and preserve an explicit policy', async () => {
  const f = await syntheticFixture();
  const compiled = getCompiledTransactionMessageDecoder().decode(fromBase64(f.payment.messageBase64));
  if (compiled.version !== 'legacy') throw new Error('Expected legacy fixture');
  async function withMessage(source: FrozenPayment, message: typeof compiled): Promise<FrozenPayment> {
    const bytes = getCompiledTransactionMessageEncoder().encode(message);
    return { ...source, messageBase64: toBase64(bytes), messageHash: await sha256(bytes),
      transactionBase64: toBase64(Uint8Array.of(2, ...new Uint8Array(128), ...bytes)) };
  }
  async function autoFeeWalletReturn(payment: FrozenPayment) {
    const message = getCompiledTransactionMessageDecoder().decode(fromBase64(payment.messageBase64));
    if (message.version !== 'legacy') throw new Error('Expected legacy fixture');
    if (message.instructions.some(instruction => message.staticAccounts[instruction.programAddressIndex] === COMPUTE_BUDGET_PROGRAM)) {
      return f.walletReturn(0, payment);
    }
    const existingProgram = message.staticAccounts.findIndex(account => account === COMPUTE_BUDGET_PROGRAM);
    const programAddressIndex = existingProgram < 0 ? message.staticAccounts.length : existingProgram;
    const empty: TransactionMessage & { version: 'legacy' } = createTransactionMessage({ version: 'legacy' });
    const policy = setTransactionMessageComputeUnitPrice(10_000n, setTransactionMessageComputeUnitLimit(400_000, empty));
    const changed = await withMessage(payment, { ...message,
      staticAccounts: existingProgram < 0 ? [...message.staticAccounts, address(COMPUTE_BUDGET_PROGRAM)] : message.staticAccounts,
      header: { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + (existingProgram < 0 ? 1 : 0) },
      instructions: [...policy.instructions.map(instruction => ({ ...instruction, programAddressIndex, accountIndices: [] })), ...message.instructions],
    });
    return f.walletReturn(0, changed);
  }
  const transferOnly = await withMessage(f.payment, { ...compiled, instructions: compiled.instructions.filter(
    instruction => compiled.staticAccounts[instruction.programAddressIndex] === TOKEN_PROGRAM_ADDRESS,
  ) });
  await assert.rejects(verifyWalletReturn(transferOnly, 0, await autoFeeWalletReturn(transferOnly)), /Wallet changed transaction/);
  const returned = await autoFeeWalletReturn(f.payment);
  assert.equal((await verifyWalletReturn(f.payment, 0, returned)).messageHash, f.payment.messageHash);
});

test('self-consistent malicious wire messages fail full semantic comparison against the pinned expected plan', async () => {
  const f = await syntheticFixture();
  const compiled = getCompiledTransactionMessageDecoder().decode(fromBase64(f.payment.messageBase64));
  if (compiled.version !== 'legacy') throw new Error('Expected legacy fixture');
  const first = compiled.instructions[2];
  if (!first?.data || !first.accountIndices) throw new Error('Expected first transfer');
  const mutations = [
    { ...compiled, staticAccounts: compiled.staticAccounts.map((value, index) => index === 0 ? randomAddress() : value) },
    { ...compiled, header: { ...compiled.header, numReadonlySignerAccounts: 0 } },
    { ...compiled, header: { ...compiled.header, numReadonlyNonSignerAccounts: 2 } },
    { ...compiled, lifetimeToken: randomAddress() },
    { ...compiled, instructions: [...compiled.instructions, first] },
    { ...compiled, instructions: [...compiled.instructions].reverse() },
  ];
  for (const account of [f.plan.mint, f.plan.sellerTokenAccount, f.plan.contributions[0].sourceTokenAccount, f.plan.contributions[1].wallet, TOKEN_PROGRAM_ADDRESS]) {
    mutations.push({ ...compiled, staticAccounts: compiled.staticAccounts.map(value => value === account ? randomAddress() : value) });
  }
  for (const byte of [0, 1, 9]) {
    const data = Uint8Array.from(first.data); data[byte] = (data[byte] ?? 0) ^ 1;
    mutations.push({ ...compiled, instructions: [...compiled.instructions.slice(0, 2), { ...first, data }, ...compiled.instructions.slice(3)] });
  }
  mutations.push({ ...compiled, instructions: [...compiled.instructions.slice(0, 2), { ...first, accountIndices: [...first.accountIndices].reverse() }, ...compiled.instructions.slice(3)] });
  for (const mutation of mutations) {
    const bytes = getCompiledTransactionMessageEncoder().encode(mutation);
    const messageHash = await sha256(bytes);
    const malicious = { ...f.payment, messageHash, messageBase64: toBase64(bytes),
      transactionBase64: toBase64(Uint8Array.of(2, ...new Uint8Array(128), ...bytes)) };
    await assert.rejects(inspectPayment(malicious, { ...f.payment, messageHash }));
  }
});

test('self-consistent added, changed, removed and reordered compute policies fail validation and wallet-return checks', async () => {
  const f = await syntheticFixture();
  const compiled = getCompiledTransactionMessageDecoder().decode(fromBase64(f.payment.messageBase64));
  if (compiled.version !== 'legacy') throw new Error('Expected legacy fixture');
  const [limit, price, ...transfers] = compiled.instructions;
  if (!limit?.data || !price?.data) throw new Error('Expected compute policy');
  const changedLimit = Uint8Array.from(limit.data);
  changedLimit[1] = (changedLimit[1] ?? 0) ^ 1;
  const changedPrice = Uint8Array.from(price.data);
  changedPrice[1] = (changedPrice[1] ?? 0) ^ 1;
  const mutations = [
    [...compiled.instructions, limit], [...compiled.instructions, price],
    [{ ...limit, data: changedLimit }, price, ...transfers],
    [limit, { ...price, data: changedPrice }, ...transfers],
    [price, ...transfers], [limit, ...transfers], transfers,
    [price, limit, ...transfers], [...transfers, limit, price],
    [{ ...limit, accountIndices: [0] }, price, ...transfers],
    [limit, { ...price, accountIndices: [0] }, ...transfers],
    [{ ...limit, programAddressIndex: 0 }, price, ...transfers],
    [limit, { ...price, programAddressIndex: 0 }, ...transfers],
  ];
  for (const instructions of mutations) {
    const bytes = getCompiledTransactionMessageEncoder().encode({ ...compiled, instructions });
    const messageHash = await sha256(bytes);
    const malicious = { ...f.payment, messageHash, messageBase64: toBase64(bytes),
      transactionBase64: toBase64(Uint8Array.of(2, ...new Uint8Array(128), ...bytes)) };
    await assert.rejects(inspectPayment(malicious, { ...f.payment, messageHash }), /Full payment message mismatch/);
    await assert.rejects(verifyWalletReturn(f.payment, 0, await f.walletReturn(0, malicious)), /Wallet changed transaction/);
  }
});

test('unsigned 64-bit boundaries reject floats, signs, zero contributions, overflow and imprecise totals', async () => {
  for (const value of ['-1', '1.0', '1e6', '01', '18446744073709551616']) assert.equal(unitsSchema.safeParse(value).success, false);
  assert.equal(unitsSchema.parse('18446744073709551615'), '18446744073709551615');
  const f = await syntheticFixture('18446744073709551615');
  assert.equal(f.plan.contributions[0].units, '9223372036854775808');
  assert.equal(f.plan.contributions[1].units, '9223372036854775807');
  assert.equal(planSchema.safeParse({ ...f.plan, total: 9007199254740993 }).success, false);
  assert.equal(planSchema.safeParse({ ...f.plan, total: '1', contributions: [
    { ...f.plan.contributions[0], units: '1' }, { ...f.plan.contributions[1], units: '0' },
  ] }).success, false);
});

test('every changed message byte is refused before authorization', async () => {
  const f = await syntheticFixture();
  const bytes = fromBase64(f.payment.messageBase64);
  for (let index = 0; index < bytes.length; index++) {
    const changed = bytes.slice();
    changed[index] = (changed[index] ?? 0) ^ 1;
    await assert.rejects(inspectPayment({ ...f.payment, messageBase64: toBase64(changed) }, f.payment));
  }
  for (const field of ['mint', 'sellerWallet', 'sellerTokenAccount', 'feePayer', 'tokenProgram']) {
    await assert.rejects(inspectPayment({ ...f.payment, plan: { ...f.plan, [field]: randomAddress() } }, f.payment));
  }
  await assert.rejects(inspectPayment({ ...f.payment, blockhash: randomAddress() }, f.payment));
  await assert.rejects(inspectPayment({ ...f.payment, plan: { ...f.plan, decimals: 9 } }, f.payment));
  await assert.rejects(inspectPayment({ ...f.payment, plan: { ...f.plan, contributions: [
    { ...f.plan.contributions[0], sourceTokenAccount: randomAddress() }, f.plan.contributions[1],
  ] } }, f.payment));
});

test('missing, wrong, invalid, stale, changed-message and extra signatures cannot complete payment', async () => {
  const f = await syntheticFixture();
  const first = await f.approval(0);
  const second = await f.approval(1);
  await assert.rejects(assembleSubmission(f.payment, [first]));
  await assert.rejects(assembleSubmission(f.payment, [first, first]));
  await assert.rejects(verifyApproval(f.payment, { ...first, slot: 1 }));
  await assert.rejects(verifyApproval(f.payment, { ...first, signatureBase64: toBase64(new Uint8Array(64)) }));
  const changed = await freezePayment({ ...f.payment, blockhash: randomAddress() });
  await assert.rejects(verifyApproval(changed, first));
  await assert.rejects(verifyWalletReturn(f.payment, 0, fromBase64(f.payment.transactionBase64)));
  await assert.rejects(verifyWalletReturn(f.payment, 0, await f.walletReturn(0, changed)));
  const returned = getTransactionDecoder().decode(await f.walletReturn(0));
  const extra = getTransactionEncoder().encode({ ...returned, signatures: {
    ...returned.signatures, [f.plan.contributions[1].wallet]: signatureBytes(fromBase64(second.signatureBase64)),
  } });
  await assert.rejects(verifyWalletReturn(f.payment, 0, Uint8Array.from(extra)));
  assert.equal((await verifyWalletReturn(f.payment, 0, await f.walletReturn(0))).signatureBase64, first.signatureBase64);
  const submission = await assembleSubmission(f.payment, [first, second]);
  assert.ok(submission.reference.length > 70);
  assert.equal(toBase64(getTransactionDecoder().decode(fromBase64(submission.signedBase64)).messageBytes), f.payment.messageBase64);
});

const P1_KNOWN_ANSWER = {
  "id": "11111111-1111-4111-8111-111111111111",
  "plan": {
    "network": "devnet",
    "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "decimals": 6,
    "tokenProgram": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "sellerWallet": "LbUiWL3xVV8hTFYBVdbTNrpDo41NKS6o3LHHuDzjfcY",
    "sellerTokenAccount": "QWmroo4YnnMqYW3cnxWkFdaTxGD3P7vMSzwMHGbUzwF",
    "feePayer": "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
    "total": "4000001",
    "contributions": [
      {
        "slot": 0,
        "wallet": "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
        "sourceTokenAccount": "CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8",
        "units": "2000001"
      },
      {
        "slot": 1,
        "wallet": "8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR",
        "sourceTokenAccount": "GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq",
        "units": "2000000"
      }
    ]
  },
  "planHash": "3ccf9aeda8b7671bce1f24e26c2f52e0a98fdf57f274069b06164644a2bd2ca1",
  "messageHash": "ed2300a9401acbdb1dd3bfe4704dc9146a503c3a1e94f7da1cb036081e1cbff7",
  "blockhash": "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx",
  "lastValidBlockHeight": "100",
  "messageBase64": "AgEDCAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgY7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAABt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKkHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwQGAAUCgBoGAAYACQMAAAAAAAAAAAcEAgUEAAoMgYQeAAAAAAAGBwQDBQQBCgyAhB4AAAAAAAY=",
  "transactionBase64": "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgEDCAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgY7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAABt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKkHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwQGAAUCgBoGAAYACQMAAAAAAAAAAAcEAgUEAAoMgYQeAAAAAAAGBwQDBQQBCgyAhB4AAAAAAAY=",
  "version": "legacy"
};

test('P1 d1fb9d6 synthetic known-answer plan, message and unsigned transaction bytes stay unchanged', async () => {
  const expected = { ...P1_KNOWN_ANSWER, plan: planSchema.parse(P1_KNOWN_ANSWER.plan) };
  const payment = await freezePayment(expected);
  assert.deepEqual(payment, expected);
  assert.deepEqual(await inspectPayment(payment, expected), expected);
});

test('P1 wire adapter keeps two stable ordered slots and rejects supplied-share disagreement', async () => {
  const { plan } = await syntheticFixture();
  for (const contributions of [
    [plan.contributions[1], plan.contributions[0]],
    [plan.contributions[0]],
    [...plan.contributions, { ...plan.contributions[1], slot: 2 }],
    [{ ...plan.contributions[0], units: '2000000' }, plan.contributions[1]],
  ]) assert.equal(planSchema.safeParse({ ...plan, contributions }).success, false);
  assert.equal(planSchema.safeParse({ ...plan, total: '1' }).success, false);
});

test('P1 adapters snapshot caller-owned envelopes and independent expectations before asynchronous hashing', async () => {
  const expected = { ...P1_KNOWN_ANSWER, plan: planSchema.parse(P1_KNOWN_ANSWER.plan) };
  const input = { id: expected.id, plan: planSchema.parse(expected.plan), blockhash: expected.blockhash,
    lastValidBlockHeight: expected.lastValidBlockHeight };
  const freezing = freezePayment(input);
  input.id = '22222222-2222-4222-8222-222222222222';
  input.blockhash = randomAddress();
  input.lastValidBlockHeight = '999';
  input.plan.sellerWallet = randomAddress();
  assert.deepEqual(await freezing, expected);
  const trusted = { plan: planSchema.parse(expected.plan), planHash: expected.planHash, messageHash: expected.messageHash };
  const inspecting = inspectPayment(expected, trusted);
  trusted.planHash = '0'.repeat(64);
  trusted.messageHash = '1'.repeat(64);
  trusted.plan.sellerWallet = randomAddress();
  assert.deepEqual(await inspecting, expected);
});

test('P1 safeParse rejects malformed and overflowing canonical units without throwing', () => {
  const plan = planSchema.parse(P1_KNOWN_ANSWER.plan);
  for (const value of ['18446744073709551616', '1.0', '1e6', '-1', '01', 'invalid', '', '0', 1, null]) {
    assert.equal(planSchema.safeParse({ ...plan, total: value }).success, false);
    for (const slot of [0, 1]) {
      const contributions = plan.contributions.map((payer, index) => index === slot ? { ...payer, units: value } : payer);
      assert.equal(planSchema.safeParse({ ...plan, contributions }).success, false);
    }
  }
});

const P1_SIGNATURE_KNOWN_ANSWER = {
  "signed": {
    "reference": "33Xojbf2raPCjgBV9un3Kj6kh2KhS3Py3Fw6fyrka7vxs61m9r1fbwf3YdVqaMPayNRfuJ9PjuDbQHb7HNXmKoqV",
    "signedBase64": "AmY3fPcGr2Cv0LiNOcNea8e+m3xhbahKZwJt8JlxdFU4c+hlsnoO6FA0Q6nvDRQm1D1FOKTp8qXNu8w/O1VMQwRR/LykN7sSBm0Z7spcsD4mN111oXtUZplmOivXCL5PQgvyo3xbIR1+lJeWo1SG/ed0Xj3s6mpUcpzde/IfKf8EAgEDCIqI4910CfGV/VLbLTy6XXLKZwm/HZQSG/N0iAG0D29cgTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAABt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKkeHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHgQGAAUCgBoGAAYACQMAAAAAAAAAAAcEAgUEAAoMgYQeAAAAAAAGBwQDBQQBCgyAhB4AAAAAAAY=",
    "signedHash": "d812e54e532ea8836d2182d149227637780478b34e61e1edc1b248c49f5e94e4"
  },
  "diagnostic": {
    "reference": "",
    "signedBase64": "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABR/LykN7sSBm0Z7spcsD4mN111oXtUZplmOivXCL5PQgvyo3xbIR1+lJeWo1SG/ed0Xj3s6mpUcpzde/IfKf8EAgEDCIqI4910CfGV/VLbLTy6XXLKZwm/HZQSG/N0iAG0D29cgTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAABt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKkeHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHgQGAAUCgBoGAAYACQMAAAAAAAAAAAcEAgUEAAoMgYQeAAAAAAAGBwQDBQQBCgyAhB4AAAAAAAY="
  }
};

async function deterministicSignatureFixture() {
  const syntheticAddress = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));
  const keys = [1, 2].map(value => createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, value)]),
    format: 'der', type: 'pkcs8',
  }));
  const wallets = keys.map(key => getAddressDecoder().decode(
    createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32),
  ));
  const plan = planSchema.parse({
    network: 'devnet', mint: P1_KNOWN_ANSWER.plan.mint, decimals: 6, tokenProgram: TOKEN_PROGRAM_ADDRESS,
    sellerWallet: syntheticAddress(10), sellerTokenAccount: syntheticAddress(11), feePayer: wallets[0], total: '4000001',
    contributions: wallets.map((wallet, slot) => ({
      slot, wallet, sourceTokenAccount: syntheticAddress(20 + slot), units: slot ? '2000000' : '2000001',
    })),
  });
  const payment = await freezePayment({ id: P1_KNOWN_ANSWER.id, plan, blockhash: syntheticAddress(30), lastValidBlockHeight: '100' });
  const approvals = await Promise.all(keys.map(async (key, slot) => {
    const imported = await crypto.subtle.importKey('pkcs8', key.export({ format: 'der', type: 'pkcs8' }), 'Ed25519', false, ['sign']);
    return { slot, messageHash: payment.messageHash, signatureBase64: toBase64(new Uint8Array(
      await crypto.subtle.sign('Ed25519', imported, Uint8Array.from(fromBase64(payment.messageBase64)).buffer),
    )) };
  }));
  return { payment, approvals: approvals.map(value => approvalSchema.parse(value)) };
}

test('P1 signed transaction, reference, hash and incomplete diagnostic match the pre-extraction Ed25519 baseline', async () => {
  const { payment, approvals } = await deterministicSignatureFixture();
  assert.deepEqual(await assembleSubmission(payment, approvals), P1_SIGNATURE_KNOWN_ANSWER.signed);
  assert.deepEqual(await assembleSubmission(payment, [...approvals].reverse()), P1_SIGNATURE_KNOWN_ANSWER.signed);
  assert.deepEqual(assembleVerifiedApprovals(payment, approvals.slice(1), true), P1_SIGNATURE_KNOWN_ANSWER.diagnostic);
});

test('P1 signature adapters snapshot the payment message before awaiting verification', async () => {
  const first = await deterministicSignatureFixture();
  const approval = first.approvals[0];
  assert.ok(approval);
  const verification = verifyApproval(first.payment, approval);
  first.payment.messageBase64 = toBase64(new Uint8Array([1, 2, 3]));
  assert.deepEqual(await verification, approval);
});

test('P1 signature adapters snapshot the frozen transaction and complete approval collection before awaiting assembly', async () => {
  const second = await deterministicSignatureFixture();
  const assembly = assembleSubmission(second.payment, second.approvals);
  second.payment.messageBase64 = toBase64(new Uint8Array([1, 2, 3]));
  second.payment.transactionBase64 = '';
  second.payment.plan.feePayer = randomAddress();
  second.approvals[0] = { slot: 1, messageHash: '0'.repeat(64), signatureBase64: '' };
  second.approvals.length = 1;
  assert.deepEqual(await assembly, P1_SIGNATURE_KNOWN_ANSWER.signed);
});
