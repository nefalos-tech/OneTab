import { readFile } from "node:fs/promises";

export const ROOT = new URL("../", import.meta.url);
export const CSS_PATH = new URL("src/app/globals.css", ROOT);

export async function readGlobalsCss() {
  return readFile(CSS_PATH, "utf8");
}

export function readTheme(css) {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) throw new Error("src/app/globals.css has no @theme block.");
  const tokens = [];
  const resets = [];
  let role = null;
  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    const comment = /^\/\*\s*(.*?)\s*\*\/$/.exec(line);
    if (comment) {
      role = comment[1];
      continue;
    }
    const decl = /^(--[\w-]+\*?)\s*:\s*(.+?);$/.exec(line);
    if (decl) {
      const [, name, value] = decl;
      if (name.endsWith("-*") && value === "initial") resets.push(name);
      else tokens.push({ name, value, role });
    }
    role = null;
  }
  return { tokens, resets };
}

export function colorTokens(tokens) {
  return new Map(
    tokens.filter((t) => t.name.startsWith("--color-")).map((t) => [t.name.slice("--color-".length), t.value]),
  );
}

export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Expected a #RRGGBB color, got ${hex}.`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB 0..255 channels to linear 0..1. */
export function toLinear(rgb) {
  return rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

/** WCAG 2.x contrast ratio of two #RRGGBB colors. */
export function contrastRatio(a, b) {
  const luminance = (hex) => {
    const [r, g, bl] = toLinear(hexToRgb(hex));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function markdownTable(header, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}
