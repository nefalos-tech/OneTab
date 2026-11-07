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
/** Any path to payment-check, however it is spelled: an extra `./`, a relative path or a file extension. */
const PAYMENT_CHECK_PATH = "(^|/)payment-check(\\.[cm]?[jt]sx?)?$";
const PAYMENT_CHECK_MESSAGE =
  "Approvals run through live.run in @/client/live-actions, which checks the payment before any wallet prompt.";
const NO_PAYMENT_CHECK = { regex: PAYMENT_CHECK_PATH, message: PAYMENT_CHECK_MESSAGE };
const NO_DYNAMIC_PAYMENT_CHECK = {
  "no-restricted-syntax": [
    "error",
    { selector: `ImportExpression[source.value=/${PAYMENT_CHECK_PATH.replaceAll("/", "\\/")}/]`, message: PAYMENT_CHECK_MESSAGE },
  ],
};
const NO_CHECK_FACTORY = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          regex: PAYMENT_CHECK_PATH,
          importNames: ["paymentCheck"],
          message: "Only src/client/live-actions.ts and tests build a payment check. Everything else uses checkPayment, whose seams fail closed.",
        },
      ],
    },
  ],
};
const BROADCAST = "OneTab's browser only asks a wallet to approve. The server sends the one payment.";
const NO_BROADCAST = [
  {
    name: "@solana/wallet-standard-features",
    importNames: ["SolanaSignAndSendTransaction", "SolanaSignAndSendTransactionFeature"],
    message: BROADCAST,
  },
  {
    name: "@solana/kit",
    importNames: [
      "createSolanaRpc",
      "createSolanaRpcSubscriptions",
      "sendAndConfirmTransactionFactory",
      "sendTransactionWithoutConfirmingFactory",
    ],
    message: BROADCAST,
  },
  { name: "@solana/rpc", importNames: ["createSolanaRpc", "createSolanaRpcSubscriptions"], message: BROADCAST },
  { name: "@solana/rpc-subscriptions", importNames: ["createSolanaRpcSubscriptions"], message: BROADCAST },
];
const COMPONENT_INPUTS = {
  group: [...WIRE_AND_SAMPLES, "@/client/checkout-source", "**/client/checkout-source"],
  message: "Components render views from @/client/checkout-view. Loading, wire types and samples stay in src/client.",
};
const PAGE_INPUTS = {
  group: WIRE_AND_SAMPLES,
  message: "Pages load data with @/client/checkout-source and render a screen component.",
};

const CODE = "{ts,tsx,js,jsx,mjs,cjs}";

/**
 * A file matched by several blocks gets only the last block's patterns, so each block lists its full set.
 * Browser code also gets the broadcast ban. Server code, src/server and src/app/api, sends the payment.
 */
const restrictServer = (...patterns) => ({
  "@typescript-eslint/no-restricted-imports": ["error", { patterns: [NO_SERVER, ...patterns] }],
});
const restrict = (...patterns) => ({
  "@typescript-eslint/no-restricted-imports": ["error", { paths: NO_BROADCAST, patterns: [NO_SERVER, ...patterns] }],
});

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
  {
    files: [`src/**/*.${CODE}`],
    rules: { ...restrictServer(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, NO_API_CLIENT), ...NO_CHECK_FACTORY },
  },
  {
    files: ["src/client/live-actions.ts", `src/**/*.test.${CODE}`],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: [`src/client/**/*.${CODE}`],
    rules: restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD),
  },
  {
    files: [`src/components/**/*.${CODE}`],
    rules: { ...restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, COMPONENT_INPUTS, NO_API_CLIENT, NO_PAYMENT_CHECK), ...NO_DYNAMIC_PAYMENT_CHECK },
  },
  {
    files: [`src/app/**/*.${CODE}`],
    ignores: ["src/app/api/**"],
    rules: { ...restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, PAGE_INPUTS, NO_API_CLIENT, NO_PAYMENT_CHECK), ...NO_DYNAMIC_PAYMENT_CHECK },
  },
  {
    files: ["src/components/wallet/wallet-scope.tsx"],
    rules: restrict(NO_WALLET_STANDARD, COMPONENT_INPUTS, NO_API_CLIENT, NO_PAYMENT_CHECK),
  },
  {
    files: [`src/lib/wallet/**/*.${CODE}`],
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
          paths: NO_BROADCAST,
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
