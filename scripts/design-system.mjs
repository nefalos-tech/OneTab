import { readdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { colorTokens, contrastRatio, markdownTable, readGlobalsCss, readTheme, ROOT } from "./design-tokens.mjs";

const DOC_PATH = new URL("docs/design-system.md", ROOT);
const CATALOG_PATH = new URL("src/client/catalog.ts", ROOT);
const SRC_PATH = new URL("src/", ROOT);
const REQUIRED_RESETS = [
  "--color-*",
  "--text-*",
  "--font-*",
  "--font-weight-*",
  "--radius-*",
  "--shadow-*",
  "--inset-shadow-*",
  "--drop-shadow-*",
  "--breakpoint-*",
  "--container-*",
];
const EXAMPLE_ADDRESS = "SAMP…Bea2";
const ARBITRARY_VALUE = /(?<![\w-])-?[a-z][a-z0-9-]*-(?:\[[^\]\s]+\]|\(--[^)\s]+\))/g;

const write = process.argv.includes("--write");

// The repository's package.json has no "type", so declare the catalog's format instead of letting Node guess it.
registerHooks({
  load: (url, context, next) =>
    next(url, url === CATALOG_PATH.href ? { ...context, format: "module-typescript" } : context),
});

const problems = [];
const css = await readGlobalsCss();
const doc = await readFile(DOC_PATH, "utf8");
let catalog;
try {
  catalog = await import(CATALOG_PATH.href);
} catch (error) {
  fail([
    `src/client/catalog.ts did not load under plain Node: ${error.message}`,
    "Keep that file free of runtime imports. Type-only imports are erased and fine.",
  ]);
}

const theme = readTheme(css);
for (const reset of REQUIRED_RESETS) {
  if (!theme.resets.includes(reset)) problems.push(`globals.css @theme is missing "${reset}: initial;".`);
}
for (const token of theme.tokens) {
  if (!token.role) problems.push(`${token.name} needs a one-line role comment directly above it in globals.css.`);
}

const contrast = renderContrast(readRegion(doc, "contrast"), colorTokens(theme.tokens));
problems.push(...contrast.problems);
problems.push(...(await scanArbitraryValues(SRC_PATH)));

const regions = {
  tokens: markdownTable(
    ["Token", "Value", "Role"],
    theme.tokens.map((t) => [code(t.name), code(t.value), t.role ?? ""]),
  ),
  contrast: contrast.table,
  states: renderStates(catalog),
  words: renderWords(catalog),
  wallet: renderWallet(catalog),
};
let next = doc;
for (const [name, body] of Object.entries(regions)) next = replaceRegion(next, name, body);

if (write) {
  if (next !== doc) await writeFile(DOC_PATH, next);
  console.log(next === doc ? "docs/design-system.md is already up to date." : "docs/design-system.md regenerated.");
} else if (next !== doc) {
  const stale = Object.keys(regions).filter((name) => readRegion(doc, name) !== readRegion(next, name));
  problems.push(`docs/design-system.md is out of date (${stale.join(", ")}). Run npm run design:write and commit it.`);
}
if (problems.length > 0) fail(problems);
console.log(
  `design system ok: ${theme.tokens.length} tokens, ${contrast.rows} contrast pairs, no arbitrary values, doc in step.`,
);

function fail(list) {
  console.error(["design system check failed:", ...list.map((p) => `  - ${p}`)].join("\n"));
  process.exit(1);
}

function renderContrast(region, colors) {
  const rows = [];
  const found = [];
  for (const line of region.split("\n").filter((l) => l.startsWith("|")).slice(2)) {
    const [fg, bg, min, , use] = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll("`", ""));
    const ratio = colors.has(fg) && colors.has(bg) ? contrastRatio(colors.get(fg), colors.get(bg)) : null;
    if (ratio === null) found.push(`Contrast pair ${fg} on ${bg} names a color that globals.css doesn't define.`);
    else if (ratio < Number(min)) found.push(`${fg} on ${bg} is ${ratio.toFixed(2)}:1, below its minimum of ${min}:1.`);
    rows.push([code(fg), code(bg), min, ratio === null ? "missing" : ratio.toFixed(2), use]);
  }
  if (rows.length === 0) found.push("The contrast region has no pairs.");
  return {
    table: markdownTable(["Foreground", "Background", "Minimum", "Measured", "Use"], rows),
    problems: found,
    rows: rows.length,
  };
}

function renderStates({ SITUATIONS, SPOT_STATUSES }) {
  const situations = markdownTable(
    ["State", "Screen", "Flow step", "Tone", "Label", "Server data"],
    Object.entries(SITUATIONS).map(([id, s]) => [code(id), s.owner, s.step, s.tone, s.label, s.when]),
  );
  const spots = markdownTable(
    ["Spot status", "Label", "Meaning"],
    Object.entries(SPOT_STATUSES).map(([id, s]) => [code(id), s.label, s.meaning]),
  );
  return `${situations}\n\n${spots}`;
}

function renderWords({ ACTIONS, FLOW_STEPS, WORDS, NETWORK_LABELS, REQUEST_PROBLEMS }) {
  const actions = markdownTable(
    ["Action", "Label", "Needs", "Element", "Busy label"],
    Object.entries(ACTIONS).map(([id, a]) => [code(id), a.label, a.needs, a.element, a.busy ?? ""]),
  );
  const problems = markdownTable(
    ["Request problem", "Notice"],
    Object.entries(REQUEST_PROBLEMS).map(([id, text]) => [code(id), text]),
  );
  const words = markdownTable(
    ["Word", "Text"],
    [
      ...Object.entries(WORDS).map(([id, w]) => [code(id), w]),
      ...Object.entries(NETWORK_LABELS).map(([id, w]) => [code(`network ${id}`), w]),
      [code("flow steps"), FLOW_STEPS.map((s) => s.label).join(", ")],
    ],
  );
  return `${actions}\n\n${problems}\n\n${words}`;
}

function renderWallet({ ACTIONS, WALLET_FIXES, WALLET_PROBLEMS, WALLET_WAITING, WORDS }) {
  const bold = (s) => `**${s}**`;
  const quoted = (s) => `"${s}"`;
  return markdownTable(
    ["State", "Status line", "Action"],
    [
      ["Signed out", "None", bold(ACTIONS.connect_wallet.label)],
      ...Object.values(WALLET_WAITING).map((w) => [w.state, quoted(w.line), bold(WORDS.cancel)]),
      [
        "Signed in",
        `None. The header shows the short address, and screen readers hear ${quoted(`${WORDS.signed_in_as} ${EXAMPLE_ADDRESS}.`)}`,
        `Menu: ${bold(WORDS.copy_address)}, ${bold(WORDS.disconnect)}`,
      ],
      ...Object.values(WALLET_PROBLEMS).map((p) => [
        p.state,
        quoted(p.message.replace("{address}", EXAMPLE_ADDRESS)),
        bold(WALLET_FIXES[p.fix].label),
      ]),
    ],
  );
}

async function scanArbitraryValues(dir) {
  const found = [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    const lines = (await readFile(path, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(ARBITRARY_VALUE)) {
        const where = `${relative(fileURLToPath(ROOT), path)}:${index + 1}`;
        found.push(`${where} uses the arbitrary value "${match[0]}". Use a token from globals.css instead.`);
      }
    });
  }
  return found;
}

function marker(name) {
  return { open: `<!-- design-system:${name} -->`, close: `<!-- /design-system:${name} -->` };
}

function readRegion(text, name) {
  const { open, close } = marker(name);
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end < start) fail([`docs/design-system.md is missing the ${open} ... ${close} region.`]);
  return text.slice(start + open.length, end);
}

function replaceRegion(text, name, body) {
  const { open, close } = marker(name);
  return text.replace(`${open}${readRegion(text, name)}${close}`, () => `${open}\n${body}\n${close}`);
}

function code(s) {
  return `\`${s}\``;
}
