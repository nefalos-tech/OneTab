import type { ReactNode } from "react";
import { SPOT_STATUSES, WORDS, type SpotStatus } from "@/client/catalog";
import type { SpotView } from "@/client/checkout-view";
import { Icon } from "./icon";
import { AddressText, Amount } from "./values";

/** Chip looks match the split bar segments, so a status looks the same everywhere. */
const CHIP: { readonly [S in SpotStatus]: { readonly className: string; readonly check: boolean } } = {
  open: { className: "border border-dashed border-line-strong text-muted", check: false },
  joined: { className: "bg-brand-soft text-ink", check: false },
  ready: { className: "bg-brand-soft text-ink", check: true },
  approved: { className: "bg-accent text-ink", check: true },
};

/** Everyone's spot, wallet, exact share and status, with Organizer and You tags. Dividers only, no cards. */
export function SpotList({ spots }: { readonly spots: readonly SpotView[] }): ReactNode {
  return (
    <section aria-labelledby="payers-title">
      <h2 id="payers-title" className="text-section font-bold">
        {WORDS.payers}
      </h2>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {spots.map((spot) => (
          <li key={spot.slot} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-center gap-2 text-small">
                <span className="text-muted">
                  {WORDS.spot} {spot.slot + 1}
                </span>
                {spot.isOrganizer && (
                  <span className="rounded-control border border-line-strong px-2 font-semibold">{WORDS.organizer}</span>
                )}
                {spot.isViewer && <span className="rounded-control bg-brand px-2 font-semibold text-white">{WORDS.you}</span>}
              </p>
              <p>{spot.wallet ? <AddressText value={spot.wallet} form="short" /> : SPOT_STATUSES.open.label}</p>
            </div>
            <div className="flex items-center gap-4">
              <Amount value={spot.share} />
              <span
                className={`inline-flex min-w-28 items-center justify-center gap-1 rounded-control px-2 py-1 text-small font-semibold ${CHIP[spot.status].className}`}
              >
                {CHIP[spot.status].check && <Icon name="check" className="size-4" />}
                {SPOT_STATUSES[spot.status].label}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
