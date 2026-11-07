import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents, type StandardConnectFeature, type StandardDisconnectFeature, type StandardEventsFeature, type StandardEventsListeners } from '@wallet-standard/features';
import { SolanaSignTransaction, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import { AccountChanged, WalletRejected, WalletSession } from '../src/wallet.js';
import { syntheticFixture } from './fixtures.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function syntheticWallet() {
  const fixture = await syntheticFixture();
  const accounts: WalletAccount[] = fixture.plan.contributions.map((payer, slot) => ({
    address: payer.wallet, publicKey: fixture.publicKey(slot === 0 ? 0 : 1),
    chains: ['solana:devnet'], features: [SolanaSignTransaction],
  }));
  let selected = accounts.slice(0, 1);
  let connectedAccounts: readonly WalletAccount[] = [];
  let change: StandardEventsListeners['change'] = () => {};
  let calls = 0;
  let disconnects = 0;
  let disconnect = async () => { connectedAccounts = []; change({ accounts: connectedAccounts }); };
  let signer: () => Promise<Uint8Array> = async () => fixture.walletReturn(0);
  const wallet = {
    version: '1.0.0', name: 'Synthetic test-only wallet', icon: 'data:image/png;base64,',
    chains: ['solana:devnet'], get accounts() { return connectedAccounts; },
    features: {
      [StandardConnect]: { version: '1.0.0', connect: async () => {
        if (!connectedAccounts.length) connectedAccounts = selected;
        return { accounts: connectedAccounts };
      } },
      [StandardDisconnect]: { version: '1.0.0', disconnect: async () => { disconnects++; await disconnect(); } },
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
  } satisfies Wallet & { features: StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & SolanaSignTransactionFeature };
  return {
    fixture, wallet, calls: () => calls, disconnects: () => disconnects,
    signWith: (operation: () => Promise<Uint8Array>) => { signer = operation; },
    disconnectWith: (operation: () => Promise<void>) => { disconnect = operation; },
    selectInExtension: (slot: 0 | 1) => { selected = accounts.slice(slot, slot + 1); },
    switchTo: (slot: 0 | 1) => {
      selected = accounts.slice(slot, slot + 1); connectedAccounts = selected; change({ accounts: connectedAccounts });
    },
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

test('explicit disconnect lets a stale provider connection use the selected payer after a failed preferred-account connect', async () => {
  const f = await syntheticWallet();
  const session = new WalletSession();
  await session.connect(f.wallet);
  f.selectInExtension(1);
  session.clear();
  await session.connect(f.wallet);
  assert.equal(session.inventory()?.account, f.fixture.plan.contributions[0].wallet);
  assert.equal(f.disconnects(), 0);
  await assert.rejects(session.connect(f.wallet, f.fixture.plan.contributions[1].wallet), /Expected wallet account unavailable/);
  assert.equal(session.inventory(), null);
  await session.disconnect(f.wallet);
  assert.equal(f.disconnects(), 1);
  assert.equal(session.inventory(), null);
  await session.connect(f.wallet, f.fixture.plan.contributions[1].wallet);
  assert.equal(session.inventory()?.account, f.fixture.plan.contributions[1].wallet);
  f.signWith(async () => f.fixture.walletReturn(1));
  assert.equal((await session.sign(f.fixture.payment, 1, f.fixture.payment)).slot, 1);
});

test('disconnect uses the selected registered wallet without a local session and leaves other wallets alone', async () => {
  const selected = await syntheticWallet();
  const other = await syntheticWallet();
  const otherSession = new WalletSession();
  await otherSession.connect(other.wallet);
  const session = new WalletSession();
  await session.disconnect(selected.wallet);
  assert.equal(selected.disconnects(), 1);
  assert.equal(other.disconnects(), 0);
  assert.equal(otherSession.inventory()?.account, other.fixture.plan.contributions[0].wallet);
});

test('missing or incompatible standard disconnect reports an error instead of successful provider disconnection', async () => {
  const f = await syntheticWallet();
  for (const feature of [undefined, { version: '2.0.0', disconnect: async () => {} }, { version: '1.0.0' }]) {
    const wallet = { ...f.wallet, features: { ...f.wallet.features, [StandardDisconnect]: feature } };
    const session = new WalletSession();
    await session.connect(wallet);
    await assert.rejects(session.disconnect(wallet), /standard:disconnect.*local connection was cleared/);
    assert.equal(session.inventory(), null);
  }
  assert.equal(f.disconnects(), 0);
});

test('provider disconnect failures clear local state and cannot claim successful provider disconnection', async () => {
  const f = await syntheticWallet();
  const session = new WalletSession();
  await session.connect(f.wallet);
  f.disconnectWith(async () => { throw new Error('Synthetic disconnect failure'); });
  await assert.rejects(session.disconnect(f.wallet), /disconnect failed.*not confirmed/);
  assert.equal(session.inventory(), null);
  f.selectInExtension(1);
  await session.connect(f.wallet);
  assert.equal(session.inventory()?.account, f.fixture.plan.contributions[0].wallet);
});

test('disconnect invalidates an in-flight approval before the provider completes cleanup', async () => {
  const f = await syntheticWallet();
  const session = new WalletSession();
  await session.connect(f.wallet);
  const promptStarted = deferred();
  const promptResult = deferred();
  const disconnectResult = deferred();
  f.signWith(async () => { promptStarted.resolve(); await promptResult.promise; return f.fixture.walletReturn(0); });
  f.disconnectWith(() => disconnectResult.promise);
  let uploads = 0;
  const signing = session.sign(f.fixture.payment, 0, f.fixture.payment).then(() => { uploads++; });
  await promptStarted.promise;
  const disconnecting = session.disconnect(f.wallet);
  assert.equal(session.inventory(), null);
  promptResult.resolve();
  await assert.rejects(signing, AccountChanged);
  assert.equal(uploads, 0);
  disconnectResult.resolve();
  await disconnecting;
});

test('disconnect invalidates a pending connect result', async () => {
  const f = await syntheticWallet();
  const connectResult = deferred();
  const wallet = { ...f.wallet, features: { ...f.wallet.features,
    [StandardConnect]: { version: '1.0.0', connect: async () => {
      await connectResult.promise;
      return f.wallet.features[StandardConnect].connect();
    } },
  } } satisfies Wallet & { features: StandardConnectFeature };
  const session = new WalletSession();
  const connecting = session.connect(wallet);
  await session.disconnect(wallet);
  connectResult.resolve();
  await assert.rejects(connecting, AccountChanged);
  assert.equal(session.inventory(), null);
});

test('a newer local connection prevents a stale disconnect completion from claiming success', async () => {
  const f = await syntheticWallet();
  const disconnectResult = deferred();
  f.disconnectWith(() => disconnectResult.promise);
  const session = new WalletSession();
  const disconnecting = session.disconnect(f.wallet);
  await session.connect(f.wallet);
  disconnectResult.resolve();
  await assert.rejects(disconnecting, AccountChanged);
  assert.equal(session.inventory()?.account, f.fixture.plan.contributions[0].wallet);
});
