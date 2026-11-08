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

export function scanNextOutput(nextDir, { values, names }) {
  const files = walk(join(nextDir, "static"));
  const hits = [];
  for (const path of files) {
    const bytes = readFileSync(path);
    if (values.some((value) => bytes.includes(Buffer.from(value))) || names.some((name) => bytes.includes(Buffer.from(name)))) {
      hits.push(posix(nextDir, path));
    }
  }
  const serverName = Buffer.from("SUPABASE_SECRET_KEY");
  const serverNameHits = walk(join(nextDir, "server")).filter((path) => readFileSync(path).includes(serverName)).length;
  return {
    staticFiles: files.length,
    prerenderFiles: 0,
    hits,
    serverNameHits,
  };
}
