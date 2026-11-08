import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const sentinel = "onetab-bundle-sentinel-not-a-credential";
const databaseUrl = "https://database.example.test";
const nextBin = join(root, "node_modules/next/dist/bin/next");
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE|KEY|TOKEN|PASSWORD/i.test(name)) delete env[name];
}
env.SUPABASE_SECRET_KEY = sentinel;
env.SUPABASE_URL = databaseUrl;
env.APP_ORIGIN = "https://example.invalid";
env.ONETAB_API_ORIGIN = "";
env.SOLANA_CLUSTER = "devnet";
env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
env.USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
env.USDC_DECIMALS = "6";
env.ONETAB_FIXTURES = "0";

const build = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, env, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

function filesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) found.push(...filesUnder(path));
    else if (info.isFile() && info.size <= 20_000_000) found.push(path);
  }
  return found;
}

function contains(path, needle) {
  return readFileSync(path).includes(Buffer.from(needle));
}

const staticDir = join(root, ".next/static");
const staticFiles = filesUnder(staticDir);
const clientHits = staticFiles
  .filter((path) => contains(path, sentinel) || contains(path, "SUPABASE_SECRET_KEY") || contains(path, databaseUrl))
  .map((path) => relative(root, path));
const serverDir = join(root, ".next/server");
const serverFiles = filesUnder(serverDir);
const serverSentinelHits = serverFiles.filter((path) => contains(path, sentinel)).length;
const serverNameHits = serverFiles.filter((path) => contains(path, "SUPABASE_SECRET_KEY")).length;
const report = {
  staticFiles: staticFiles.length,
  clientHits,
  serverFilesWithSentinel: serverSentinelHits,
  serverFilesWithSecretName: serverNameHits,
  execPath: process.execPath,
  node: process.version,
};
console.log(JSON.stringify(report));
if (clientHits.length > 0 || staticFiles.length === 0 || serverNameHits === 0) process.exit(1);
