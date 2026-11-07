import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents, type StandardConnectFeature, type StandardDisconnectFeature, type StandardEventsFeature } from '@wallet-standard/features';
import { SolanaSignTransaction, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import { address, getAddressEncoder } from '@solana/kit';
import { equalBytes, fromBase64, inspectPayment, verifyWalletReturn, type Plan, type Slot } from './payment.js';

type ConnectWallet = Wallet & { features: StandardConnectFeature & StandardEventsFeature };
type DisconnectWallet = Wallet & { features: StandardDisconnectFeature };
type SignWallet = ConnectWallet & { features: SolanaSignTransactionFeature };

function hasMethod(value: unknown, method: string): boolean {
  return typeof value === 'object' && value !== null && 'version' in value && value.version === '1.0.0'
    && method in value && typeof Reflect.get(value, method) === 'function';
}
export function canConnect(wallet: Wallet): wallet is ConnectWallet {
  return hasMethod(wallet.features[StandardConnect], 'connect') && hasMethod(wallet.features[StandardEvents], 'on');
}
function canDisconnect(wallet: Wallet): wallet is DisconnectWallet {
  return hasMethod(wallet.features[StandardDisconnect], 'disconnect');
}
export function canSign(wallet: Wallet): wallet is SignWallet {
  const feature = wallet.features[SolanaSignTransaction];
  return canConnect(wallet) && hasMethod(feature, 'signTransaction') && typeof feature === 'object' && feature !== null
    && 'supportedTransactionVersions' in feature && Array.isArray(feature.supportedTransactionVersions)
    && feature.supportedTransactionVersions.includes('legacy') && wallet.chains.includes('solana:devnet');
}
export class WalletRejected extends Error {}
export class AccountChanged extends Error {}

export class WalletSession {
  private generation = 0;
  private connected: { wallet: ConnectWallet; account: WalletAccount } | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly changed: () => void = () => {}) {}

  clear(): void {
    this.generation++;
    this.connected = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.changed();
  }

  async disconnect(wallet: Wallet): Promise<void> {
    this.clear();
    const generation = this.generation;
    if (!canDisconnect(wallet)) throw new Error('Wallet lacks standard:disconnect 1.0.0. Only the local connection was cleared.');
    try {
      await wallet.features[StandardDisconnect].disconnect();
    } catch {
      throw new Error('Wallet disconnect failed. The local connection was cleared. Provider disconnection was not confirmed.');
    }
    if (generation !== this.generation) throw new AccountChanged('Wallet connection changed while disconnecting. Connect again and check the account.');
  }

  async connect(wallet: Wallet, preferred?: string): Promise<void> {
    this.clear();
    const generation = this.generation;
    if (!canConnect(wallet)) throw new Error('Wallet lacks Standard connect or account-change events');
    const result = await wallet.features[StandardConnect].connect();
    if (generation !== this.generation) throw new AccountChanged('Wallet connection changed while connecting');
    const account = preferred ? result.accounts.find(value => value.address === preferred) : result.accounts[0];
    if (!account) throw new Error('Expected wallet account unavailable');
    if (!equalBytes(getAddressEncoder().encode(address(account.address)), account.publicKey)) throw new Error('Wallet public key mismatch');
    this.connected = { wallet, account };
    this.unsubscribe = wallet.features[StandardEvents].on('change', () => {
      this.generation++;
      this.connected = null;
      this.changed();
    });
    this.changed();
  }

  inventory() {
    if (!this.connected) return null;
    const { wallet, account } = this.connected;
    const feature = wallet.features[SolanaSignTransaction];
    return {
      walletName: wallet.name, standardVersion: wallet.version, account: account.address,
      walletChains: [...wallet.chains], accountChains: [...account.chains], accountFeatures: [...account.features],
      walletFeatures: Object.keys(wallet.features), legacySignOnly: canSign(wallet) && account.features.includes(SolanaSignTransaction)
        && account.chains.includes('solana:devnet'),
      signFeatureVersion: typeof feature === 'object' && feature !== null && 'version' in feature ? String(feature.version) : null,
      transactionVersions: typeof feature === 'object' && feature !== null && 'supportedTransactionVersions' in feature
        && Array.isArray(feature.supportedTransactionVersions) ? feature.supportedTransactionVersions.map(String) : [],
    };
  }

  async sign(input: unknown, slot: Slot, expected: { plan: Plan; planHash: string; messageHash: string }) {
    const connected = this.connected;
    const generation = this.generation;
    if (!connected || !canSign(connected.wallet)) throw new Error('No supported sign-only wallet connected');
    const { wallet, account } = connected;
    const payer = expected.plan.contributions[slot];
    if (account.address !== payer.wallet || !account.features.includes(SolanaSignTransaction)
      || !account.chains.includes('solana:devnet')) throw new Error('Connect the expected Devnet payer account');
    const payment = await inspectPayment(input, expected);
    this.assertCurrent(generation, wallet, account);
    let outputs;
    try {
      outputs = await wallet.features[SolanaSignTransaction].signTransaction({
        account, transaction: fromBase64(payment.transactionBase64), chain: 'solana:devnet',
        options: { preflightCommitment: 'confirmed' },
      });
    } catch (error) {
      this.assertCurrent(generation, wallet, account);
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) {
        throw new WalletRejected('Wallet reported rejection code 4001. Approval collection stopped.');
      }
      throw new Error('Sign-only approval failed. No approval was uploaded.');
    }
    this.assertCurrent(generation, wallet, account);
    if (outputs.length !== 1 || !outputs[0]) throw new Error('Unexpected wallet return');
    const approval = await verifyWalletReturn(payment, slot, outputs[0].signedTransaction);
    this.assertCurrent(generation, wallet, account);
    return approval;
  }

  private assertCurrent(generation: number, wallet: Wallet, account: WalletAccount): void {
    if (generation !== this.generation || this.connected?.wallet !== wallet || this.connected.account !== account
      || !wallet.accounts.some(value => value.address === account.address && equalBytes(value.publicKey, account.publicKey))) {
      throw new AccountChanged('Wallet changed during approval. Connect again before a new prompt.');
    }
  }
}
