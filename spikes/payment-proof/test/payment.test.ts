import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  address, createTransactionMessage, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder, getTransactionEncoder, setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice, signatureBytes, type TransactionMessage,
} from '@solana/kit';
import { getTransferCheckedInstructionDataDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  assembleSubmission, freezePayment, fromBase64, inspectPayment, planSchema, toBase64, unitsSchema,
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
