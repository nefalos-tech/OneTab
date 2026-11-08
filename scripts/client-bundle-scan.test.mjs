import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATABASE_SENTINEL, RPC_SENTINEL, scanNextOutput, SERVICE_SENTINEL } from "./client-bundle-scan.mjs";

const roots = [];

function output() {
  const root = mkdtempSync(join(tmpdir(), "onetab-bundle-"));
  roots.push(root);
  const next = join(root, ".next");
  mkdirSync(join(next, "static", "chunks"), { recursive: true });
  mkdirSync(join(next, "server", "chunks"), { recursive: true });
  mkdirSync(join(next, "server", "app", "qa-leak.segments"), { recursive: true });
  writeFileSync(join(next, "static", "chunks", "app.js"), "one tab");
  writeFileSync(join(next, "server", "chunks", "runtime.js"), "SUPABASE_SECRET_KEY");
  return next;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("browser-delivered build files", () => {
  it("reports a sentinel in prerendered html, rsc, and segment.rsc", () => {
    const next = output();
    writeFileSync(join(next, "server", "chunks", "runtime.js"), `SUPABASE_SECRET_KEY ${SERVICE_SENTINEL}`);
    writeFileSync(join(next, "server", "app", "qa-leak.html"), SERVICE_SENTINEL);
    writeFileSync(join(next, "server", "app", "qa-leak.rsc"), SERVICE_SENTINEL);
    writeFileSync(join(next, "server", "app", "qa-leak.segments", "segment.rsc"), SERVICE_SENTINEL);
    const result = scanNextOutput(next, { values: [SERVICE_SENTINEL, RPC_SENTINEL, DATABASE_SENTINEL], names: ["SUPABASE_SECRET_KEY"] });
    expect(result.hits.toSorted()).toEqual([
      "server/app/qa-leak.html",
      "server/app/qa-leak.rsc",
      "server/app/qa-leak.segments/segment.rsc",
    ]);
  });

  it("reports the standalone base64 form and the unpadded base64url form", () => {
    const next = output();
    writeFileSync(join(next, "server", "app", "qa-leak.html"), Buffer.from(SERVICE_SENTINEL).toString("base64"));
    writeFileSync(join(next, "server", "app", "qa-leak.rsc"), Buffer.from(DATABASE_SENTINEL).toString("base64url"));
    const result = scanNextOutput(next, { values: [SERVICE_SENTINEL, DATABASE_SENTINEL], names: [] });
    expect(result.hits.toSorted()).toEqual(["server/app/qa-leak.html", "server/app/qa-leak.rsc"]);
  });

  it("leaves a sentinel buried in a larger base64 value", () => {
    const next = output();
    writeFileSync(join(next, "server", "app", "qa-leak.html"), Buffer.from(`prefix-${SERVICE_SENTINEL}`).toString("base64"));
    const result = scanNextOutput(next, { values: [SERVICE_SENTINEL], names: [] });
    expect(result.hits).toEqual([]);
  });

  it("reports a provider key in prerendered output", () => {
    const next = output();
    writeFileSync(join(next, "server", "app", "qa-leak.rsc"), `https://example.invalid/devnet?api-key=${RPC_SENTINEL}`);
    const result = scanNextOutput(next, { values: [RPC_SENTINEL], names: [] });
    expect(result.hits).toEqual(["server/app/qa-leak.rsc"]);
  });

  it("reports a sentinel in a response body, response metadata, and a pages html file", () => {
    const next = output();
    mkdirSync(join(next, "server", "pages"), { recursive: true });
    writeFileSync(join(next, "server", "app", "qa-leak.body"), SERVICE_SENTINEL);
    writeFileSync(join(next, "server", "app", "qa-leak.meta"), `{"headers":{"x-test":"${SERVICE_SENTINEL}"}}`);
    writeFileSync(join(next, "server", "pages", "404.html"), SERVICE_SENTINEL);
    writeFileSync(join(next, "server", "pages", "page.js"), SERVICE_SENTINEL);
    const result = scanNextOutput(next, { values: [SERVICE_SENTINEL], names: [] });
    expect(result.hits.toSorted()).toEqual([
      "server/app/qa-leak.body",
      "server/app/qa-leak.meta",
      "server/pages/404.html",
    ]);
  });

  it("accepts a clean static file and a server chunk that names the key", () => {
    const next = output();
    writeFileSync(join(next, "server", "app", "qa-leak.html"), "OneTab");
    writeFileSync(join(next, "server", "app", "page.js"), `SUPABASE_SECRET_KEY ${SERVICE_SENTINEL}`);
    const result = scanNextOutput(next, { values: [SERVICE_SENTINEL, RPC_SENTINEL, DATABASE_SENTINEL], names: ["SUPABASE_SECRET_KEY"] });
    expect(result.hits).toEqual([]);
    expect(result.serverNameHits).toBe(2);
    expect(result.staticFiles).toBe(1);
  });
});
