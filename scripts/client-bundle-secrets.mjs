import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DATABASE_SENTINEL, RPC_SENTINEL, scanNextOutput, SERVICE_SENTINEL } from "./client-bundle-scan.mjs";

const root = process.cwd();
const nextBin = join(root, "node_modules/next/dist/bin/next");
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE|KEY|TOKEN|PASSWORD/i.test(name)) delete env[name];
}
env.SUPABASE_SECRET_KEY = SERVICE_SENTINEL;
env.SUPABASE_URL = DATABASE_SENTINEL;
env.APP_ORIGIN = "https://example.invalid";
env.ONETAB_API_ORIGIN = "";
env.SOLANA_CLUSTER = "devnet";
env.SOLANA_RPC_URL = `https://example.invalid/devnet?api-key=${RPC_SENTINEL}`;
env.USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
env.USDC_DECIMALS = "6";
env.ONETAB_FIXTURES = "0";

const build = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, env, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const scanned = scanNextOutput(join(root, ".next"), {
  values: [SERVICE_SENTINEL, RPC_SENTINEL, DATABASE_SENTINEL],
  names: ["SUPABASE_SECRET_KEY"],
});
const report = {
  staticFiles: scanned.staticFiles,
  prerenderFiles: scanned.prerenderFiles,
  clientHits: scanned.hits,
  serverFilesWithSentinel: scanned.serverFilesWithSentinel,
  serverFilesWithSecretName: scanned.serverNameHits,
  execPath: process.execPath,
  node: process.version,
};
console.log(JSON.stringify(report));
if (scanned.hits.length > 0 || scanned.staticFiles === 0 || scanned.prerenderFiles === 0 || scanned.serverNameHits === 0) process.exit(1);
