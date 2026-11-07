import type { ReactNode } from "react";
import { WORDS } from "@/client/catalog";
import { formatMoney, type Money } from "@/client/units";

const AMOUNT_SIZE = {
  body: "",
  title: "text-title font-bold",
  hero: "text-hero font-bold",
} as const;

/** The only way to print an amount: tabular figures and the test USDC label, always together. */
export function Amount({
  value,
  size = "body",
  onBrand = false,
}: {
  readonly value: Money;
  readonly size?: keyof typeof AMOUNT_SIZE;
  readonly onBrand?: boolean;
}): ReactNode {
  return (
    <data value={value.units} data-amount="" className={`whitespace-nowrap tabular-nums ${AMOUNT_SIZE[size]}`}>
      {formatMoney(value)}{" "}
      <span className={`text-body font-normal ${onBrand ? "text-on-brand-muted" : "text-muted"}`}>{WORDS.asset}</span>
    </data>
  );
}

/** Wallets and transaction references in the mono face. The short form keeps the first and last four characters. */
export function AddressText({ value, form }: { readonly value: string; readonly form: "short" | "full" }): ReactNode {
  return form === "short" ? (
    <span className="font-mono" title={value}>
      {`${value.slice(0, 4)}…${value.slice(-4)}`}
    </span>
  ) : (
    <span className="font-mono break-all">{value}</span>
  );
}
