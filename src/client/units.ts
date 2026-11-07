/** Token amounts: integer units in and out, BigInt in between, never a float. */
import { isTokenUnits, U64_MAX, type PayerCount, type TokenUnits } from "./contracts";

/** An amount the UI can print. Decimals always come from the snapshot or the public config. */
export type Money = { readonly units: TokenUnits; readonly decimals: number };

export function toTokenUnits(n: bigint): TokenUnits {
  const s = n.toString();
  if (!isTokenUnits(s)) throw new RangeError(`${s} is outside the token unit range.`);
  return s;
}

/** "10.00", "3.333334", "0.000001", "1,234.50": two fraction digits at least, trailing zeros trimmed past two. */
export function formatMoney(m: Money): string {
  const n = BigInt(m.units);
  const scale = 10n ** BigInt(m.decimals);
  const whole = (n / scale).toLocaleString("en-US");
  const fraction = (n % scale)
    .toString()
    .padStart(m.decimals, "0")
    .replace(/0+$/, "")
    .padEnd(Math.min(2, m.decimals), "0");
  return fraction ? `${whole}.${fraction}` : whole;
}

export type AmountProblem = "empty" | "not_a_number" | "too_many_decimals" | "not_positive" | "too_large";

export type AmountParse =
  | { readonly ok: true; readonly units: TokenUnits }
  | { readonly ok: false; readonly problem: AmountProblem };

/** What a person typed ("12.5", "0.000001") into units. The only way the create form gets TokenUnits. */
export function parseAmountInput(input: string, decimals: number): AmountParse {
  const s = input.trim();
  if (s === "") return { ok: false, problem: "empty" };
  const match = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!match) return { ok: false, problem: "not_a_number" };
  const [, whole = "0", fraction = ""] = match;
  if (fraction.length > decimals) return { ok: false, problem: "too_many_decimals" };
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units === 0n) return { ok: false, problem: "not_positive" };
  if (units > U64_MAX) return { ok: false, problem: "too_large" };
  return { ok: true, units: toTokenUnits(units) };
}

/**
 * The spec's equal split: each spot gets total / n, and the first total % n spots get one more unit.
 * A share is "0" when total < n; the create form rejects that before anything is created.
 */
export function splitEqually(total: TokenUnits, payerCount: PayerCount): readonly TokenUnits[] {
  const t = BigInt(total);
  const n = BigInt(payerCount);
  const base = t / n;
  const extra = t % n;
  return Array.from({ length: payerCount }, (_, slot) => toTokenUnits(base + (BigInt(slot) < extra ? 1n : 0n)));
}
