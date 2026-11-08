import type { IdentifierString, Wallet, WalletAccount } from "@wallet-standard/base";
import type { StandardEventsChangeProperties } from "@wallet-standard/features";
import type {
  SolanaSignMessageInput,
  SolanaSignMessageOutput,
  SolanaSignTransactionInput,
  SolanaSignTransactionOutput,
} from "@solana/wallet-standard-features";
import { address, getAddressDecoder } from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { termsOf } from "@/client/checkout-view";
import type { Address, Session } from "@/client/contracts";
import { keyedPayment, signedTransaction, type KeyedPayer, type KeyedPayment } from "@/client/test-support/keyed-payment";
import { live, untracked, type LiveAction } from "@/client/live-actions";
import { checkPayment, walletRequest, type CheckedPayment } from "@/client/payment-check";
import { verifyPayerSignature } from "@/lib/payments/signature-core";
import { authMessage, type AuthMessage, type ChallengeId, type PaymentSigner, type SignInService, type WalletBridge } from "./environment";
import { initialState } from "./machine";
import { standardBridge, type WalletRegistry } from "./standard";
import { createSessionStore } from "./store";

type Keyed = WalletAccount & { readonly keys: CryptoKeyPair };
const SIGNS: readonly IdentifierString[] = ["solana:signMessage", "solana:signTransaction"];

async function accountOf(keys: CryptoKeyPair, features = SIGNS, chains: readonly IdentifierString[] = ["solana:devnet"]): Promise<Keyed> {
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return { address: getAddressDecoder().decode(publicKey), publicKey, chains, features, keys };
}

async function keyedAccount(features = SIGNS): Promise<Keyed> {
  return accountOf(await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]), features);
}

async function sign(account: Keyed, bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("Ed25519", account.keys.privateKey, Uint8Array.from(bytes)));
}

type Prompt = "connect" | "signMessage" | "signTransaction";
type Answer<I, O> = (input: I) => Promise<O>;
type WalletOptions = {
  /** Grants every account on connect, as some wallets do, instead of only the one picked in the extension. */
  readonly grantsAll?: boolean;
  /** Emits the current accounts to each new change listener, as some wallets do. */
  readonly announces?: boolean;
  readonly chains?: readonly IdentifierString[];
  readonly versions?: Partial<Record<string, string>>;
  readonly without?: readonly string[];
  readonly transactionVersions?: readonly ("legacy" | 0)[];
};

const sent: string[] = [];

/**
 * P1's synthetic wallet (spikes/payment-proof/test/wallet.test.ts) as a plain object, with signMessage added, real
 * Ed25519 keys, and a sign-and-send feature that records any call so afterEach can fail the test.
 */
function fakeWallet(name: string, accounts: readonly Keyed[], options: WalletOptions = {}) {
  let granted: readonly Keyed[] = [];
  let selected: readonly Keyed[] = accounts.slice(0, 1);
  const changeListeners = new Set<(properties: StandardEventsChangeProperties) => void>();
  const prompts: { readonly kind: Prompt; readonly input: unknown }[] = [];
  let disconnects = 0;
  const approve = {
    connect: async () => {
      granted = options.grantsAll ? accounts : selected;
      return { accounts: granted };
    },
    signMessage: async ({ account, message }: SolanaSignMessageInput): Promise<readonly SolanaSignMessageOutput[]> => [
      { signedMessage: message, signature: await sign(keyed(account), message) },
    ],
    signTransaction: async ({ account, transaction }: SolanaSignTransactionInput): Promise<readonly SolanaSignTransactionOutput[]> => [
      { signedTransaction: await signedTransaction(keyed(account) as Keyed & KeyedPayer, transaction) },
    ],
  };
  const answers = {
    connect: [] as Answer<void, { accounts: readonly WalletAccount[] }>[],
    signMessage: [] as Answer<SolanaSignMessageInput, readonly SolanaSignMessageOutput[]>[],
    signTransaction: [] as Answer<SolanaSignTransactionInput, readonly SolanaSignTransactionOutput[]>[],
  };
  let disconnectWith: () => Promise<void> = async () => {
    granted = [];
    emit({ accounts: granted });
  };

  const keyed = (account: WalletAccount): Keyed => {
    const found = accounts.find((a) => a.address === account.address);
    if (!found) throw new Error("The page asked the wallet to sign with an account it doesn't have");
    return found;
  };
  const emit = (properties: StandardEventsChangeProperties) => {
    for (const listener of changeListeners) listener(properties);
  };
  const version = (feature: string) => options.versions?.[feature] ?? "1.0.0";
  const features: Record<string, unknown> = {
    "standard:connect": {
      version: version("standard:connect"),
      connect: async () => {
        prompts.push({ kind: "connect", input: null });
        return (answers.connect.shift() ?? approve.connect)();
      },
    },
    "standard:events": {
      version: version("standard:events"),
      on: (_event: "change", listener: (properties: StandardEventsChangeProperties) => void) => {
        changeListeners.add(listener);
        if (options.announces) listener({ accounts: granted });
        return () => changeListeners.delete(listener);
      },
    },
    "standard:disconnect": {
      version: version("standard:disconnect"),
      disconnect: () => {
        disconnects += 1;
        return disconnectWith();
      },
    },
    "solana:signMessage": {
      version: version("solana:signMessage"),
      signMessage: async (...inputs: SolanaSignMessageInput[]) => {
        expect(inputs).toHaveLength(1);
        prompts.push({ kind: "signMessage", input: inputs[0] });
        return (answers.signMessage.shift() ?? approve.signMessage)(inputs[0]!);
      },
    },
    "solana:signTransaction": {
      version: version("solana:signTransaction"),
      supportedTransactionVersions: options.transactionVersions ?? ["legacy", 0],
      signTransaction: async (...inputs: SolanaSignTransactionInput[]) => {
        expect(inputs).toHaveLength(1);
        prompts.push({ kind: "signTransaction", input: inputs[0] });
        return (answers.signTransaction.shift() ?? approve.signTransaction)(inputs[0]!);
      },
    },
    "solana:signAndSendTransaction": {
      version: "1.0.0",
      supportedTransactionVersions: ["legacy", 0],
      signAndSendTransaction: async () => {
        sent.push(name);
        throw new Error("OneTab's browser must never ask a wallet to send");
      },
    },
  };
  for (const omitted of options.without ?? []) delete features[omitted];
  const wallet: Wallet = {
    version: "1.0.0",
    name,
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains: options.chains ?? ["solana:mainnet", "solana:devnet"],
    get accounts() {
      return granted;
    },
    features: features as Wallet["features"],
  };
  return {
    wallet,
    accounts,
    prompts: (kind?: Prompt) => prompts.filter((p) => kind === undefined || p.kind === kind),
    disconnects: () => disconnects,
    changeListeners: () => changeListeners.size,
    next<K extends Prompt>(kind: K, answer: (typeof answers)[K][number]) {
      (answers[kind] as (typeof answer)[]).push(answer);
    },
    approve,
    disconnectWith(call: () => Promise<void>) {
      disconnectWith = call;
    },
    /** What the person picks in the extension. A connected wallet also tells the page. */
    switchTo(index: number | null) {
      selected = index === null ? [] : [accounts[index]!];
      if (granted.length === 0) return;
      granted = selected;
      emit({ accounts: granted });
    },
    /** A switch the wallet makes without telling the page, as between its approval and the page's subscription. */
    switchQuietly(index: number) {
      selected = [accounts[index]!];
      granted = selected;
    },
    emit,
  };
}
type FakeWallet = ReturnType<typeof fakeWallet>;

function registryOf(...fakes: FakeWallet[]) {
  let registered = fakes.map((f) => f.wallet);
  const unregisterListeners = new Set<(...wallets: Wallet[]) => void>();
  const registry: ReturnType<WalletRegistry> = {
    get: () => registered,
    on: (event, listener) => {
      if (event !== "unregister") return () => {};
      unregisterListeners.add(listener);
      return () => unregisterListeners.delete(listener);
    },
  };
  return {
    bridge: standardBridge(() => registry),
    unregister(fake: FakeWallet) {
      registered = registered.filter((w) => w !== fake.wallet);
      for (const listener of unregisterListeners) listener(fake.wallet);
    },
    unregisterListeners: () => unregisterListeners.size,
  };
}

function heard(bridge: WalletBridge): (Address | null)[] {
  const reports: (Address | null)[] = [];
  bridge.onAccountChange((account) => reports.push(account));
  return reports;
}

const laterTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CHALLENGE: AuthMessage = authMessage(
  new TextEncoder().encode("OneTab sign-in\nOrigin: http://localhost:3101\nPurpose: authenticate\nChallenge: 7d1c\nExpires: 2026-11-08T12:00:00.000Z"),
)!;
const REJECTED = { code: 4001, message: "User rejected the request." };

async function twoAccounts() {
  return [await keyedAccount(), await keyedAccount()] as const;
}

async function connected(options: WalletOptions = {}) {
  const accounts = await twoAccounts();
  const phantom = fakeWallet("Phantom", accounts, options);
  const world = registryOf(phantom);
  const reports = heard(world.bridge);
  expect(await world.bridge.connect()).toEqual({ ok: true, value: accounts[0].address });
  return { ...world, phantom, accounts, reports };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(sent, "a wallet was asked to send").toEqual([]);
  sent.length = 0;
});

describe("connect", () => {
  it("answers no_wallet when no Solana wallet is registered", async () => {
    expect(await registryOf().bridge.connect()).toEqual({ ok: false, failure: "no_wallet" });
    const sui = fakeWallet("Sui wallet", await twoAccounts(), { chains: ["sui:mainnet"] });
    expect(await registryOf(sui).bridge.connect()).toEqual({ ok: false, failure: "no_wallet" });
    expect(sui.prompts()).toEqual([]);
  });

  it("chooses Phantom over a capable wallet registered before it", async () => {
    const decoy = fakeWallet("Decoy", await twoAccounts());
    const phantom = fakeWallet("Phantom", await twoAccounts());
    expect(await registryOf(decoy, phantom).bridge.connect()).toEqual({ ok: true, value: phantom.accounts[0]!.address });
    expect(decoy.prompts()).toEqual([]);
  });

  const failing = (wallet: Wallet, key: "chains" | "features" | "name"): Wallet =>
    Object.defineProperty({ ...wallet }, key, {
      get: () => {
        throw new Error("A broken wallet");
      },
    });
  const BROKEN: readonly [string, (wallet: Wallet) => Wallet][] = [
    ["chains that throw", (wallet) => failing(wallet, "chains")],
    ["no chains", (wallet) => ({ ...wallet, chains: undefined }) as unknown as Wallet],
    ["a chain that isn't a string", (wallet) => ({ ...wallet, chains: [42] }) as unknown as Wallet],
    ["features that throw", (wallet) => failing(wallet, "features")],
    ["no features", (wallet) => ({ ...wallet, features: null }) as unknown as Wallet],
    ["a name that throws", (wallet) => failing(wallet, "name")],
  ];

  it.each(BROKEN)("chooses Phantom when a wallet registered before it has %s", async (_, broken) => {
    const decoy = fakeWallet("Decoy", await twoAccounts());
    const phantom = fakeWallet("Phantom", await twoAccounts());
    expect(await registryOf({ ...decoy, wallet: broken(decoy.wallet) }, phantom).bridge.connect()).toEqual({ ok: true, value: phantom.accounts[0]!.address });
    expect(decoy.prompts()).toEqual([]);
  });

  it("answers no_wallet with no prompt when every registered wallet is broken", async () => {
    const wallets = await Promise.all(BROKEN.map(async ([name, broken]) => {
      const fake = fakeWallet(name, await twoAccounts());
      return { ...fake, wallet: broken(fake.wallet) };
    }));
    expect(await registryOf(...wallets).bridge.connect()).toEqual({ ok: false, failure: "no_wallet" });
    expect(wallets.flatMap((w) => w.prompts())).toEqual([]);
  });

  it("chooses the first capable wallet when Phantom can't sign in", async () => {
    const phantom = fakeWallet("Phantom", await twoAccounts(), { without: ["solana:signMessage"] });
    const other = fakeWallet("Other", await twoAccounts());
    expect(await registryOf(phantom, other).bridge.connect()).toEqual({ ok: true, value: other.accounts[0]!.address });
    expect(phantom.prompts()).toEqual([]);
  });

  it.each<[string, WalletOptions, string]>([
    ["no Devnet", { chains: ["solana:mainnet"] }, "wrong_network"],
    ["no signMessage", { without: ["solana:signMessage"] }, "cannot_sign"],
    ["no signTransaction", { without: ["solana:signTransaction"] }, "cannot_sign"],
    ["no legacy transactions", { transactionVersions: [0] }, "cannot_sign"],
    ["no account events", { without: ["standard:events"] }, "cannot_sign"],
    ["connect at 2.0.0", { versions: { "standard:connect": "2.0.0" } }, "cannot_sign"],
    ["signTransaction at 1.1.0", { versions: { "solana:signTransaction": "1.1.0" } }, "cannot_sign"],
    ["signMessage at 2.0.0", { versions: { "solana:signMessage": "2.0.0" } }, "cannot_sign"],
  ])("refuses a wallet with %s as %s, with no prompt", async (_, options, failure) => {
    const phantom = fakeWallet("Phantom", await twoAccounts(), options);
    expect(await registryOf(phantom).bridge.connect()).toEqual({ ok: false, failure });
    expect(phantom.prompts()).toEqual([]);
  });

  it("accepts signMessage at 1.1.0 and a wallet without disconnect", async () => {
    const phantom = fakeWallet("Phantom", await twoAccounts(), { versions: { "solana:signMessage": "1.1.0" }, without: ["standard:disconnect"] });
    expect((await registryOf(phantom).bridge.connect()).ok).toBe(true);
  });

  it("answers wrong_network when one wallet is short only of Devnet, and cannot_sign otherwise", async () => {
    const mainnetOnly = fakeWallet("Other", await twoAccounts(), { chains: ["solana:mainnet"] });
    const phantomNoSign = fakeWallet("Phantom", await twoAccounts(), { without: ["solana:signMessage"] });
    expect(await registryOf(phantomNoSign, mainnetOnly).bridge.connect()).toEqual({ ok: false, failure: "wrong_network" });
    const noTransactions = fakeWallet("Other", await twoAccounts(), { without: ["solana:signTransaction"] });
    expect(await registryOf(phantomNoSign, noTransactions).bridge.connect()).toEqual({ ok: false, failure: "cannot_sign" });
  });

  it.each<[string, () => Promise<never>, string]>([
    ["a 4001", async () => Promise.reject(REJECTED), "rejected"],
    ["another provider error", async () => Promise.reject(new Error("Extension context invalidated")), "failed"],
    ["a 4001-looking string", async () => Promise.reject("4001"), "failed"],
  ])("answers %s from the connect prompt as %s", async (_, answer, failure) => {
    const phantom = fakeWallet("Phantom", await twoAccounts());
    phantom.next("connect", answer);
    expect(await registryOf(phantom).bridge.connect()).toEqual({ ok: false, failure });
  });

  it("answers failed, and never throws, when the wallet throws synchronously", async () => {
    const phantom = fakeWallet("Phantom", await twoAccounts());
    (phantom.wallet.features["standard:connect"] as { connect: () => never }).connect = () => {
      throw new Error("sync");
    };
    expect(await registryOf(phantom).bridge.connect()).toEqual({ ok: false, failure: "failed" });
  });

  it("refuses an account whose public key isn't its address", async () => {
    const [mine, other] = await twoAccounts();
    const forged: Keyed = { ...mine, publicKey: other.publicKey };
    expect(await registryOf(fakeWallet("Phantom", [forged])).bridge.connect()).toEqual({ ok: false, failure: "failed" });
  });

  it("answers the account the wallet holds after a switch between its approval and the subscription", async () => {
    const accounts = await twoAccounts();
    const phantom = fakeWallet("Phantom", accounts);
    phantom.next("connect", async () => {
      const answer = await phantom.approve.connect();
      phantom.switchQuietly(1);
      return answer;
    });
    const { bridge } = registryOf(phantom);
    const reports = heard(bridge);
    expect(await bridge.connect()).toEqual({ ok: true, value: accounts[1].address });
    await laterTask();
    expect(reports).toEqual([]);
  });

  it("answers failed and keeps no connection when the wallet unregisters inside its connect answer", async () => {
    const accounts = await twoAccounts();
    const phantom = fakeWallet("Phantom", accounts);
    const world = registryOf(phantom);
    const reports = heard(world.bridge);
    phantom.next("connect", async () => {
      const answer = await phantom.approve.connect();
      world.unregister(phantom);
      return answer;
    });
    expect(await world.bridge.connect()).toEqual({ ok: false, failure: "failed" });
    expect(phantom.changeListeners()).toBe(0);
    expect(world.unregisterListeners()).toBe(0);
    expect(await world.bridge.signAuthentication({ account: accounts[0].address as Address, message: CHALLENGE })).toEqual({ ok: false, failure: "failed" });
    expect(phantom.prompts("signMessage")).toEqual([]);
    await laterTask();
    expect(reports).toEqual([]);
  });

  it("leaves nothing behind from a connect the page cancelled, whenever it resolves", async () => {
    const accounts = await twoAccounts();
    const phantom = fakeWallet("Phantom", accounts);
    const world = registryOf(phantom);
    const reports = heard(world.bridge);

    const first = deferred<{ accounts: readonly WalletAccount[] }>();
    phantom.next("connect", () => first.promise);
    const cancelled = world.bridge.connect();
    const again = world.bridge.connect();
    first.resolve(await phantom.approve.connect());
    expect(await cancelled).toEqual({ ok: false, failure: "failed" });
    expect(await again).toEqual({ ok: true, value: accounts[0].address });
    expect(phantom.changeListeners()).toBe(1);
    expect(world.unregisterListeners()).toBe(1);

    const late = deferred<{ accounts: readonly WalletAccount[] }>();
    phantom.next("connect", () => late.promise);
    const stillOpen = world.bridge.connect();
    expect(phantom.changeListeners(), "a new connect drops the old subscription first").toBe(0);
    late.resolve(await phantom.approve.connect());
    expect((await stillOpen).ok).toBe(true);
    expect(await world.bridge.connect()).toEqual({ ok: true, value: accounts[0].address });
    expect(phantom.changeListeners()).toBe(1);

    phantom.switchTo(1);
    await laterTask();
    expect(reports).toEqual([accounts[1].address]);
  });
});

describe("account changes", () => {
  it("reports a switch once, on a later task, after the connect answer", async () => {
    const { phantom, accounts, reports } = await connected();
    phantom.switchTo(1);
    expect(reports, "not in the same task as the wallet's event").toEqual([]);
    await laterTask();
    expect(reports).toEqual([accounts[1].address]);
  });

  it("reports nothing for a wallet that announces its account as the page subscribes", async () => {
    const { reports } = await connected({ announces: true });
    await laterTask();
    expect(reports).toEqual([]);
  });

  it("reports nothing for a same-address change or a chains-only change", async () => {
    const { phantom, reports } = await connected();
    phantom.switchTo(0);
    phantom.emit({ chains: ["solana:mainnet"] });
    phantom.emit({ features: {} });
    await laterTask();
    expect(reports).toEqual([]);
  });

  it("reports a switch away and back as two changes", async () => {
    const { phantom, accounts, reports } = await connected();
    phantom.switchTo(1);
    phantom.switchTo(0);
    await laterTask();
    expect(reports).toEqual([accounts[1].address, accounts[0].address]);
  });

  it("reports null when the wallet drops every account, or unregisters", async () => {
    const dropped = await connected();
    dropped.phantom.switchTo(null);
    await laterTask();
    expect(dropped.reports).toEqual([null]);

    const gone = await connected();
    gone.unregister(gone.phantom);
    await laterTask();
    expect(gone.reports).toEqual([null]);
  });

  it("reports nothing after disconnect, even for an event already on its way", async () => {
    const { bridge, phantom, reports } = await connected();
    phantom.switchTo(1);
    await bridge.disconnect();
    phantom.switchTo(0);
    await laterTask();
    expect(reports).toEqual([]);
    expect(phantom.changeListeners()).toBe(0);
  });

  it("stops only the listener whose unsubscribe ran", async () => {
    const { bridge, phantom, accounts, reports } = await connected();
    const other: (Address | null)[] = [];
    const stop = bridge.onAccountChange((account) => other.push(account));
    stop();
    phantom.switchTo(1);
    await laterTask();
    expect(reports).toEqual([accounts[1].address]);
    expect(other).toEqual([]);
  });
});

describe("disconnect", () => {
  it("clears the connection first, then asks the wallet, and never throws", async () => {
    for (const fails of [async () => Promise.reject(new Error("async")), () => {
      throw new Error("sync");
    }]) {
      const { bridge, phantom, accounts } = await connected();
      phantom.disconnectWith(fails as () => Promise<void>);
      await expect(bridge.disconnect()).resolves.toBeUndefined();
      expect(phantom.disconnects()).toBe(1);
      expect(await bridge.signAuthentication({ account: accounts[0].address as Address, message: CHALLENGE })).toEqual({ ok: false, failure: "failed" });
      expect(phantom.prompts("signMessage")).toEqual([]);
    }
  });

  it("does nothing when nothing is connected", async () => {
    const phantom = fakeWallet("Phantom", await twoAccounts());
    await registryOf(phantom).bridge.disconnect();
    expect(phantom.disconnects()).toBe(0);
  });
});

describe("signAuthentication", () => {
  const asAccount = (account: Keyed) => account.address as Address;

  it("signs exactly the server's challenge and answers canonical base64 of a signature the server verifies", async () => {
    const { bridge, phantom, accounts } = await connected();
    const answer = await bridge.signAuthentication({ account: asAccount(accounts[0]), message: CHALLENGE });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const [prompt] = phantom.prompts("signMessage");
    const input = prompt!.input as SolanaSignMessageInput;
    expect(input.message).toEqual(CHALLENGE.bytes);
    expect(input.message, "a copy, so the wallet can't change the challenge").not.toBe(CHALLENGE.bytes);
    expect(input.account.address).toBe(accounts[0].address);
    expect(answer.value).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    const signature = Uint8Array.from(atob(answer.value), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify("Ed25519", accounts[0].keys.publicKey, signature, Uint8Array.from(CHALLENGE.bytes))).toBe(true);
  });

  it("refuses an account that isn't the selected one with no prompt", async () => {
    const { bridge, phantom, accounts } = await connected();
    expect(await bridge.signAuthentication({ account: asAccount(accounts[1]), message: CHALLENGE })).toEqual({ ok: false, failure: "failed" });
    expect(await registryOf(phantom).bridge.signAuthentication({ account: asAccount(accounts[0]), message: CHALLENGE })).toEqual({
      ok: false,
      failure: "failed",
    });
    expect(phantom.prompts("signMessage")).toEqual([]);
  });

  it("refuses, with no prompt, the selected address once its public key isn't that address", async () => {
    const { bridge, phantom, accounts } = await connected();
    Object.assign(accounts[0], { publicKey: (await keyedAccount()).publicKey });
    expect(await bridge.signAuthentication({ account: asAccount(accounts[0]), message: CHALLENGE })).toEqual({ ok: false, failure: "failed" });
    expect(phantom.prompts("signMessage")).toEqual([]);
  });

  it("refuses another account the wallet also granted, with no prompt", async () => {
    const { bridge, phantom, accounts } = await connected({ grantsAll: true });
    expect(await bridge.signAuthentication({ account: asAccount(accounts[1]), message: CHALLENGE })).toEqual({ ok: false, failure: "failed" });
    expect(phantom.prompts("signMessage")).toEqual([]);
  });

  it("signs as the account a reported switch selected", async () => {
    const { bridge, phantom, accounts } = await connected();
    phantom.switchTo(1);
    await laterTask();
    expect((await bridge.signAuthentication({ account: asAccount(accounts[1]), message: CHALLENGE })).ok).toBe(true);
    expect(await bridge.signAuthentication({ account: asAccount(accounts[0]), message: CHALLENGE })).toEqual({ ok: false, failure: "failed" });
    expect(phantom.prompts("signMessage")).toHaveLength(1);
  });

  it.each<[string, (account: Keyed, input: SolanaSignMessageInput) => Promise<readonly SolanaSignMessageOutput[]>, string]>([
    ["a 4001", async () => Promise.reject(REJECTED), "rejected"],
    ["another provider error", async () => Promise.reject(new Error("locked")), "failed"],
    [
      "a prefixed message",
      async (account, { message }) => {
        const prefixed = Uint8Array.from([...new TextEncoder().encode("Phantom: "), ...message]);
        return [{ signedMessage: prefixed, signature: await sign(account, prefixed) }];
      },
      "failed",
    ],
    [
      "a different signed message, even with a valid signature over the challenge",
      async (account, { message }) => [{ signedMessage: Uint8Array.from([...message, 10]), signature: await sign(account, message) }],
      "failed",
    ],
    ["a signature by another key", async (_, { message }) => [{ signedMessage: message, signature: await sign(await keyedAccount(), message) }], "failed"],
    ["a 63-byte signature", async (account, { message }) => [{ signedMessage: message, signature: (await sign(account, message)).slice(1) }], "failed"],
    [
      "a signature that reads as other bytes the first time",
      async (account, { message }) => {
        const signature = await sign(account, message);
        let reads = 0;
        return [
          Object.defineProperty({ signedMessage: message }, "signature", {
            enumerable: true,
            get: () => (++reads === 1 ? new Uint8Array(64).fill(7) : signature),
          }) as SolanaSignMessageOutput,
        ];
      },
      "failed",
    ],
    [
      "a signature type other than ed25519",
      async (account, { message }) => [{ signedMessage: message, signature: await sign(account, message), signatureType: "secp256k1" as "ed25519" }],
      "failed",
    ],
    ["no output", async () => [], "failed"],
    [
      "two outputs",
      async (account, { message }) => {
        const output = { signedMessage: message, signature: await sign(account, message) };
        return [output, output];
      },
      "failed",
    ],
  ])("answers %s as %s", async (_, answer, failure) => {
    const { bridge, phantom, accounts } = await connected();
    phantom.next("signMessage", (input) => answer(accounts[0], input));
    expect(await bridge.signAuthentication({ account: asAccount(accounts[0]), message: CHALLENGE })).toEqual({ ok: false, failure });
  });

  it("answers failed when the wallet switches during the prompt, even if it approves, and even for a 4001", async () => {
    for (const outcome of ["approve", "reject"] as const) {
      const { bridge, phantom, accounts } = await connected();
      const prompt = deferred<readonly SolanaSignMessageOutput[]>();
      phantom.next("signMessage", () => prompt.promise);
      const answer = bridge.signAuthentication({ account: asAccount(accounts[0]), message: CHALLENGE });
      await vi.waitFor(() => expect(phantom.prompts("signMessage")).toHaveLength(1));
      phantom.switchTo(1);
      if (outcome === "approve") prompt.resolve(await phantom.approve.signMessage({ account: accounts[0], message: CHALLENGE.bytes }));
      else prompt.reject(REJECTED);
      expect(await answer, outcome).toEqual({ ok: false, failure: "failed" });
    }
  });

  it("opens no prompt when the wallet switches while the key is being imported", async () => {
    const { bridge, phantom, accounts } = await connected();
    const importKey = crypto.subtle.importKey.bind(crypto.subtle);
    const imported = deferred<void>();
    vi.spyOn(crypto.subtle, "importKey").mockImplementation(async (...args: Parameters<typeof importKey>) => {
      await imported.promise;
      return importKey(...args);
    });
    const answer = bridge.signAuthentication({ account: asAccount(accounts[0]), message: CHALLENGE });
    phantom.switchTo(1);
    imported.resolve();
    expect(await answer).toEqual({ ok: false, failure: "failed" });
    expect(phantom.prompts("signMessage")).toEqual([]);
  });

  it("answers cannot_sign with no prompt when the account can't sign messages", async () => {
    const plain = await keyedAccount(["solana:signTransaction"]);
    const phantom = fakeWallet("Phantom", [plain]);
    const { bridge } = registryOf(phantom);
    expect((await bridge.connect()).ok).toBe(true);
    expect(await bridge.signAuthentication({ account: asAccount(plain), message: CHALLENGE })).toEqual({ ok: false, failure: "cannot_sign" });
    expect(phantom.prompts("signMessage")).toEqual([]);
  });

  it("answers cannot_sign with no prompt when this browser can't verify Ed25519", async () => {
    const { bridge, phantom, accounts } = await connected();
    vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(new DOMException("Unrecognized name.", "NotSupportedError"));
    expect(await bridge.signAuthentication({ account: asAccount(accounts[0]), message: CHALLENGE })).toEqual({ ok: false, failure: "cannot_sign" });
    expect(phantom.prompts("signMessage")).toEqual([]);
  });
});

describe("signPayment", () => {
  const FAR = "2099-01-01T00:00:00.000Z";

  async function checkedFor(k: KeyedPayment, slot: number): Promise<CheckedPayment> {
    const result = await checkPayment.payload(k.payload, termsOf(k.room, { wallet: k.payers[slot]!.address, expiresAt: FAR })!, k.room);
    if (!result.ok) throw new Error(`The keyed payment didn't pass the check: ${result.failure}`);
    return result.value;
  }

  async function paying(account: (keys: CryptoKeyPair) => Promise<Keyed> = (keys) => accountOf(keys)) {
    const k = await keyedPayment();
    const accounts = [await account(k.payers[1]!.keys), await account(k.payers[2]!.keys)];
    const phantom = fakeWallet("Phantom", accounts);
    const world = registryOf(phantom);
    expect(await world.bridge.connect()).toEqual({ ok: true, value: k.payers[1]!.address });
    return { ...world, phantom, k, payment: await checkedFor(k, 1) };
  }

  it("asks the wallet once to approve exactly the checked bytes on Devnet, and answers a signature the server accepts", async () => {
    const { bridge, phantom, k, payment } = await paying();
    const answer = await bridge.signPayment(payment);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const [prompt, ...more] = phantom.prompts("signTransaction");
    expect(more).toEqual([]);
    const input = prompt!.input as SolanaSignTransactionInput;
    const validated = Uint8Array.from(k.validated.message.transactionBytes);
    expect(input).toEqual({ account: phantom.wallet.accounts[0], transaction: validated, chain: "solana:devnet", options: { preflightCommitment: "confirmed" } });
    input.transaction.fill(0);
    expect(walletRequest(payment)!.transaction, "a copy, so the wallet can't change the checked bytes").toEqual(validated);
    expect(answer.value).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    const signatureBytes = Uint8Array.from(atob(answer.value), (c) => c.charCodeAt(0));
    await expect(verifyPayerSignature(k.validated, { wallet: address(k.payers[1]!.address), signatureBytes })).resolves.toBeTruthy();
  });

  it.each<[string, (k: KeyedPayment, input: SolanaSignTransactionInput) => Promise<readonly SolanaSignTransactionOutput[]>, string]>([
    ["a 4001", async () => Promise.reject(REJECTED), "rejected"],
    ["another provider error", async () => Promise.reject(new Error("Transaction simulation failed")), "failed"],
    [
      "a changed message",
      async (k, { transaction }) => {
        const changed = Uint8Array.from(transaction, (b, i) => (i === transaction.length - 1 ? b ^ 1 : b));
        return [{ signedTransaction: await signedTransaction(k.payers[1]!, changed) }];
      },
      "failed",
    ],
    [
      "another payer's signature beside the payer's",
      async (k, { transaction }) => [{ signedTransaction: await signedTransaction(k.payers[2]!, await signedTransaction(k.payers[1]!, transaction)) }],
      "failed",
    ],
    ["no output", async () => [], "failed"],
    [
      "two outputs",
      async (k, { transaction }) => {
        const output = { signedTransaction: await signedTransaction(k.payers[1]!, transaction) };
        return [output, output];
      },
      "failed",
    ],
  ])("answers %s as %s", async (_, answer, failure) => {
    const { bridge, phantom, k, payment } = await paying();
    phantom.next("signTransaction", (input) => answer(k, input));
    expect(await bridge.signPayment(payment)).toEqual({ ok: false, failure });
  });

  it("opens no prompt for a copy of a checked payment, so a copy can't change what the wallet is asked to sign", async () => {
    const { bridge, phantom, payment } = await paying();
    const other = await keyedPayment();
    const tampered = { ...payment, transaction: other.payload.transaction, signatureIn: async () => `${"A".repeat(86)}==` } as unknown as CheckedPayment;
    expect(await bridge.signPayment(tampered)).toEqual({ ok: false, failure: "failed" });
    expect(await bridge.signPayment({ ...payment })).toEqual({ ok: false, failure: "failed" });
    expect(phantom.prompts("signTransaction")).toEqual([]);
    expect((await bridge.signPayment(payment)).ok, "the payment the check made still opens a prompt").toBe(true);
  });

  it("refuses, with no prompt, a payment once the selected account's public key isn't its address", async () => {
    const { bridge, phantom, payment } = await paying();
    Object.assign(phantom.wallet.accounts[0]!, { publicKey: (await keyedAccount()).publicKey });
    expect(await bridge.signPayment(payment)).toEqual({ ok: false, failure: "failed" });
    expect(phantom.prompts("signTransaction")).toEqual([]);
  });

  it("refuses a payment for an account that isn't selected, with no prompt", async () => {
    const { bridge, phantom, k } = await paying();
    expect(await bridge.signPayment(await checkedFor(k, 2))).toEqual({ ok: false, failure: "failed" });
    expect(phantom.prompts("signTransaction")).toEqual([]);
  });

  it("answers failed when the wallet switches during the prompt, even if it approves, and even for a 4001", async () => {
    for (const outcome of ["approve", "reject"] as const) {
      const { bridge, phantom, payment } = await paying();
      const prompt = deferred<readonly SolanaSignTransactionOutput[]>();
      phantom.next("signTransaction", () => prompt.promise);
      const answer = bridge.signPayment(payment);
      await vi.waitFor(() => expect(phantom.prompts("signTransaction")).toHaveLength(1));
      phantom.switchTo(1);
      const [input] = phantom.prompts("signTransaction");
      if (outcome === "approve") prompt.resolve(await phantom.approve.signTransaction(input!.input as SolanaSignTransactionInput));
      else prompt.reject(REJECTED);
      expect(await answer, outcome).toEqual({ ok: false, failure: "failed" });
    }
  });

  it("answers cannot_sign with no prompt when the wallet stopped offering legacy transactions after connect", async () => {
    const { bridge, phantom, payment } = await paying();
    (phantom.wallet.features["solana:signTransaction"] as { supportedTransactionVersions: readonly (0 | "legacy")[] }).supportedTransactionVersions = [0];
    expect(await bridge.signPayment(payment)).toEqual({ ok: false, failure: "cannot_sign" });
    expect(phantom.prompts("signTransaction")).toEqual([]);
  });

  it.each<[string, (keys: CryptoKeyPair) => Promise<Keyed>, string]>([
    ["can't approve transactions", (keys) => accountOf(keys, ["solana:signMessage"]), "cannot_sign"],
    ["isn't on Devnet", (keys) => accountOf(keys, SIGNS, ["solana:mainnet"]), "wrong_network"],
  ])("answers an account that %s as %s, with no prompt", async (_, account, failure) => {
    const { bridge, phantom, payment } = await paying(account);
    expect(await bridge.signPayment(payment)).toEqual({ ok: false, failure });
    expect(phantom.prompts("signTransaction")).toEqual([]);
  });
});

describe("the real check, the session store and this bridge together", () => {
  it("sign in, then Approve through live actions, sends exactly the upload body the server accepts", async () => {
    const k = await keyedPayment();
    const payer = k.payers[1]!;
    const phantom = fakeWallet("Phantom", [await accountOf(payer.keys)]);
    const { bridge } = registryOf(phantom);
    const session: Session = { wallet: payer.address, expiresAt: "2099-01-01T00:00:00.000Z" };
    const verified: string[] = [];
    const service: SignInService = {
      readSession: async () => ({ ok: true, value: null }),
      requestChallenge: async () => ({ ok: true, value: { id: "c-1" as ChallengeId, message: CHALLENGE } }),
      verify: async ({ signature }) => {
        const bytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
        const ok = await crypto.subtle.verify("Ed25519", payer.keys.publicKey, bytes, Uint8Array.from(CHALLENGE.bytes));
        verified.push(signature);
        return ok ? { ok: true, value: session } : { ok: false, failure: "unavailable" };
      },
      endSession: async () => {},
    };
    const store = createSessionStore({ bridge, service }, initialState({ account: null, session: null }));
    store.start();
    store.send({ type: "connect" });
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ kind: "signed_in", account: payer.address }));
    expect(verified).toHaveLength(1);

    const attempt = k.wireRoom.attempt!;
    const approved = { ...k.wireRoom, attempt: { ...attempt, signedWallets: [payer.address] } };
    const uploads: unknown[] = [];
    const answer = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
      const route = `${init.method} ${path}`;
      if (route === `GET /api/attempts/${attempt.id}/signing-payload`) return answer(k.wirePayload);
      if (route === `GET /api/checkouts/${k.wireRoom.checkout.id}`) return answer(uploads.length === 0 ? k.wireRoom : approved);
      if (route !== `POST /api/attempts/${attempt.id}/signatures`) throw new Error(`Unexpected request ${route}`);
      uploads.push(JSON.parse(String(init.body)));
      return answer(approved.attempt);
    });
    const { gen } = store.getSnapshot();
    const signer: PaymentSigner = {
      keptOrNewApproval: (payment) => store.keptOrNewApproval(gen, payment),
      forget: (approval) => store.forgetApproval(gen, approval),
      isCurrent: (payment) => store.isCurrent(gen, payment.account),
    };
    const approve: LiveAction = { kind: "approve", terms: termsOf(k.room, session)! };
    expect(await live.run(approve, { track: untracked, signer })).toEqual({ kind: "done" });

    expect(uploads).toEqual([{ messageHash: k.wirePayload.messageHash, signatureBase64: expect.stringMatching(/^[A-Za-z0-9+/]{86}==$/) }]);
    const { signatureBase64 } = uploads[0] as { readonly signatureBase64: string };
    const signatureBytes = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
    await expect(verifyPayerSignature(k.validated, { wallet: address(payer.address), signatureBytes })).resolves.toBeTruthy();
    expect(phantom.prompts().map((p) => p.kind)).toEqual(["connect", "signMessage", "signTransaction"]);
  });
});
