import type { ReactNode } from "react";
import { WORDS } from "@/client/catalog";
import { formatMoney, type Money } from "@/client/units";
import { shortAddress } from "@/client/checkout-view";

const AMOUNT_SIZE = {
  body: "whitespace-nowrap",
  title: "whitespace-nowrap text-title font-bold",
  hero: "text-hero max-narrow:text-title font-bold",
} as const;

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
    <data value={value.units} data-amount="" className={`tabular-nums ${AMOUNT_SIZE[size]}`}>
      <span className="whitespace-nowrap">{formatMoney(value)}</span>{" "}
      <span className={`whitespace-nowrap text-body font-normal ${onBrand ? "text-on-brand-muted" : "text-muted"}`}>
        {WORDS.asset}
      </span>
    </data>
  );
}

export function AddressText({ value, form }: { readonly value: string; readonly form: "short" | "full" }): ReactNode {
  return form === "short" ? (
    <span className="font-mono" title={value}>
      {shortAddress(value)}
    </span>
  ) : (
    <span className="font-mono break-all">{value}</span>
  );
}
