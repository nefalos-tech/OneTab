//   node scripts/palette-candidates.mjs                 the seven candidates in docs/design-decisions.md
//   node scripts/palette-candidates.mjs "#FFD23F" ...   any #RRGGBB values
import { colorTokens, contrastRatio, hexToRgb, markdownTable, readGlobalsCss, readTheme, toLinear } from "./design-tokens.mjs";

const DEFAULTS = [
  ["Marigold", "#FFC845"],
  ["Sunflower", "#FFD23F"],
  ["Coral", "#FF7A5C"],
  ["Mint", "#5FE0B7"],
  ["Lime", "#C6F05A"],
  ["Lilac", "#B8A6FF"],
  ["Apricot", "#FFB067"],
];

// Machado, Oliveira and Fernandes (2009), severity 1, applied to linear RGB.
const CVD = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const colors = colorTokens(readTheme(await readGlobalsCss()).tokens);
const token = (name) => {
  const value = colors.get(name);
  if (!value) throw new Error(`globals.css has no --color-${name}.`);
  return value;
};
const ink = token("ink");
const brand = token("brand");
const statuses = ["success", "warning", "danger"].map((name) => [name, token(name)]);

const args = process.argv.slice(2);
const candidates =
  args.length === 0
    ? DEFAULTS
    : args.map((hex) => [DEFAULTS.find(([, h]) => h.toLowerCase() === hex.toLowerCase())?.[0] ?? "Custom", hex.toUpperCase()]);

const rows = candidates.map(([name, hex]) => {
  const rgb = linear(hex);
  const tide = linear(brand);
  const cvdDistance = Math.min(
    ...Object.values(CVD).map((m) => distance(oklab(simulate(m, rgb)), oklab(simulate(m, tide)))),
  );
  const [nearest, nearestDistance] = statuses
    .map(([status, value]) => [status, distance(oklab(rgb), oklab(linear(value)))])
    .sort((a, b) => a[1] - b[1])[0];
  return [
    name,
    `\`${hex}\``,
    `${contrastRatio(ink, hex).toFixed(2)}:1`,
    `${contrastRatio(hex, brand).toFixed(2)}:1`,
    cvdDistance.toFixed(2),
    `${nearest}, ${nearestDistance.toFixed(2)}`,
  ];
});

console.log(
  markdownTable(
    ["Candidate", "Hex", "Deep Tide text on it", "It on Tide", "Distance from Tide", "Nearest status color"],
    rows,
  ),
);

function linear(hex) {
  return toLinear(hexToRgb(hex));
}

function simulate(matrix, rgb) {
  return matrix.map((row) => Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]));
}

/** Linear sRGB to OKLab (Björn Ottosson). */
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720033 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
