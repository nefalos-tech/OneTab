import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const WIRE_AND_SAMPLES = [
  "@/client/contracts",
  "@/client/fixture-data",
  "@/client/fixtures",
  "**/client/contracts",
  "**/client/fixture-data",
  "**/client/fixtures",
  "@/contracts",
  "@/contracts/*",
  "@/fixtures",
  "@/fixtures/*",
];
const SERVER = ["@/server", "@/server/*", "**/src/server", "**/src/server/*", "../server", "../server/*", "../../server/*"];

const WALLET_INTERNALS = [
  "@/lib/wallet/live",
  "@/lib/wallet/sample",
  "@/lib/wallet/store",
  "**/lib/wallet/live",
  "**/lib/wallet/sample",
  "**/lib/wallet/store",
];
const WALLET_STANDARD = ["@wallet-standard/*", "@solana/wallet-standard-*", "@solana/wallet-adapter-*"];

const NO_SERVER = { group: SERVER, message: "Browser and page code never imports src/server." };
const NO_WALLET_INTERNALS = {
  group: WALLET_INTERNALS,
  allowTypeImports: true,
  message: "Reach wallets through useWalletSession() from @/components/wallet/wallet-scope.",
};
const NO_WALLET_STANDARD = {
  group: WALLET_STANDARD,
  message: "Wallet packages stay in src/lib/wallet/, behind the WalletBridge seam in live.ts.",
};
const NO_API_CLIENT = {
  group: ["@/client/api", "**/client/api"],
  message: "Only src/client and the live sign-in client send requests. Components start them through @/client/live-actions, pages load through @/client/checkout-source.",
};
const COMPONENT_INPUTS = {
  group: [...WIRE_AND_SAMPLES, "@/client/checkout-source", "**/client/checkout-source"],
  message: "Components render views from @/client/checkout-view. Loading, wire types and samples stay in src/client.",
};
const PAGE_INPUTS = {
  group: WIRE_AND_SAMPLES,
  message: "Pages load data with @/client/checkout-source and render a screen component.",
};

/** A file matched by several blocks gets only the last block's patterns, so each block lists its full set. */
const restrict = (...patterns) => ({
  "@typescript-eslint/no-restricted-imports": ["error", { patterns: [NO_SERVER, ...patterns] }],
});

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".agents/**", ".local-setup/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "spikes/payment-proof/**"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, NO_API_CLIENT),
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    rules: restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD),
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, COMPONENT_INPUTS, NO_API_CLIENT),
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, PAGE_INPUTS, NO_API_CLIENT),
  },
  {
    files: ["src/app/api/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [NO_WALLET_INTERNALS, NO_WALLET_STANDARD, NO_API_CLIENT] }],
    },
  },
  {
    files: ["src/components/wallet/wallet-scope.tsx"],
    rules: restrict(NO_WALLET_STANDARD, COMPONENT_INPUTS, NO_API_CLIENT),
  },
  {
    files: ["src/lib/wallet/**/*.{ts,tsx}"],
    rules: restrict(NO_API_CLIENT),
  },
  {
    files: ["src/lib/wallet/live.ts"],
    rules: restrict(),
  },
  {
    files: ["src/client/catalog.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*", "./*", "../*"],
              allowTypeImports: true,
              message: "scripts/design-system.mjs loads catalog.ts under plain Node. Use `import type` only.",
            },
          ],
        },
      ],
    },
  },
]);
