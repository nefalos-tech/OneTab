import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardEvents, type StandardConnectFeature, type StandardEventsFeature, type StandardEventsListeners } from '@wallet-standard/features';
import { SolanaSignTransaction, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import { AccountChanged, WalletRejected, WalletSession } from '../src/wallet.js';
import { syntheticFixture } from './fixtures.js';

async function syntheticWallet() {
  const fixture = await syntheticFixture();
  const accounts: WalletAccount[] = fixture.plan.contributions.map((payer, slot) => ({
    address: payer.wallet, publicKey: fixture.publicKey(slot === 0 ? 0 : 1),
    chains: ['solana:devnet'], features: [SolanaSignTransaction],
  }));
  let selected = accounts.slice(0, 1);
  let change: StandardEventsListeners['change'] = () => {};
  let calls = 0;
  let signer: () => Promise<Uint8Array> = async () => fixture.walletReturn(0);
  const wallet = {
    version: '1.0.0', name: 'Synthetic test-only wallet', icon: 'data:image/png;base64,',
    chains: ['solana:devnet'], get accounts() { return selected; },
    features: {
      [StandardConnect]: { version: '1.0.0', connect: async () => ({ accounts: selected }) },
      [StandardEvents]: { version: '1.0.0', on: (_event, listener) => { change = listener; return () => { change = () => {}; }; } },
      [SolanaSignTransaction]: {
        version: '1.0.0', supportedTransactionVersions: ['legacy'],
        signTransaction: async (...inputs) => {
          calls++;
          assert.equal(inputs.length, 1);
          assert.equal(inputs[0]?.chain, 'solana:devnet');
          return [{ signedTransaction: await signer() }];
        },
      },
    },
  } satisfies Wallet & { features: StandardConnectFeature & StandardEventsFeature & SolanaSignTransactionFeature };
  return {
    fixture, wallet, calls: () => calls,
    signWith: (operation: () => Promise<Uint8Array>) => { signer = operation; },
    switchTo: (slot: 0 | 1) => { selected = accounts.slice(slot, slot + 1); change({ accounts: selected }); },
  };
}

test('inspect-only connection exposes public capabilities without signing', async () => {
  const f = await syntheticWallet();
  const session = new WalletSession();
  await session.connect(f.wallet);
  assert.equal(session.inventory()?.account, f.fixture.plan.contributions[0].wallet);
  assert.equal(session.inventory()?.legacySignOnly, true);
  assert.equal(f.calls(), 0);
  session.clear();
  assert.equal(session.inventory(), null);
});

test('invalid payment and wrong account never reach a wallet prompt', async () => {
  const f = await syntheticWallet();
  const session = new WalletSession();
  await session.connect(f.wallet);
  await assert.rejects(session.sign({ ...f.fixture.payment, messageHash: '0'.repeat(64) }, 0, f.fixture.payment));
  await assert.rejects(session.sign(f.fixture.payment, 1, f.fixture.payment));
  assert.equal(f.calls(), 0);
  const approval = await session.sign(f.fixture.payment, 0, f.fixture.payment);
  assert.equal(approval.slot, 0);
  assert.equal(approval.messageHash, f.fixture.payment.messageHash);
  assert.equal(f.calls(), 1);
});

test('a rejected sign-only prompt is distinguishable and never becomes an approval', async () => {
  const f = await syntheticWallet();
  f.signWith(async () => { throw { code: 4001 }; });
  const session = new WalletSession();
  await session.connect(f.wallet);
  await assert.rejects(session.sign(f.fixture.payment, 0, f.fixture.payment), WalletRejected);
  assert.equal(f.calls(), 1);
});

test('provider failures are neutral errors and never described as a rejected approval', async () => {
  const f = await syntheticWallet();
  f.signWith(async () => { throw new Error('Synthetic provider failure'); });
  const session = new WalletSession(); await session.connect(f.wallet);
  await assert.rejects(session.sign(f.fixture.payment, 0, f.fixture.payment), error =>
    error instanceof Error && !(error instanceof WalletRejected) && !(error instanceof AccountChanged));
});

test('switching away and back invalidates an in-flight prompt generation', async () => {
  const f = await syntheticWallet();
  let release: () => void = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  f.signWith(async () => { await blocked; return f.fixture.walletReturn(0); });
  const session = new WalletSession();
  await session.connect(f.wallet);
  let uploads = 0;
  const signing = session.sign(f.fixture.payment, 0, f.fixture.payment).then(() => { uploads++; });
  await setImmediate();
  f.switchTo(1); f.switchTo(0); release();
  await assert.rejects(signing, AccountChanged);
  assert.equal(uploads, 0);
  assert.equal(session.inventory(), null);
  await session.connect(f.wallet);
  assert.equal((await session.sign(f.fixture.payment, 0, f.fixture.payment)).slot, 0);
});

test('clearing a local connection invalidates an in-flight sign-only result', async () => {
  const f = await syntheticWallet();
  let release: () => void = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  f.signWith(async () => { await blocked; return f.fixture.walletReturn(0); });
  const session = new WalletSession();
  await session.connect(f.wallet);
  const signing = session.sign(f.fixture.payment, 0, f.fixture.payment);
  await setImmediate(); session.clear(); release();
  await assert.rejects(signing, AccountChanged);
});
