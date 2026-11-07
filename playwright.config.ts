import { defineConfig } from "@playwright/test";

const SAMPLES_PORT = 3100;
const GATED_PORT = 3101;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  projects: [
    { name: "samples", testMatch: ["samples.spec.ts", "wallet.spec.ts"], use: { baseURL: `http://localhost:${SAMPLES_PORT}` } },
    { name: "gating", testMatch: "gating.spec.ts", use: { baseURL: `http://localhost:${GATED_PORT}` } },
  ],
  webServer: [
    {
      command: `npx next start -p ${SAMPLES_PORT}`,
      url: `http://localhost:${SAMPLES_PORT}/samples`,
      env: { ONETAB_FIXTURES: "1" },
      reuseExistingServer: false,
    },
    {
      command: `npx next start -p ${GATED_PORT}`,
      url: `http://localhost:${GATED_PORT}/`,
      env: { ONETAB_FIXTURES: "" },
      reuseExistingServer: false,
    },
  ],
});
