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

const restrict = (groups, message) => ({
  "@typescript-eslint/no-restricted-imports": [
    "error",
    {
      patterns: [
        { group: SERVER, message: "Browser and page code never imports src/server." },
        ...(groups.length > 0 ? [{ group: groups, message }] : []),
      ],
    },
  ],
});

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "spikes/payment-proof/**"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: restrict([], ""),
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: restrict(
      [...WIRE_AND_SAMPLES, "@/client/checkout-source", "**/client/checkout-source"],
      "Components render views from @/client/checkout-view. Loading, wire types and samples stay in src/client.",
    ),
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: restrict(WIRE_AND_SAMPLES, "Pages load data with @/client/checkout-source and render a screen component."),
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
