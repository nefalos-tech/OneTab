import type { ReactNode } from "react";
import { WORDS } from "@/client/catalog";
import { deriveResultView, spotNumber, type CheckoutState, type ReceiptView, type ResultBody } from "@/client/checkout-view";
import { CopyButton } from "./copy-button";
import { PageShell } from "./page-shell";
import { StatusPanel } from "./status-panel";
import { TabCard } from "./tab-card";
import { AddressText, Amount } from "./values";

export function ResultScreen({ state }: { readonly state: CheckoutState }): ReactNode {
  const view = deriveResultView(state);
  return (
    <PageShell chrome={view.chrome} layout="single">
      <div className="rounded-card border border-line p-6 wide:p-8">
        <StatusPanel
          status={view.status}
          you={null}
          actions={view.actions}
          heading="h1"
          reason={view.body.kind === "failed" ? view.body.reason : null}
          connection={view.connection}
        >
          <ResultDetails body={view.body} />
        </StatusPanel>
      </div>
      <TabCard tab={view.tab} heading="h2" hero={false} />
    </PageShell>
  );
}

const APPROVALS = { preparing: WORDS.approvals_soon, signing: WORDS.approvals_open } as const;

function ResultDetails({ body }: { readonly body: ResultBody }): ReactNode {
  switch (body.kind) {
    case "not_started":
      return <p className="text-muted">{WORDS.no_payment_yet}</p>;
    case "approvals":
      return <p className="text-muted">{APPROVALS[body.stage]}</p>;
    case "in_progress":
    case "unresolved":
    case "failed":
    case "stopped":
      return <Reference value={body.transactionReference} />;
    case "paid":
      return <Receipt receipt={body.receipt} />;
  }
}

function Reference({ value }: { readonly value: string | null }): ReactNode {
  if (value === null) return null;
  return (
    <dl className="flex flex-col gap-1 text-small">
      <dt className="text-muted">{WORDS.transaction_reference}</dt>
      <dd className="flex flex-col items-start gap-2">
        <AddressText value={value} form="full" />
        <CopyButton value={value} labelSuffix={WORDS.transaction_reference.toLowerCase()} />
      </dd>
    </dl>
  );
}

function Receipt({ receipt }: { readonly receipt: ReceiptView }): ReactNode {
  return (
    <section aria-labelledby="receipt-title" className="flex flex-col gap-4 border-t border-line pt-4">
      <h2 id="receipt-title" className="text-section font-bold">
        {WORDS.receipt}
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 wide:grid-cols-3">
        <dt className="text-muted">{WORDS.total}</dt>
        <dd className="wide:col-span-2">
          <Amount value={receipt.total} />
        </dd>
        <dt className="text-muted">{WORDS.seller}</dt>
        <dd className="wide:col-span-2">
          <AddressText value={receipt.seller} form="full" />
        </dd>
        <dt className="text-muted">{WORDS.finalized_at}</dt>
        <dd className="wide:col-span-2">{receipt.observedAt}</dd>
      </dl>
      <ul className="divide-y divide-line border-y border-line">
        {receipt.contributions.map((c) => (
          <li key={c.slot} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
            <span className="flex items-center gap-2">
              <span className="text-muted">
                {WORDS.spot} {spotNumber(c.slot)}
              </span>
              {c.isViewer && <span className="rounded-control bg-brand px-2 text-small font-semibold text-white">{WORDS.you}</span>}
              <AddressText value={c.wallet} form="short" />
            </span>
            <Amount value={c.amount} />
          </li>
        ))}
      </ul>
      <Reference value={receipt.transactionReference} />
      {receipt.explorerUrl === null && (
        <p className="text-small text-muted">This is a sample receipt, so there is no real transaction to view on Solana Explorer.</p>
      )}
    </section>
  );
}
