import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  address, blockhash, getAddressDecoder, getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder, getTransactionDecoder, type Address,
} from '@solana/kit';
import { getTransferCheckedInstructionDataDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  DEVNET_USDC, buildPaymentMessage, createPaymentPlan, equalShares, inspectPaymentMessage, sha256,
  type MessageCandidate, type PayerSource,
} from '../src/payment-core.js';

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const U64_MAX = (1n << 64n) - 1n;
const key = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));
const lifetime = { blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };

function planInput(count: 2 | 3, totalUnits = 10n) {
  const first = { wallet: key(3), sourceTokenAccount: key(6) };
  const second = { wallet: key(1), sourceTokenAccount: key(4) };
  const third = { wallet: key(2), sourceTokenAccount: key(5) };
  return { totalUnits, sellerWallet: key(7), sellerTokenAccount: key(8), payers: count === 2
    ? [first, second] satisfies [PayerSource, PayerSource]
    : [first, second, third] satisfies [PayerSource, PayerSource, PayerSource] };
}

function decodedLegacy(candidate: MessageCandidate) {
  const compiled = getCompiledTransactionMessageDecoder().decode(candidate.messageBytes);
  if (compiled.version !== 'legacy') throw new Error('Expected synthetic legacy message');
  return compiled;
}

async function withMessage(message: ReturnType<typeof decodedLegacy>): Promise<MessageCandidate> {
  const messageBytes = getCompiledTransactionMessageEncoder().encode(message);
  return { messageBytes, messageHash: await sha256(messageBytes),
    transactionBytes: Uint8Array.of(message.header.numSignerAccounts, ...new Uint8Array(64 * message.header.numSignerAccounts), ...messageBytes) };
}

for (const count of [2, 3] satisfies (2 | 3)[]) {
  test(`synthetic ${count}-payer messages independently decode every instruction, signer and account role`, async () => {
    const plan = createPaymentPlan(planInput(count));
    const candidate = await buildPaymentMessage(plan, lifetime);
    const expected = { plan, blockhash: lifetime.blockhash, messageHash: candidate.messageHash };
    assert.deepEqual(await inspectPaymentMessage(candidate, expected), candidate);
    assert.equal(await sha256(candidate.messageBytes), candidate.messageHash);
    const transaction = getTransactionDecoder().decode(candidate.transactionBytes);
    assert.deepEqual(new Set(Object.keys(transaction.signatures)), new Set(plan.contributions.map(payer => payer.wallet)));
    assert.equal(Object.keys(transaction.signatures)[0], plan.feePayer);
    assert.ok(Object.values(transaction.signatures).every(value => value === null));
    assert.deepEqual(transaction.messageBytes, candidate.messageBytes);
    const message = decodedLegacy(candidate);
    assert.deepEqual(message.header, { numSignerAccounts: count, numReadonlySignerAccounts: count - 1, numReadonlyNonSignerAccounts: 3 });
    assert.equal(message.lifetimeToken, lifetime.blockhash);
    assert.deepEqual(new Set(message.staticAccounts), new Set([
      ...plan.contributions.flatMap(payer => [payer.wallet, payer.sourceTokenAccount]), plan.sellerTokenAccount,
      address(DEVNET_USDC), TOKEN_PROGRAM_ADDRESS, address(COMPUTE_BUDGET_PROGRAM),
    ]));
    function role(account: Address) {
      const index = message.staticAccounts.indexOf(account);
      assert.ok(index >= 0);
      const signer = index < message.header.numSignerAccounts;
      const writable = signer ? index < message.header.numSignerAccounts - message.header.numReadonlySignerAccounts
        : index < message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts;
      return { signer, writable };
    }
    for (const payer of plan.contributions) {
      assert.deepEqual(role(payer.wallet), { signer: true, writable: payer.slot === 0 });
      assert.deepEqual(role(payer.sourceTokenAccount), { signer: false, writable: true });
    }
    assert.deepEqual(role(plan.sellerTokenAccount), { signer: false, writable: true });
    for (const account of [plan.mint, plan.tokenProgram, address(COMPUTE_BUDGET_PROGRAM)]) {
      assert.deepEqual(role(account), { signer: false, writable: false });
    }
    assert.equal(message.instructions.length, count + 2);
    const [limit, price] = message.instructions;
    if (!limit?.data || !price?.data) throw new Error('Expected explicit compute instructions');
    for (const instruction of [limit, price]) {
      assert.equal(message.staticAccounts[instruction.programAddressIndex], COMPUTE_BUDGET_PROGRAM);
      assert.deepEqual(instruction.accountIndices ?? [], []);
    }
    assert.deepEqual([...limit.data], [2, 128, 26, 6, 0]);
    assert.deepEqual([...price.data], [3, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const [index, instruction] of message.instructions.slice(2).entries()) {
      const payer = plan.contributions[index];
      if (!payer || !instruction.data || !instruction.accountIndices) throw new Error('Expected payer checked transfer');
      assert.equal(message.staticAccounts[instruction.programAddressIndex], TOKEN_PROGRAM_ADDRESS);
      assert.deepEqual(instruction.accountIndices.map(value => message.staticAccounts[value]),
        [payer.sourceTokenAccount, address(DEVNET_USDC), plan.sellerTokenAccount, payer.wallet]);
      assert.deepEqual(getTransferCheckedInstructionDataDecoder().decode(instruction.data), {
        discriminator: 12, amount: count === 2 ? 5n : index === 0 ? 4n : 3n, decimals: 6,
      });
    }
  });

  test(`synthetic ${count}-payer full-message mutations fail even with recomputed malicious hashes`, async () => {
    const plan = createPaymentPlan(planInput(count));
    const candidate = await buildPaymentMessage(plan, lifetime);
    const expected = { plan, blockhash: lifetime.blockhash, messageHash: candidate.messageHash };
    const message = decodedLegacy(candidate);
    const [limit, price] = message.instructions;
    if (!limit?.data || !price?.data) throw new Error('Expected compute policy');
    const mutations = [
      { ...message, staticAccounts: [...message.staticAccounts, key(50)],
        header: { ...message.header, numReadonlyNonSignerAccounts: 4 } },
      { ...message, header: { ...message.header, numReadonlySignerAccounts: 0 } },
      { ...message, header: { ...message.header, numReadonlyNonSignerAccounts: 2 } },
      { ...message, header: { ...message.header, numSignerAccounts: count - 1 } },
      { ...message, lifetimeToken: key(51) },
      { ...message, instructions: [...message.instructions, limit] },
      { ...message, instructions: [...message.instructions, price] },
      { ...message, instructions: message.instructions.slice(1) },
      { ...message, instructions: [limit, ...message.instructions.slice(2)] },
      { ...message, instructions: message.instructions.slice(2) },
      { ...message, instructions: [limit, price, ...message.instructions.slice(2).reverse()] },
      { ...message, instructions: [price, limit, ...message.instructions.slice(2)] },
      { ...message, instructions: [...message.instructions].reverse() },
    ];
    for (const account of message.staticAccounts) {
      mutations.push({ ...message, staticAccounts: message.staticAccounts.map(value => value === account ? key(52) : value) });
    }
    for (const [index, instruction] of message.instructions.entries()) {
      if (!instruction.data) throw new Error('Expected instruction data');
      for (const byte of index < 2 ? [0, 1] : [0, 1, 9]) {
        const data = Uint8Array.from(instruction.data);
        data[byte] = (data[byte] ?? 0) ^ 1;
        mutations.push({ ...message, instructions: message.instructions.map((value, position) => position === index ? { ...instruction, data } : value) });
      }
      for (const changed of [{ ...instruction, programAddressIndex: 0 }, { ...instruction, accountIndices: [0] }]) {
        mutations.push({ ...message, instructions: message.instructions.map((value, position) => position === index ? changed : value) });
      }
      if (instruction.accountIndices) {
        for (const accountIndex of instruction.accountIndices.keys()) {
          const accountIndices = instruction.accountIndices.map((value, position) => position === accountIndex ? (value + 1) % message.staticAccounts.length : value);
          mutations.push({ ...message, instructions: message.instructions.map((value, position) => position === index ? { ...instruction, accountIndices } : value) });
        }
      }
    }
    for (const mutation of mutations) {
      const malicious = await withMessage(mutation);
      await assert.rejects(inspectPaymentMessage(malicious, expected));
      await assert.rejects(inspectPaymentMessage(malicious, { ...expected, messageHash: malicious.messageHash }));
    }
    const versioned = getCompiledTransactionMessageEncoder().encode({ ...message, version: 0, addressTableLookups: [] });
    const maliciousVersion = { messageBytes: versioned, transactionBytes: Uint8Array.of(count, ...new Uint8Array(count * 64), ...versioned), messageHash: await sha256(versioned) };
    await assert.rejects(inspectPaymentMessage(maliciousVersion, { ...expected, messageHash: maliciousVersion.messageHash }));
  });

  test(`synthetic ${count}-payer unsigned validation rejects added bytes, signatures and wrong independent pins`, async () => {
    const plan = createPaymentPlan(planInput(count));
    const candidate = await buildPaymentMessage(plan, lifetime);
    const expected = { plan, blockhash: lifetime.blockhash, messageHash: candidate.messageHash };
    for (const signer of plan.contributions.keys()) {
      const transactionBytes = Uint8Array.from(candidate.transactionBytes);
      transactionBytes[1 + 64 * signer] = 1;
      await assert.rejects(inspectPaymentMessage({ ...candidate, transactionBytes }, expected));
    }
    for (const transactionBytes of [
      Uint8Array.of(...candidate.transactionBytes, 0), candidate.transactionBytes.slice(0, -1),
      Uint8Array.of(count | 128, 0, ...candidate.transactionBytes.slice(1)),
      Uint8Array.of(count + 1, ...new Uint8Array((count + 1) * 64), ...candidate.messageBytes),
    ]) await assert.rejects(inspectPaymentMessage({ ...candidate, transactionBytes }, expected));
    const messageBytes = Uint8Array.of(...candidate.messageBytes, 0);
    const trailing = { messageBytes, transactionBytes: Uint8Array.of(count, ...new Uint8Array(count * 64), ...messageBytes), messageHash: await sha256(messageBytes) };
    await assert.rejects(inspectPaymentMessage(trailing, { ...expected, messageHash: trailing.messageHash }));
    await assert.rejects(inspectPaymentMessage(candidate, { ...expected, blockhash: blockhash(key(53)) }));
    await assert.rejects(inspectPaymentMessage(candidate, { ...expected, messageHash: '0'.repeat(64) }));
    await assert.rejects(inspectPaymentMessage({ ...candidate, messageHash: '0'.repeat(64) }, expected));
    const changed = planInput(count);
    changed.sellerWallet = key(54);
    const otherPlan = createPaymentPlan(changed);
    // Seller ownership is verified by RPC and the independent plan, but the wallet itself is absent from transfer bytes.
    assert.deepEqual(await buildPaymentMessage(otherPlan, lifetime), candidate);
    changed.sellerTokenAccount = key(55);
    await assert.rejects(inspectPaymentMessage(candidate, { ...expected, plan: createPaymentPlan(changed) }));
  });
}

test('equal shares cover both cardinalities, every remainder and exact uint64 boundaries', async () => {
  for (const count of [2, 3] satisfies (2 | 3)[]) {
    for (const total of [2n, 3n, 4n, 5n, 6n, 10n, U64_MAX]) {
      if (total < BigInt(count)) { assert.throws(() => equalShares(total, count)); continue; }
      const shares = equalShares(total, count);
      const base = total / BigInt(count);
      const remainder = Number(total % BigInt(count));
      assert.equal(shares.length, count);
      assert.equal(shares.reduce((sum, value) => sum + value, 0n), total);
      assert.deepEqual(shares, Array.from({ length: count }, (_, slot) => base + (slot < remainder ? 1n : 0n)));
      const plan = createPaymentPlan(planInput(count, total));
      assert.deepEqual(plan.contributions.map(payer => payer.units), shares);
      const message = decodedLegacy(await buildPaymentMessage(plan, lifetime));
      assert.deepEqual(message.instructions.slice(2).map(instruction => {
        if (!instruction.data) throw new Error('Expected transfer data');
        return getTransferCheckedInstructionDataDecoder().decode(instruction.data).amount;
      }), shares);
    }
    for (const total of [-1n, 0n, 1n, U64_MAX + 1n]) assert.throws(() => createPaymentPlan(planInput(count, total)));
  }
  for (const value of [1, 1.5, '10', null, undefined]) assert.throws(() => Reflect.apply(equalShares, undefined, [value, 2]));
  for (const count of [0, 1, 4, 2.5, '2']) assert.throws(() => Reflect.apply(equalShares, undefined, [10n, count]));
  for (const payers of [[], [planInput(2).payers[0]], [...planInput(3).payers, planInput(2).payers[0]]]) {
    assert.throws(() => Reflect.apply(createPaymentPlan, undefined, [{ ...planInput(2), payers }]));
  }
});

test('every duplicate wallet, source, seller, mint or token-program role is refused', () => {
  const valid = planInput(3);
  const existing = [valid.sellerWallet, valid.sellerTokenAccount, ...valid.payers.flatMap(payer => [payer.wallet, payer.sourceTokenAccount]), address(DEVNET_USDC), TOKEN_PROGRAM_ADDRESS];
  for (let target = 0; target < 8; target++) {
    for (const replacement of existing) {
      const input = planInput(3);
      const roles = [
        { value: input.sellerWallet, set: (value: Address) => { input.sellerWallet = value; } },
        { value: input.sellerTokenAccount, set: (value: Address) => { input.sellerTokenAccount = value; } },
        ...input.payers.flatMap(payer => [
          { value: payer.wallet, set: (value: Address) => { payer.wallet = value; } },
          { value: payer.sourceTokenAccount, set: (value: Address) => { payer.sourceTokenAccount = value; } },
        ]),
      ];
      const role = roles[target];
      if (!role || role.value === replacement) continue;
      role.set(replacement);
      assert.throws(() => createPaymentPlan(input), /Accounts must be distinct/);
    }
  }
  assert.throws(() => Reflect.apply(createPaymentPlan, undefined, [{ ...planInput(2), sellerWallet: 'invalid address' }]));
});

test('validated plans snapshot and freeze all caller-owned objects', async () => {
  const input = planInput(3);
  const plan = createPaymentPlan(input);
  const before = await buildPaymentMessage(plan, lifetime);
  input.totalUnits = 99n;
  input.sellerWallet = key(60);
  input.sellerTokenAccount = key(61);
  input.payers[0].wallet = key(62);
  input.payers[0].sourceTokenAccount = key(63);
  input.payers.reverse();
  assert.equal(plan.totalUnits, 10n);
  assert.deepEqual(plan.contributions.map(payer => payer.slot), [0, 1, 2]);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.contributions));
  assert.ok(plan.contributions.every(Object.isFrozen));
  assert.deepEqual(await buildPaymentMessage(plan, lifetime), before);
  assert.equal(Reflect.set(plan, 'totalUnits', 99n), false);
  assert.ok(plan.contributions.length === 3);
  assert.equal(Reflect.set(plan.contributions[2], 'units', 99n), false);
});

test('builder and inspector snapshot mutable inputs before their first asynchronous digest', async () => {
  const plan = createPaymentPlan(planInput(3));
  const mutableLifetime = { ...lifetime };
  const building = buildPaymentMessage(plan, mutableLifetime);
  mutableLifetime.blockhash = blockhash(key(70));
  mutableLifetime.lastValidBlockHeight = 0n;
  const original = await building;
  assert.equal(decodedLegacy(original).lifetimeToken, lifetime.blockhash);
  const candidate = { messageBytes: Uint8Array.from(original.messageBytes), transactionBytes: Uint8Array.from(original.transactionBytes), messageHash: original.messageHash };
  const expected = { plan, blockhash: lifetime.blockhash, messageHash: original.messageHash };
  const inspecting = inspectPaymentMessage(candidate, expected);
  candidate.messageBytes.fill(0);
  candidate.transactionBytes.fill(0);
  candidate.messageHash = '0'.repeat(64);
  expected.messageHash = '1'.repeat(64);
  expected.blockhash = blockhash(key(71));
  expected.plan = createPaymentPlan(planInput(2));
  const checked = await inspecting;
  assert.deepEqual(checked, original);
  Reflect.set(checked.messageBytes, '0', 0);
  Reflect.set(checked.transactionBytes, '0', 0);
  assert.notDeepEqual(checked.messageBytes, original.messageBytes);
  assert.notDeepEqual(checked.transactionBytes, original.transactionBytes);
});

test('message bytes bind the blockhash while expiry and attempt identity need future B1 metadata checks', async () => {
  const plan = createPaymentPlan(planInput(3));
  const first = await buildPaymentMessage(plan, lifetime);
  const second = await buildPaymentMessage(plan, { ...lifetime, lastValidBlockHeight: 101n });
  assert.deepEqual(first, second);
  const envelope = { ...first, attemptId: 'different-attempt', lastValidBlockHeight: 999n };
  assert.deepEqual(await inspectPaymentMessage(envelope, { plan, blockhash: lifetime.blockhash, messageHash: first.messageHash }), first);
  for (const lastValidBlockHeight of [-1n, U64_MAX + 1n]) await assert.rejects(buildPaymentMessage(plan, { ...lifetime, lastValidBlockHeight }));
  assert.deepEqual(await buildPaymentMessage(plan, { ...lifetime, lastValidBlockHeight: 0n }), first);
});
