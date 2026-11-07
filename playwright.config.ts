import { defineConfig } from "@playwright/test";
import { FAKE_API } from "./e2e/fake-api.mjs";

const SAMPLES_PORT = 3100;
const GATED_PORT = 3101;

// page.route can't see the server's own fetches, so each server reads a fake API through
// ONETAB_API_ORIGIN, the setting a deploy can use too.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  projects: [
    { name: "samples", testMatch: ["samples.spec.ts", "wallet.spec.ts"], use: { baseURL: `http://localhost:${SAMPLES_PORT}` } },
    { name: "gating", testMatch: ["gating.spec.ts", "live.spec.ts"], use: { baseURL: `http://localhost:${GATED_PORT}` } },
  ],
  webServer: [
    {
      command: `node -e "import('./e2e/fake-api.mjs').then((api) => api.serve())"`,
      url: `${FAKE_API.rooms}/api/config`,
      reuseExistingServer: false,
    },
    {
      // Samples on, and a backend that knows no checkout and can't create one.
      command: `npx next start -p ${SAMPLES_PORT}`,
      url: `http://localhost:${SAMPLES_PORT}/samples`,
      env: { ONETAB_FIXTURES: "1", ONETAB_API_ORIGIN: FAKE_API.empty },
      reuseExistingServer: false,
    },
    {
      // Samples off, and a backend with live rooms: the hosted app once Backend's routes land.
      command: `npx next start -p ${GATED_PORT}`,
      url: `http://localhost:${GATED_PORT}/`,
      env: { ONETAB_FIXTURES: "", ONETAB_API_ORIGIN: FAKE_API.rooms },
      reuseExistingServer: false,
    },
  ],
});
