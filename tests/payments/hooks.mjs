import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const serverOnly = pathToFileURL(join(root, "node_modules/next/dist/compiled/server-only/empty.js")).href;

function file(candidate) {
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const extension of [".ts", ".tsx", ".mts", ".js", ".mjs"]) {
    if (existsSync(candidate + extension)) return candidate + extension;
  }
  for (const extension of [".ts", ".tsx", ".js"]) {
    const index = join(candidate, `index${extension}`);
    if (existsSync(index)) return index;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return nextResolve(serverOnly, context);
  if (specifier.startsWith("@/")) {
    const resolved = file(join(root, "src", specifier.slice(2)));
    if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
    return nextResolve(pathToFileURL(resolved).href, context);
  }
  if (specifier.startsWith(".") && context.parentURL) {
    const resolved = file(fileURLToPath(new URL(specifier, context.parentURL)));
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") || specifier.startsWith("node:") || specifier.endsWith(".js")) throw error;
    return nextResolve(`${specifier}.js`, context);
  }
}
