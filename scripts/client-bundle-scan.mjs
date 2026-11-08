import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const SERVICE_SENTINEL = "onetab-bundle-sentinel-not-a-credential";
export const RPC_SENTINEL = "onetab-rpc-sentinel-not-a-credential";
export const DATABASE_SENTINEL = "https://database.example.test";

function walk(dir) {
  let info;
  try {
    info = statSync(dir);
  } catch {
    return [];
  }
  if (!info.isDirectory()) return [];
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const child = statSync(path);
    if (child.isDirectory()) found.push(...walk(path));
    else if (child.isFile() && child.size <= 20_000_000) found.push(path);
  }
  return found;
}

function posix(nextDir, path) {
  return relative(nextDir, path).split(sep).join("/");
}

function encodedForms(value) {
  return [value, Buffer.from(value).toString("base64"), Buffer.from(value).toString("base64url")];
}

function browserFile(nextDir, path) {
  const rel = posix(nextDir, path);
  return rel.startsWith("static/") || (rel.startsWith("server/app/") && (rel.endsWith(".html") || rel.endsWith(".rsc")));
}

export function scanNextOutput(nextDir, { values, names }) {
  const needles = [...new Set([...values.flatMap(encodedForms), ...names])].map((needle) => Buffer.from(needle));
  const staticPaths = walk(join(nextDir, "static"));
  const appPaths = walk(join(nextDir, "server", "app")).filter((path) => browserFile(nextDir, path));
  const files = [...staticPaths, ...appPaths];
  const hits = [];
  for (const path of files) {
    const bytes = readFileSync(path);
    if (needles.some((needle) => bytes.includes(needle))) hits.push(posix(nextDir, path));
  }
  const serverName = Buffer.from("SUPABASE_SECRET_KEY");
  const serviceValue = Buffer.from(SERVICE_SENTINEL);
  let serverNameHits = 0;
  let serverFilesWithSentinel = 0;
  for (const path of walk(join(nextDir, "server"))) {
    const bytes = readFileSync(path);
    if (bytes.includes(serverName)) serverNameHits += 1;
    if (bytes.includes(serviceValue)) serverFilesWithSentinel += 1;
  }
  return {
    staticFiles: staticPaths.length,
    prerenderFiles: appPaths.length,
    hits,
    serverNameHits,
    serverFilesWithSentinel,
  };
}
