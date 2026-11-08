import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";

const ROOT = new URL("../", import.meta.url);
const NEXT = new URL(".next/", ROOT);

/**
 * Strings that only Payments' browser code contains. If one of them is in a chunk a route loads before any
 * click, Payments' validators, with zod and the token program, ship with every page again.
 */
const PAYMENTS_MARKERS = ["Noncanonical base64", "Payload differs from the frozen attempt", "Wallet changed transaction"];

/** Test support never ships, so no chunk for the browser or the server may hold this file's own error text. */
const TEST_SUPPORT = "src/client/test-support/keyed-payment.ts";
const TEST_SUPPORT_MARKER = "The keyed payment does not parse as the client room and payload";

const require = createRequire(import.meta.url);
const buildManifest = JSON.parse(await readFile(new URL("build-manifest.json", NEXT), "utf8"));
const manifests = await clientReferenceManifests(new URL("server/app/", NEXT));
if (manifests.length === 0) fail(["No client reference manifests under .next/server/app. Run next build first."]);

const problems = [];
const sizes = new Map();
const rows = [];
for (const { route, manifest } of manifests) {
  const chunks = new Set(buildManifest.rootMainFiles);
  for (const files of Object.values(manifest.entryJSFiles ?? {})) for (const file of files) chunks.add(file);
  for (const client of Object.values(manifest.clientModules ?? {})) {
    if (!client.async) for (const chunk of client.chunks) chunks.add(chunk.replace(/^\/_next\//, ""));
  }
  let raw = 0;
  let gzip = 0;
  for (const chunk of chunks) {
    const size = await sizeOf(chunk);
    raw += size.raw;
    gzip += size.gzip;
    for (const marker of size.markers) problems.push(`${route} loads ${chunk} before any click, and it holds "${marker}" from src/lib/payments.`);
  }
  rows.push([route, chunks.size, kib(raw), kib(gzip)]);
}

const lazy = await lazyMarkers();
if (lazy.length === 0) problems.push(`No chunk holds ${PAYMENTS_MARKERS.map((m) => `"${m}"`).join(" or ")}, so this check proves nothing. Update its markers.`);

if (!(await readFile(new URL(TEST_SUPPORT, ROOT), "utf8")).includes(TEST_SUPPORT_MARKER)) {
  problems.push(`${TEST_SUPPORT} no longer holds "${TEST_SUPPORT_MARKER}", so the test support check proves nothing. Update its marker.`);
}
for (const file of await builtFilesHolding(TEST_SUPPORT_MARKER)) problems.push(`${file} holds ${TEST_SUPPORT}, which must never ship.`);

console.log(["Route | First-load chunks | First Load JS | gzip", ...rows.map((r) => r.join(" | "))].join("\n"));
if (problems.length > 0) fail(problems);
console.log(`bundle ok: Payments' code is only in ${lazy.join(", ")}, which no route loads before a click, and no built file holds test support.`);

async function clientReferenceManifests(dir) {
  const found = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== "page_client-reference-manifest.js") continue;
    globalThis.__RSC_MANIFEST = {};
    require(`${entry.parentPath}/${entry.name}`);
    for (const [route, manifest] of Object.entries(globalThis.__RSC_MANIFEST)) found.push({ route, manifest });
  }
  return found.sort((a, b) => a.route.localeCompare(b.route));
}

async function sizeOf(chunk) {
  if (!sizes.has(chunk)) {
    const bytes = await readFile(new URL(chunk, NEXT));
    const text = bytes.toString("utf8");
    sizes.set(chunk, { raw: bytes.length, gzip: gzipSync(bytes).length, markers: PAYMENTS_MARKERS.filter((m) => text.includes(m)) });
  }
  return sizes.get(chunk);
}

async function lazyMarkers() {
  const dir = new URL("static/chunks/", NEXT);
  const found = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".js")) continue;
    const text = await readFile(new URL(name, dir), "utf8");
    if (PAYMENTS_MARKERS.some((m) => text.includes(m))) found.push(`static/chunks/${name}`);
  }
  return found;
}

async function builtFilesHolding(marker) {
  const found = [];
  for (const dir of ["static", "server"]) {
    for (const entry of await readdir(new URL(dir, NEXT), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      const path = `${entry.parentPath}/${entry.name}`;
      if ((await readFile(path, "utf8")).includes(marker)) found.push(path.slice(NEXT.pathname.length));
    }
  }
  return found;
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function fail(list) {
  console.error(["bundle check failed:", ...list.map((p) => `  - ${p}`)].join("\n"));
  process.exit(1);
}
