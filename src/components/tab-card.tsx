import type { ReactNode } from "react";
import { SPOT_STATUSES, WORDS, type SpotStatus } from "@/client/catalog";
import type { TabView } from "@/client/checkout-view";
import { Icon } from "./icon";
import { AddressText, Amount } from "./values";

const SEGMENT: { readonly [S in SpotStatus]: { readonly className: string; readonly check: boolean } } = {
  open: { className: "border-2 border-dashed border-white text-white", check: false },
  joined: { className: "bg-brand-soft text-ink", check: false },
  ready: { className: "bg-brand-soft text-ink", check: true },
  approved: { className: "bg-accent text-ink", check: true },
};

export function TabCard({
  tab,
  heading,
  hero,
  showShares = false,
}: {
  readonly tab: TabView;
  readonly heading: "h1" | "h2";
  readonly hero: boolean;
  readonly showShares?: boolean;
}): ReactNode {
  const Heading = heading;
  return (
    <section
      aria-labelledby="tab-title"
      data-surface="brand"
      className="rounded-card bg-brand p-6 text-white shadow-tab wide:p-8"
    >
      <Heading id="tab-title" className="text-title font-bold break-words">
        {tab.title}
      </Heading>
      <p className="mt-2">
        <span className="sr-only">{WORDS.total} </span>
        <Amount value={tab.total} size={hero ? "hero" : "title"} onBrand />
      </p>
      <p className="mt-2 text-small text-on-brand-muted">
        {WORDS.seller} {tab.seller ? <AddressText value={tab.seller} form="short" /> : "not set yet"}
      </p>
      <ol aria-label="Payer spots" className="mt-6 flex gap-2">
        {tab.spots.map((spot) => (
          <li key={spot.slot} className="flex min-w-0 flex-1 flex-col gap-2">
            <span
              className={`flex h-10 items-center justify-center gap-1 rounded-full px-2 text-small font-semibold transition-colors duration-300 ${SEGMENT[spot.status].className}`}
            >
              {SEGMENT[spot.status].check && <Icon name="check" className="size-4" />}
              <span className="truncate">
                <span className="sr-only">
                  {WORDS.spot} {spot.slot + 1}:{" "}
                </span>
                {SPOT_STATUSES[spot.status].label}
              </span>
            </span>
            <span className={`text-center text-small ${spot.isViewer ? "font-bold text-accent" : "text-on-brand-muted"}`}>
              {spot.isViewer ? WORDS.you : `${WORDS.spot} ${spot.slot + 1}`}
            </span>
          </li>
        ))}
      </ol>
      {showShares ? (
        <ul aria-label="Shares" className="mt-4 flex flex-col gap-1">
          {tab.spots.map((spot) => (
            <li key={spot.slot} className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className={spot.isViewer ? "font-bold text-accent" : "text-on-brand-muted"}>
                {spot.isViewer ? WORDS.you : `${WORDS.spot} ${spot.slot + 1}`}
              </span>
              <Amount value={spot.share} onBrand />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-small text-on-brand-muted">{tab.progress}</p>
      )}
    </section>
  );
}
