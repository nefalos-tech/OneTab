import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["artifacts/onetab-lead/postgrest-progress.test.ts"],
    environment: "node",
    fileParallelism: false,
    disableConsoleIntercept: true,
  },
});
