import Link from "next/link";
import type { ReactNode } from "react";
import { WORDS } from "@/client/catalog";
import type { Chrome, FlowStepView, SampleBanner } from "@/client/checkout-view";
import { Icon } from "./icon";
import { AddressText } from "./values";

type Props = { readonly chrome: Chrome } & (
  | {
      readonly layout: "split";
      readonly main: ReactNode;
      readonly side: ReactNode;
      readonly mainEnd?: ReactNode;
    }
  | { readonly layout: "single"; readonly children: ReactNode }
);

export function PageShell(props: Props): ReactNode {
  const { chrome } = props;
  return (
    <>
      <SiteHeader networkLabel={chrome.networkLabel} viewerWallet={chrome.viewerWallet} />
      <div className="mx-auto max-w-content px-6">
        <FlowSteps steps={chrome.flow} />
        {chrome.sample && <SampleNotice banner={chrome.sample} />}
      </div>
      <main id="main" tabIndex={-1} className="mx-auto max-w-content px-6 pt-8 pb-16 focus:outline-none">
        {props.layout === "split" ? (
          <div className="grid gap-8 wide:grid-cols-12">
            <div className="flex min-w-0 flex-col gap-8 wide:col-span-7">{props.main}</div>
            <div className={`min-w-0 wide:col-span-5 ${props.mainEnd ? "wide:row-span-2" : ""}`}>{props.side}</div>
            {props.mainEnd && <div className="flex min-w-0 flex-col gap-8 wide:col-span-7">{props.mainEnd}</div>}
          </div>
        ) : (
          <div className="mx-auto flex max-w-result flex-col gap-8">{props.children}</div>
        )}
      </main>
    </>
  );
}

export function SiteHeader({
  networkLabel,
  viewerWallet,
}: {
  readonly networkLabel: string;
  readonly viewerWallet: string | null;
}): ReactNode {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-control text-section font-bold text-ink">
          <Logo />
          {WORDS.product}
        </Link>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-small">
          <p className="font-semibold">{networkLabel}</p>
          <p data-wallet-slot="" className="inline-flex items-center gap-2 text-muted">
            <Icon name="wallet" className="size-4" />
            {viewerWallet ? (
              <>
                <span className="sr-only">{WORDS.viewing_as} </span>
                <AddressText value={viewerWallet} form="short" />
              </>
            ) : (
              WORDS.wallet_not_connected
            )}
          </p>
        </div>
      </div>
    </header>
  );
}

function Logo(): ReactNode {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" className="size-8 shrink-0">
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <rect x="6" y="13" width="6" height="6" rx="3" className="fill-accent" />
      <rect x="13" y="13" width="6" height="6" rx="3" className="fill-white" />
      <rect x="20" y="13" width="6" height="6" rx="3" className="fill-white" />
    </svg>
  );
}

const STEP_MARKER = {
  done: "bg-brand-soft text-brand",
  current: "bg-brand text-white",
  upcoming: "border border-line-strong bg-white text-muted",
} as const;

function FlowSteps({ steps }: { readonly steps: readonly FlowStepView[] }): ReactNode {
  return (
    <nav aria-label={WORDS.steps} className="py-4">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {steps.map((step, i) => (
          <li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            className={`flex items-center gap-2 ${step.state === "upcoming" ? "text-muted" : "text-ink"} ${step.state === "current" ? "font-bold" : ""}`}
          >
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-line-strong" />}
            <span
              className={`inline-flex size-7 items-center justify-center rounded-full text-small font-semibold ${STEP_MARKER[step.state]}`}
            >
              {step.state === "done" ? <Icon name="check" className="size-4" /> : i + 1}
            </span>
            {step.label}
            {step.state === "done" && <span className="sr-only">, done</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SampleNotice({ banner }: { readonly banner: SampleBanner }): ReactNode {
  return (
    <aside aria-label={WORDS.sample} className="flex flex-col gap-1 rounded-control bg-brand-soft px-4 py-3 text-ink">
      <p className="flex items-start gap-2">
        <Icon name="info" />
        <span>
          <strong className="font-semibold">{WORDS.sample}.</strong> {WORDS.sample_notice}
          {banner.fixtureLabel && <span className="text-muted"> Showing {banner.fixtureLabel.toLowerCase()}.</span>}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 pl-7 text-small">
        {banner.personas.length > 0 && (
          <nav aria-label={WORDS.view_as} className="flex flex-wrap items-center gap-x-4">
            <span className="text-muted">{WORDS.view_as}</span>
            {banner.personas.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                aria-current={p.current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center underline-offset-4 ${p.current ? "font-bold text-ink" : "text-brand underline"}`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        )}
        <Link href={banner.indexHref} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
          {WORDS.all_samples}
        </Link>
      </div>
    </aside>
  );
}
