import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function fenced(code: string, file: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath: `${process.cwd()}/${file}` });
  return result!.messages.some((m) => m.message.includes("Only checkout-view.ts makes a Replaceable or VerifiedReceipt"));
}

const id = "declare const id: string;\n";

describe("only checkout-view.ts makes a Replaceable or VerifiedReceipt", () => {
  it.each([
    ["an as-cast", `${id}export const x = id as Replaceable;\n`],
    ["an angle-bracket cast", `${id}export const x = <VerifiedReceipt>id;\n`],
    ["a cast to a union", `${id}export const x = id as Replaceable | null;\n`],
    ["a cast to a generic", `${id}export const x = id as readonly VerifiedReceipt[];\n`],
    ["a cast to a qualified name", `${id}export const x = id as View.Replaceable;\n`],
    ["an import from checkout-view", 'import type { Replaceable } from "./checkout-view";\nexport type X = Replaceable;\n'],
    ["an import through the alias", 'import type { VerifiedReceipt } from "@/client/checkout-view";\nexport type X = VerifiedReceipt;\n'],
  ])("refuses %s anywhere else", async (_, code) => {
    for (const file of ["src/client/fence-probe.ts", "src/components/fence-probe.ts", "src/app/fence-probe.ts", "src/client/catalog.ts"]) {
      expect(await fenced(code, file), file).toBe(true);
    }
  });

  it("lets checkout-view.ts mint them, and lets other files cast to anything else", async () => {
    expect(await fenced(`${id}export const x = id as Replaceable;\n`, "src/client/checkout-view.ts")).toBe(false);
    expect(await fenced(`${id}export const x = id as string;\n`, "src/client/fence-probe.ts")).toBe(false);
  });

  const exported = 'import type { Action, ActionOf, Recovery } from "./checkout-view";\ndeclare const x: unknown;\n';
  it.each([
    ["as Action", `${exported}export const a = x as Action;\n`],
    ['as ActionOf<"retry">', `${exported}export const a = x as ActionOf<"retry">;\n`],
    ["as Recovery", `${exported}export const a = x as Recovery;\n`],
    ["a generic as-T helper", `${exported}const cast = <T,>(v: unknown) => v as T;\nexport const a = cast<Action>(x);\n`],
    ["a type guard", `${exported}const isRetry = (v: unknown): v is ActionOf<"retry"> => true;\nexport const a = isRetry(x) ? x : null;\n`],
  ])("misses a claim of an exported type that holds a brand, %s, which review has to catch", async (_, code) => {
    expect(await fenced(code, "src/client/fence-probe.ts")).toBe(false);
  });
});
