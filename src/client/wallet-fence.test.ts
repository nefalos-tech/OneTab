import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

const FENCES = {
  broadcast: "OneTab's browser only asks a wallet to approve. The server sends the one payment.",
  walletPackages: "Wallet packages stay in src/lib/wallet/",
  walletInternals: "Reach wallets through useWalletSession()",
  paymentsUpfront: "Browser code reaches Payments only through payment-check.ts",
} as const;

async function fenced(code: string, file: string, fence: keyof typeof FENCES): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath: `${process.cwd()}/${file}` });
  return result!.messages.some((m) => m.message.includes(FENCES[fence]));
}

const BROWSER = ["src/client/fence-probe.ts", "src/components/fence-probe.tsx", "src/app/fence-probe.tsx", "src/lib/wallet/fence-probe.ts"];
const NOT_WALLET = BROWSER.filter((file) => !file.startsWith("src/lib/wallet/"));

describe("the browser never sends a payment", () => {
  it.each([
    ["a string key", 'export const key = "solana:signAndSendTransaction";\n'],
    ["the all-transactions key", "export const key = 'solana:signAndSendAllTransactions';\n"],
    ["a template key", "export const key = `solana:signAndSendTransaction`;\n"],
    ["a feature lookup", 'declare const features: Record<string, unknown>;\nexport const f = features["solana:signAndSendTransaction"];\n'],
  ])("refuses %s for sign-and-send in browser code, checkout-view.ts included", async (_, code) => {
    for (const file of [...BROWSER, "src/client/checkout-view.ts", "src/components/wallet/wallet-scope.tsx", "src/lib/wallet/live.ts"]) {
      expect(await fenced(code, file, "broadcast"), file).toBe(true);
    }
  });

  it.each([
    ["the sign-and-send feature", 'import { SolanaSignAndSendTransaction } from "@solana/wallet-standard-features";\nexport const k = SolanaSignAndSendTransaction;\n'],
    ["an RPC client", 'import { createSolanaRpc } from "@solana/kit";\nexport const r = createSolanaRpc;\n'],
  ])("refuses an import of %s in browser code", async (_, code) => {
    for (const file of BROWSER) expect(await fenced(code, file, "broadcast"), file).toBe(true);
  });

  it("leaves the server and tests free to name it", async () => {
    const code = 'export const key = "solana:signAndSendTransaction";\n';
    expect(await fenced(code, "src/server/fence-probe.ts", "broadcast")).toBe(false);
    expect(await fenced(code, "src/lib/wallet/fence-probe.test.ts", "broadcast")).toBe(false);
  });
});

describe("wallet packages and the bridges stay in src/lib/wallet", () => {
  it.each([
    ["the umbrella package", 'import { getWallets } from "@solana/wallet-standard";\nexport const g = getWallets;\n'],
    ["the app package", 'import { getWallets } from "@wallet-standard/app";\nexport const g = getWallets;\n'],
  ])("refuses %s outside src/lib/wallet", async (_, code) => {
    for (const file of NOT_WALLET) expect(await fenced(code, file, "walletPackages"), file).toBe(true);
    expect(await fenced(code, "src/lib/wallet/fence-probe.ts", "walletPackages")).toBe(false);
  });

  it("refuses the Wallet Standard bridge outside the wallet scope, which reaches it only through live.ts", async () => {
    const code = 'import { standardBridge } from "@/lib/wallet/standard";\nexport const b = standardBridge;\n';
    for (const file of NOT_WALLET) expect(await fenced(code, file, "walletInternals"), file).toBe(true);
    expect(await fenced(code, "src/lib/wallet/live.ts", "walletInternals")).toBe(false);
  });
});

describe("Payments' code loads only when someone approves", () => {
  const value = 'import { toBase64 } from "@/lib/payments/signing-payload";\nexport const t = toBase64;\n';
  const relative = 'import { toBase64 } from "../lib/payments/signing-payload";\nexport const t = toBase64;\n';

  it("refuses a value import of Payments' code in browser code", async () => {
    for (const file of [...BROWSER, "src/client/payment-check.ts", "src/lib/wallet/live.ts", "src/components/wallet/wallet-scope.tsx"]) {
      expect(await fenced(value, file, "paymentsUpfront"), file).toBe(true);
    }
    expect(await fenced(relative, "src/client/fence-probe.ts", "paymentsUpfront")).toBe(true);
  });

  it("allows type imports, import(), tests, test fixtures and the server", async () => {
    const typeOnly = 'import type { ValidatedSigningPayload } from "@/lib/payments/signing-payload";\nexport type V = ValidatedSigningPayload;\n';
    const lazy = 'export const load = () => import("@/lib/payments/signing-payload");\n';
    expect(await fenced(typeOnly, "src/client/payment-check.ts", "paymentsUpfront")).toBe(false);
    expect(await fenced(lazy, "src/client/payment-check.ts", "paymentsUpfront")).toBe(false);
    for (const file of ["src/client/fence-probe.test.ts", "src/lib/wallet/fence-probe.test.ts", "src/client/keyed-payment-fixture.ts", "src/server/fence-probe.ts"]) {
      expect(await fenced(value, file, "paymentsUpfront"), file).toBe(false);
    }
  });
});
