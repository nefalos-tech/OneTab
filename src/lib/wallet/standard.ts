import type { Wallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignMessageFeature,
  type SolanaSignMessageOutput,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionOutput,
} from "@solana/wallet-standard-features";
import { getAddressDecoder } from "@solana/kit";
import type { Address } from "@/client/contracts";
import type { CheckedPayment } from "@/client/payment-check";
import {
  capabilityFailure,
  signatureBase64,
  type AuthMessage,
  type BridgeFailure,
  type BridgeResult,
  type Result,
  type SignatureBase64,
  type WalletBridge,
} from "./environment";

/**
 * Wallet discovery. live.ts passes `getWallets` uncalled, because building the bridge also runs during server
 * rendering, where the registry must not be created.
 */
export type WalletRegistry = () => Pick<Wallets, "get" | "on">;

type Features = StandardConnectFeature &
  StandardEventsFeature &
  StandardDisconnectFeature &
  SolanaSignMessageFeature &
  SolanaSignTransactionFeature;
type FeatureName = keyof Features;

/**
 * The versions this bridge accepts, and the method each feature must have. P1 proved 1.0.0 of each with
 * Phantom. signMessage 1.1.0 is the other version @solana/wallet-standard-features declares.
 */
const FEATURES: { readonly [F in FeatureName]: { readonly versions: readonly string[]; readonly method: string } } = {
  [StandardConnect]: { versions: ["1.0.0"], method: "connect" },
  [StandardEvents]: { versions: ["1.0.0"], method: "on" },
  [StandardDisconnect]: { versions: ["1.0.0"], method: "disconnect" },
  [SolanaSignTransaction]: { versions: ["1.0.0"], method: "signTransaction" },
  [SolanaSignMessage]: { versions: ["1.0.0", "1.1.0"], method: "signMessage" },
};

const DEVNET = "solana:devnet";
/** The wallet P1 proved and the words name, so another installed wallet can't take the demo. */
const PREFERRED = "Phantom";

const FAILED = { ok: false, failure: "failed" } as const;
const CANNOT_SIGN = { ok: false, failure: "cannot_sign" } as const;

/** One wallet's connection. `selected` is the address `connect` returned or the bridge last saw, null once none is. */
type Connection = { readonly wallet: Wallet; selected: Address | null; stop: () => void };

/** The selected account's live object, looked up by address and key, never by identity. */
type Held = { readonly wallet: Wallet; readonly account: WalletAccount };

export function standardBridge(registry: WalletRegistry): WalletBridge {
  let connection: Connection | null = null;
  /** What listeners last heard, so a same-address change is never reported twice in a row. */
  let reported: Address | null = null;
  /** Moves on every connect, disconnect and selection change. A prompt's answer counts only if it didn't move. */
  let version = 0;
  const listeners = new Set<(account: Address | null) => void>();

  function end(): void {
    const ended = connection;
    connection = null;
    reported = null;
    version += 1;
    ended?.stop();
  }

  /**
   * Updates the selection at once, so a prompt for the old address is refused, and tells listeners on a later
   * task, because the machine drops a change that lands while it is still taking connect's answer.
   */
  function select(of: Connection, next: Address | null): void {
    if (connection !== of || of.selected === next) return;
    version += 1;
    of.selected = next;
    setTimeout(() => {
      if (connection !== of || next === reported) return;
      reported = next;
      for (const listener of listeners) listener(next);
    }, 0);
  }

  function subscribe(of: Connection): () => void {
    const offChange = feature(of.wallet, StandardEvents)!.on("change", ({ accounts }) => {
      if (accounts) select(of, selectedIn(of.wallet));
    });
    const offUnregister = registry().on("unregister", (...gone) => {
      if (gone.includes(of.wallet)) select(of, null);
    });
    return () => {
      offChange();
      offUnregister();
    };
  }

  async function connect(): Promise<BridgeResult<Address>> {
    end();
    const started = version;
    const chosen = chooseWallet(registry().get());
    if (!chosen.ok) return chosen;
    const wallet = chosen.value;
    try {
      await feature(wallet, StandardConnect)!.connect();
    } catch (error) {
      return version === started ? failureOf(error) : FAILED;
    }
    if (version !== started) return FAILED;
    const of: Connection = { wallet, selected: null, stop: () => {} };
    connection = of;
    of.stop = subscribe(of);
    // Read after subscribing: a switch or an unregister between the approval and the subscription is this answer,
    // not a lost event.
    const selected = registry().get().includes(wallet) ? selectedIn(wallet) : null;
    if (selected === null) {
      end();
      return FAILED;
    }
    of.selected = selected;
    reported = selected;
    return { ok: true, value: selected };
  }

  async function disconnect(): Promise<void> {
    const wallet = connection?.wallet;
    end();
    const provider = wallet && feature(wallet, StandardDisconnect);
    if (provider) await provider.disconnect();
  }

  async function signAuthentication({ account, message }: { readonly account: Address; readonly message: AuthMessage }): Promise<BridgeResult<SignatureBase64>> {
    const started = version;
    const held = heldFor(account);
    if (held === null) return FAILED;
    const signer = feature(held.wallet, SolanaSignMessage);
    if (signer === null || !held.account.features.includes(SolanaSignMessage)) return CANNOT_SIGN;
    const key = await verifierFor(held.account.publicKey);
    if (key === null) return CANNOT_SIGN;
    if (version !== started) return FAILED;
    let outputs: readonly SolanaSignMessageOutput[];
    try {
      outputs = await signer.signMessage({ account: held.account, message: Uint8Array.from(message.bytes) });
    } catch (error) {
      return version === started ? failureOf(error) : FAILED;
    }
    if (version !== started || outputs.length !== 1) return FAILED;
    const [output] = outputs;
    if (!output) return FAILED;
    // One copy of each, because a wallet's output can answer other bytes on each read.
    const signed = Uint8Array.from(output.signedMessage);
    const signature = Uint8Array.from(output.signature);
    // A wallet may prefix the message it signs, and the server verifies only the bytes it issued.
    if (!sameBytes(signed, message.bytes) || (output.signatureType ?? "ed25519") !== "ed25519") return FAILED;
    const encoded = signatureBase64(signature);
    return encoded !== null && (await verifies(key, signature, message.bytes)) ? { ok: true, value: encoded } : FAILED;
  }

  async function signPayment(payment: CheckedPayment): Promise<BridgeResult<SignatureBase64>> {
    const started = version;
    const held = heldFor(payment.account);
    if (held === null) return FAILED;
    const signer = feature(held.wallet, SolanaSignTransaction);
    if (signer === null || !signer.supportedTransactionVersions.includes("legacy") || !held.account.features.includes(SolanaSignTransaction)) {
      return CANNOT_SIGN;
    }
    if (!held.account.chains.includes(DEVNET)) return { ok: false, failure: "wrong_network" };
    let outputs: readonly SolanaSignTransactionOutput[];
    try {
      outputs = await signer.signTransaction({
        account: held.account,
        transaction: Uint8Array.from(payment.transaction),
        chain: DEVNET,
        options: { preflightCommitment: "confirmed" },
      });
    } catch (error) {
      return version === started ? failureOf(error) : FAILED;
    }
    if (outputs.length !== 1) return FAILED;
    const signature = await payment.signatureIn(outputs[0]!.signedTransaction);
    return signature !== null && version === started ? { ok: true, value: signature } : FAILED;
  }

  function heldFor(wanted: Address): Held | null {
    if (connection === null || connection.selected !== wanted) return null;
    const account = connection.wallet.accounts.find((a) => a.address === wanted && addressOf(a) === wanted);
    return account ? { wallet: connection.wallet, account } : null;
  }

  return {
    connect: () => settled(connect, FAILED),
    disconnect: () => settled(disconnect, undefined),
    signAuthentication: (input) => settled(() => signAuthentication(input), FAILED),
    signPayment: (payment) => settled(() => signPayment(payment), FAILED),
    onAccountChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A registered Solana wallet, read once. */
type Candidate = { readonly wallet: Wallet; readonly phantom: boolean; readonly failure: "wrong_network" | "cannot_sign" | null };

/**
 * Phantom when it qualifies, else the first registered Solana wallet that does. With none: no Solana wallet is
 * `no_wallet`, one short only of Devnet is `wrong_network`, and anything else is `cannot_sign`.
 */
function chooseWallet(wallets: readonly Wallet[]): Result<Wallet, "no_wallet" | "wrong_network" | "cannot_sign"> {
  const solana = wallets.map(candidateOf).filter((c) => c !== null);
  const ordered = [...solana.filter((c) => c.phantom), ...solana.filter((c) => !c.phantom)];
  const usable = ordered.find((c) => c.failure === null);
  if (usable) return { ok: true, value: usable.wallet };
  if (ordered.length === 0) return { ok: false, failure: "no_wallet" };
  return { ok: false, failure: ordered.some((c) => c.failure === "wrong_network") ? "wrong_network" : "cannot_sign" };
}

/**
 * Null when the wallet isn't a Solana wallet. The registry accepts any object, so one whose fields throw or
 * don't parse counts as no wallet at all instead of failing the choice among the others.
 */
function candidateOf(wallet: Wallet): Candidate | null {
  try {
    const chains: unknown = wallet.chains;
    if (!Array.isArray(chains) || !chains.every((chain) => typeof chain === "string")) return null;
    if (!chains.some((chain) => chain.startsWith("solana:"))) return null;
    return { wallet, phantom: wallet.name === PREFERRED, failure: walletFailure(wallet, chains) };
  } catch {
    return null;
  }
}

function walletFailure(wallet: Wallet, chains: readonly string[]): "wrong_network" | "cannot_sign" | null {
  if (feature(wallet, StandardConnect) === null || feature(wallet, StandardEvents) === null) return "cannot_sign";
  return capabilityFailure({
    devnet: chains.includes(DEVNET),
    signMessage: feature(wallet, SolanaSignMessage) !== null,
    signTransaction: feature(wallet, SolanaSignTransaction)?.supportedTransactionVersions.includes("legacy") === true,
  });
}

/** The feature when the wallet has it at an accepted version with its method, else null. */
function feature<F extends FeatureName>(wallet: Wallet, name: F): Features[F] | null {
  const value: unknown = wallet.features[name];
  const { versions, method } = FEATURES[name];
  return typeof value === "object" &&
    value !== null &&
    "version" in value &&
    versions.includes(String(value.version)) &&
    typeof Reflect.get(value, method) === "function"
    ? (value as Features[F])
    : null;
}

function selectedIn(wallet: Wallet): Address | null {
  const first = wallet.accounts[0];
  return first ? addressOf(first) : null;
}

/** The account's address when its public key is that address, as P1 required. */
function addressOf(account: WalletAccount): Address | null {
  try {
    return account.publicKey.length === 32 && getAddressDecoder().decode(account.publicKey) === account.address
      ? (account.address as Address)
      : null;
  } catch {
    return null;
  }
}

/** Importing the key before any prompt keeps a browser that can't verify Ed25519 from asking the wallet at all. */
async function verifierFor(publicKey: WalletAccount["publicKey"]): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey("raw", Uint8Array.from(publicKey), "Ed25519", false, ["verify"]);
  } catch {
    return null;
  }
}

async function verifies(key: CryptoKey, signature: Uint8Array, bytes: Uint8Array): Promise<boolean> {
  try {
    return await crypto.subtle.verify("Ed25519", key, Uint8Array.from(signature), Uint8Array.from(bytes));
  } catch {
    return false;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** `rejected` only for the provider's 4001. Anything else is `failed`. */
function failureOf(error: unknown): { readonly ok: false; readonly failure: Extract<BridgeFailure, "rejected" | "failed"> } {
  return typeof error === "object" && error !== null && "code" in error && error.code === 4001 ? { ok: false, failure: "rejected" } : FAILED;
}

/** Wallets are other people's code. Whatever they throw, every bridge call still resolves. */
async function settled<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch {
    return fallback;
  }
}
