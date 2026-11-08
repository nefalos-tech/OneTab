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
  "@/lib/wallet/standard",
  "@/lib/wallet/store",
  "**/lib/wallet/live",
  "**/lib/wallet/sample",
  "**/lib/wallet/standard",
  "**/lib/wallet/store",
];
const WALLET_STANDARD = ["@wallet-standard/*", "@solana/wallet-standard", "@solana/wallet-standard-*", "@solana/wallet-adapter-*"];

const NO_SERVER = { group: SERVER, message: "Browser and page code never imports src/server." };
const NO_WALLET_INTERNALS = {
  group: WALLET_INTERNALS,
  allowTypeImports: true,
  message: "Reach wallets through useWalletSession() from @/components/wallet/wallet-scope.",
};
const NO_WALLET_STANDARD = {
  group: WALLET_STANDARD,
  message: "Wallet packages stay in src/lib/wallet/, behind the WalletBridge in standard.ts.",
};
/** A static value import would ship zod, the token program and the validators with every page. */
const NO_PAYMENTS_UPFRONT = {
  group: ["@/lib/payments/*", "**/lib/payments/*"],
  allowTypeImports: true,
  message: "Browser code reaches Payments only through payment-check.ts, which loads it with import() when someone approves.",
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
  selector: `ImportExpression[source.value=/${PAYMENT_CHECK_PATH.replaceAll("/", "\\/")}/]`,
  message: PAYMENT_CHECK_MESSAGE,
};
const BRAND_MESSAGE = "Only checkout-view.ts makes a Replaceable or VerifiedReceipt, through replaceable() and verifiedReceipt().";
const NO_BRAND_CASTS = ["TSAsExpression", "TSTypeAssertion"].map((cast) => ({
  selector: `${cast} > .typeAnnotation Identifier[name=/^(Replaceable|VerifiedReceipt)$/]`,
  message: BRAND_MESSAGE,
}));
const NO_BRAND_IMPORTS = {
  regex: "(^|/)checkout-view(\\.[cm]?[jt]sx?)?$",
  importNames: ["Replaceable", "VerifiedReceipt"],
  message: BRAND_MESSAGE,
};
/** ESLint keeps only the last matching block's options for a rule, so each block that sets this lists every entry. */
const restrictSyntax = (...entries) => ({ "no-restricted-syntax": ["error", ...NO_BRAND_CASTS, ...entries] });
const NO_CHECK_FACTORY_IMPORT = {
  regex: PAYMENT_CHECK_PATH,
  importNames: ["paymentCheck"],
  message: "Only src/client/live-actions.ts and tests build a payment check. Everything else uses checkPayment, whose seams fail closed.",
};
const NO_CHECK_FACTORY = { "no-restricted-imports": ["error", { patterns: [NO_CHECK_FACTORY_IMPORT] }] };
const BROADCAST = "OneTab's browser only asks a wallet to approve. The server sends the one payment.";
const NO_BROADCAST = [
  ...["@solana/wallet-standard", "@solana/wallet-standard-core", "@solana/wallet-standard-features"].map((name) => ({
    name,
    importNames: ["SolanaSignAndSendTransaction", "SolanaSignAndSendTransactionFeature"],
    message: BROADCAST,
  })),
  {
    name: "@solana/kit",
    importNames: [
      "airdropFactory",
      "createDefaultRpcTransport",
      "createRpc",
      "createSolanaRpc",
      "createSolanaRpcFromTransport",
      "createSolanaRpcSubscriptions",
      "createSolanaRpcSubscriptionsFromTransport",
      "sendAndConfirmDurableNonceTransactionFactory",
      "sendAndConfirmTransactionFactory",
      "sendTransactionWithoutConfirmingFactory",
      "signAndSendTransactionMessageWithSigners",
      "signAndSendTransactionWithSigners",
    ],
    message: BROADCAST,
  },
];
/** Browser code uses kit's codecs but nothing from its RPC and signer packages, so it may not import them at all. */
const NO_RPC_PACKAGES = { group: ["@solana/rpc", "@solana/rpc-*", "@solana/signers"], message: BROADCAST };
/** The import ban can't see a feature named by its string key, so browser code may not spell the key at all. */
const NO_SIGN_AND_SEND = ["Literal[value=/^solana:signAndSend/]", "TemplateElement[value.raw=/solana:signAndSend/]"].map((selector) => ({
  selector,
  message: BROADCAST,
}));
/**
 * The import bans can't see import(), which hands over a whole package. This names only these packages, so
 * payment-check.ts still loads Payments' modules with import().
 */
const SENDING_PACKAGE = "^@solana\\/(kit|rpc|rpc-[a-z-]+|signers|wallet-standard|wallet-standard-[a-z-]+)$";
const NO_DYNAMIC_BROADCAST = [
  `ImportExpression[source.value=/${SENDING_PACKAGE}/]`,
  `ImportExpression > TemplateLiteral > TemplateElement[value.raw=/${SENDING_PACKAGE}/]`,
].map((selector) => ({ selector, message: BROADCAST }));
const NO_SENDING = [...NO_SIGN_AND_SEND, ...NO_DYNAMIC_BROADCAST];
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
 * Browser code also gets the broadcast ban. Server code, src/server and src/app/api, sends the payment, and
 * src/lib/payments is Payments' own.
 * Tests and test fixtures in browser folders keep the browser bans except NO_PAYMENTS_UPFRONT and NO_SIGN_AND_SEND,
 * because they build real payments and fake wallets that must refuse to send.
 */
const restrictServer = (...patterns) => ({
  "@typescript-eslint/no-restricted-imports": ["error", { patterns: [NO_SERVER, NO_BRAND_IMPORTS, ...patterns] }],
});
const restrictTest = (...patterns) => ({
  "@typescript-eslint/no-restricted-imports": ["error", { paths: NO_BROADCAST, patterns: [NO_SERVER, NO_BRAND_IMPORTS, NO_RPC_PACKAGES, ...patterns] }],
  ...restrictSyntax(...NO_DYNAMIC_BROADCAST),
});
const restrict = (...patterns) => ({
  "@typescript-eslint/no-restricted-imports": [
    "error",
    { paths: NO_BROADCAST, patterns: [NO_SERVER, NO_BRAND_IMPORTS, NO_PAYMENTS_UPFRONT, NO_RPC_PACKAGES, ...patterns] },
  ],
});

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".agents/**", ".local-setup/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "spikes/payment-proof/**"]),
  {
    files: [`src/**/*.${CODE}`],
    rules: { ...restrictServer(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, NO_API_CLIENT), ...NO_CHECK_FACTORY, ...restrictSyntax() },
  },
  {
    files: ["src/client/live-actions.ts", `src/**/*.test.${CODE}`],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: [`src/client/**/*.${CODE}`],
    rules: { ...restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD), ...restrictSyntax(...NO_SENDING) },
  },
  {
    files: [`src/components/**/*.${CODE}`],
    rules: {
      ...restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, COMPONENT_INPUTS, NO_API_CLIENT, NO_PAYMENT_CHECK),
      ...restrictSyntax(NO_DYNAMIC_PAYMENT_CHECK, ...NO_SENDING),
    },
  },
  {
    files: [`src/app/**/*.${CODE}`],
    ignores: ["src/app/api/**"],
    rules: {
      ...restrict(NO_WALLET_INTERNALS, NO_WALLET_STANDARD, PAGE_INPUTS, NO_API_CLIENT, NO_PAYMENT_CHECK),
      ...restrictSyntax(NO_DYNAMIC_PAYMENT_CHECK, ...NO_SENDING),
    },
  },
  {
    files: ["src/app/api/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [NO_BRAND_IMPORTS, NO_WALLET_INTERNALS, NO_WALLET_STANDARD, NO_API_CLIENT] }],
    },
  },
  {
    files: ["src/components/wallet/wallet-scope.tsx"],
    rules: restrict(NO_WALLET_STANDARD, COMPONENT_INPUTS, NO_API_CLIENT, NO_PAYMENT_CHECK),
  },
  {
    files: [`src/lib/wallet/**/*.${CODE}`],
    rules: { ...restrict(NO_API_CLIENT), ...restrictSyntax(...NO_SENDING) },
  },
  {
    files: ["src/lib/wallet/live.ts"],
    rules: restrict(),
  },
  {
    files: [`src/client/**/*.test.${CODE}`, "src/client/keyed-payment-fixture.ts"],
    rules: restrictTest(NO_WALLET_INTERNALS, NO_WALLET_STANDARD),
  },
  {
    files: [`src/lib/wallet/**/*.test.${CODE}`],
    rules: restrictTest(NO_API_CLIENT),
  },
  {
    files: ["src/client/checkout-view.ts"],
    rules: { "no-restricted-syntax": ["error", ...NO_SENDING] },
  },
  {
    files: ["src/client/catalog.ts"],
    rules: {
      // typescript-eslint lets a type import through once its source matches an allowTypeImports pattern, and the
      // pattern below matches every source, so the brand ban runs on the core rule here.
      "no-restricted-imports": ["error", { patterns: [NO_CHECK_FACTORY_IMPORT, NO_BRAND_IMPORTS] }],
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
