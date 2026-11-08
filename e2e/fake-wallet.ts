import type { BrowserContext, Page } from "@playwright/test";
import { signBytes, signedTransaction, type KeyedPayer } from "../src/client/keyed-payment-fixture";

export type Prompt = "connect" | "signMessage" | "signTransaction";
type Seen = { readonly wallet: string; readonly prompt: Prompt | "signAndSend"; readonly account: string | null; readonly bytes: Uint8Array | null };

export type FakeWallet = {
  /** Every call the page made into a wallet, in order. */
  readonly seen: readonly Seen[];
  /** The next prompt of this kind throws `{ code: 4001 }` in the page. Every other prompt approves. */
  rejectNext(prompt: Prompt): void;
  /** Picks another account in the extension, which tells a connected page with a `change` event. */
  switchTo(page: Page, slot: number): Promise<void>;
};

/**
 * A Wallet Standard wallet in every page of `context`, registered the way P1 proved with Phantom
 * (spikes/payment-proof/test/invite-navigation.mjs). The keys stay in Node: the page asks Node to sign.
 * With `decoyFirst`, a capable wallet named Decoy registers before it.
 */
export async function installFakeWallet(
  context: BrowserContext,
  payers: readonly KeyedPayer[],
  options: { readonly decoyFirst?: boolean } = {},
): Promise<FakeWallet> {
  const seen: Seen[] = [];
  const rejections = new Set<Prompt>();
  await context.exposeFunction(
    "__onetabWallet",
    async (wallet: string, prompt: Prompt | "signAndSend", account: string | null, bytes: number[] | null) => {
      seen.push({ wallet, prompt, account, bytes: bytes && Uint8Array.from(bytes) });
      if (prompt === "signAndSend") return { reject: false };
      if (rejections.delete(prompt)) return { reject: true };
      const payer = payers.find((p) => p.address === account);
      if (prompt === "connect" || !payer || !bytes) return { reject: false };
      const signed = prompt === "signMessage" ? await signBytes(payer, Uint8Array.from(bytes)) : await signedTransaction(payer, Uint8Array.from(bytes));
      return { reject: false, bytes: [...signed] };
    },
  );
  const accounts = await Promise.all(
    payers.map(async (p) => ({ address: p.address, publicKey: [...new Uint8Array(await crypto.subtle.exportKey("raw", p.keys.publicKey))] })),
  );
  await context.addInitScript(walletInPage, { accounts, decoyFirst: options.decoyFirst === true });
  return {
    seen,
    rejectNext: (prompt) => void rejections.add(prompt),
    switchTo: (page, slot) => page.evaluate((index) => (window as unknown as { __onetabSwitch: (i: number) => void }).__onetabSwitch(index), slot),
  };
}

type InPage = { readonly accounts: readonly { readonly address: string; readonly publicKey: readonly number[] }[]; readonly decoyFirst: boolean };

/** Runs in the page before any of its scripts, so it can't close over anything in this file. */
function walletInPage({ accounts, decoyFirst }: InPage): void {
  type Answer = { readonly reject: boolean; readonly bytes?: readonly number[] };
  const ask = (window as unknown as { __onetabWallet: (...args: unknown[]) => Promise<Answer> }).__onetabWallet;
  const all = accounts.map((a) => ({
    address: a.address,
    publicKey: Uint8Array.from(a.publicKey),
    chains: ["solana:devnet"],
    features: ["solana:signMessage", "solana:signTransaction"],
  }));
  let current = 0;
  let granted: typeof all = [];
  const listeners = new Set<(properties: { accounts: typeof all }) => void>();

  const walletNamed = (name: string) => {
    const prompt = async (kind: string, account: { address: string } | null, bytes: Uint8Array | null) => {
      const answer = await ask(name, kind, account?.address ?? null, bytes ? [...bytes] : null);
      if (answer.reject) throw { code: 4001, message: "User rejected the request." };
      return Uint8Array.from(answer.bytes ?? []);
    };
    return {
      version: "1.0.0",
      name,
      icon: "data:image/svg+xml;base64,PHN2Zy8+",
      chains: ["solana:devnet", "solana:mainnet"],
      get accounts() {
        return name === "Phantom" ? granted : [];
      },
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => {
            await prompt("connect", null, null);
            granted = [all[current]!];
            return { accounts: granted };
          },
        },
        "standard:disconnect": {
          version: "1.0.0",
          disconnect: async () => {
            granted = [];
          },
        },
        "standard:events": {
          version: "1.0.0",
          on: (event: string, listener: (properties: { accounts: typeof all }) => void) => {
            if (event !== "change") return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        "solana:signMessage": {
          version: "1.1.0",
          signMessage: async (...inputs: { account: { address: string }; message: Uint8Array }[]) =>
            Promise.all(inputs.map(async ({ account, message }) => ({ signedMessage: message, signature: await prompt("signMessage", account, message) }))),
        },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs: { account: { address: string }; transaction: Uint8Array }[]) =>
            Promise.all(inputs.map(async ({ account, transaction }) => ({ signedTransaction: await prompt("signTransaction", account, transaction) }))),
        },
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signAndSendTransaction: async () => {
            await ask(name, "signAndSend", null, null);
            throw new Error("OneTab's browser must never ask a wallet to send");
          },
        },
      },
    };
  };

  (window as unknown as { __onetabSwitch: (index: number) => void }).__onetabSwitch = (index) => {
    current = index;
    if (granted.length === 0) return;
    granted = [all[index]!];
    for (const listener of listeners) listener({ accounts: granted });
  };
  const wallets = decoyFirst ? [walletNamed("Decoy"), walletNamed("Phantom")] : [walletNamed("Phantom")];
  const register = ({ register }: { register: (...w: unknown[]) => unknown }) => register(...wallets);
  window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent).detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}
