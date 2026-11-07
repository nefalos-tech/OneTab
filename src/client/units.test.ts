import { describe, expect, it } from "vitest";
import { isTokenUnits, type TokenUnits } from "./contracts";
import { formatMoney, parseAmountInput, splitEqually, type AmountProblem } from "./units";

const u = (s: string): TokenUnits => {
  if (!isTokenUnits(s)) throw new Error(`bad test units ${s}`);
  return s;
};

describe("splitEqually follows the spec's remainder rule", () => {
  it.each([
    ["6000000", 3, ["2000000", "2000000", "2000000"]],
    ["10000000", 3, ["3333334", "3333333", "3333333"]],
    ["7", 2, ["4", "3"]],
    ["2", 3, ["1", "1", "0"]],
    ["18446744073709551615", 2, ["9223372036854775808", "9223372036854775807"]],
  ] as const)("%s units across %i payers", (total, n, shares) => {
    expect(splitEqually(u(total), n)).toEqual(shares);
  });
});

describe("parseAmountInput is the create form's boundary", () => {
  it.each([
    ["6", "6000000"],
    ["6.5", "6500000"],
    [" 12.50 ", "12500000"],
    ["0.000001", "1"],
    ["18446744073709.551615", "18446744073709551615"],
  ])("accepts %j as %s units", (input, units) => {
    expect(parseAmountInput(input, 6)).toEqual({ ok: true, units });
  });

  it.each<[string, AmountProblem]>([
    ["", "empty"],
    ["abc", "not_a_number"],
    ["1e3", "not_a_number"],
    ["-1", "not_a_number"],
    ["1,000", "not_a_number"],
    ["0.0000001", "too_many_decimals"],
    ["0", "not_positive"],
    ["0.000000", "not_positive"],
    ["18446744073709.551616", "too_large"],
  ])("rejects %j as %s", (input, problem) => {
    expect(parseAmountInput(input, 6)).toEqual({ ok: false, problem });
  });
});

describe("formatMoney prints integer units without floats", () => {
  it.each([
    ["10000000", "10.00"],
    ["3333334", "3.333334"],
    ["3500000", "3.50"],
    ["1", "0.000001"],
    ["0", "0.00"],
    ["1234500000", "1,234.50"],
  ])("%s units at 6 decimals prints %s", (units, text) => {
    expect(formatMoney({ units: u(units), decimals: 6 })).toBe(text);
  });
});

describe("token unit guards", () => {
  it.each(["0", "1", "18446744073709551615"])("accepts %j", (s) => expect(isTokenUnits(s)).toBe(true));
  it.each(["", "01", "-1", "1.5", "1e3", "18446744073709551616"])("rejects %j", (s) => expect(isTokenUnits(s)).toBe(false));
});
