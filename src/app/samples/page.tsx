import type { Metadata } from "next";
import Link from "next/link";
import { NETWORK_LABELS, SITUATIONS, WORDS } from "@/client/catalog";
import { SAMPLE_CREATE_PATH } from "@/client/checkout-view";
import { loadSampleIndex } from "@/client/checkout-source";
import { BUTTON } from "@/components/button";
import { SiteHeader } from "@/components/page-shell";

export const metadata: Metadata = { title: "Sample data | OneTab" };

export default async function SamplesPage() {
  const entries = await loadSampleIndex();
  return (
    <>
      <SiteHeader networkLabel={NETWORK_LABELS.devnet} viewerWallet={null} />
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-content flex-col gap-8 px-6 pt-8 pb-16 focus:outline-none">
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-bold">{WORDS.sample}</h1>
          <p className="max-w-prose">
            Every checkout state, seen by each person who could open it. {WORDS.sample_notice}
          </p>
          <p>
            <Link href={SAMPLE_CREATE_PATH} className={BUTTON.link}>
              Create a checkout with sample data
            </Link>
          </p>
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {entries.map((entry) => (
            <li key={entry.fixture} className="grid gap-2 py-4 wide:grid-cols-12 wide:gap-6">
              <div className="wide:col-span-4">
                <h2 className="text-section font-bold">{entry.label}</h2>
                <p className="text-small text-muted">
                  {SITUATIONS[entry.situation].label}. Opens on the {entry.owner} screen.
                </p>
              </div>
              <ul aria-label={`${entry.label}: view as`} className="flex flex-wrap gap-x-5 wide:col-span-8">
                {entry.personas.map((p) => (
                  <li key={p.label}>
                    <Link href={p.links[entry.owner]} className={BUTTON.link}>
                      {p.label}
                      {p.isDefault && <span className="font-normal text-muted"> (default)</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
