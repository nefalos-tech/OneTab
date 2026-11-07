"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ACTIONS, NETWORK_LABELS, SPOT_STATUSES, WORDS } from "@/client/catalog";
import {
  deriveCreateView,
  deriveReviewActions,
  spotNumber,
  type ClientRequestId,
  type CreateState,
  type CreateView,
} from "@/client/checkout-view";
import {
  checkDraft,
  previewTab,
  requestIdPerDetails,
  type DraftErrors,
  type DraftField,
  type DraftInput,
  type DraftReview,
} from "@/client/create-draft";
import { ActionGroup } from "./actions";
import { BUTTON } from "./button";
import { CopyButton } from "./copy-button";
import { Icon } from "./icon";
import { PageShell } from "./page-shell";
import { TabCard } from "./tab-card";
import { AddressText, Amount } from "./values";

type FormView = Extract<CreateView, { readonly kind: "form" }>;

const EMPTY: DraftInput = { title: "", seller: "", total: "", payerCount: "2" };
const FIELDS: readonly DraftField[] = ["title", "seller", "total", "payerCount"];

type Step =
  | { readonly kind: "form"; readonly focus: "heading" | DraftField | null }
  | { readonly kind: "review"; readonly requestId: ClientRequestId };

const firstError = (errors: DraftErrors): DraftField | undefined => FIELDS.find((f) => errors[f]);

export function CreateScreen({ state }: { readonly state: CreateState }): ReactNode {
  const view = deriveCreateView(state);
  if (view.kind === "unavailable") {
    return (
      <PageShell chrome={view.chrome} layout="single">
        <h1 className="text-title font-bold">Checkouts can&apos;t be created right now</h1>
        <p>{WORDS.creation_unavailable}</p>
        {view.samples && (
          <p className="flex flex-wrap gap-x-6">
            <Link href={view.samples.createHref} className={BUTTON.link}>
              {WORDS.try_sample}
            </Link>
            <Link href={view.samples.indexHref} className={BUTTON.link}>
              {WORDS.all_samples}
            </Link>
          </p>
        )}
      </PageShell>
    );
  }
  return <CreateForm view={view} />;
}

function CreateForm({ view }: { readonly view: FormView }): ReactNode {
  const [input, setInput] = useState<DraftInput>(EMPTY);
  const [touched, setTouched] = useState<ReadonlySet<DraftField>>(new Set());
  const [step, setStep] = useState<Step>({ kind: "form", focus: null });
  const [requestIdFor] = useState(() => requestIdPerDetails());
  const formHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  const ctx = { config: view.config, organizer: view.organizer };
  const check = checkDraft(input, ctx);
  const errors = check.ok ? {} : check.errors;
  const errorOf = (field: DraftField) => (touched.has(field) ? errors[field] : undefined);
  const sellerSignedInAtReview = step.kind === "review" && !check.ok;
  if (sellerSignedInAtReview) setStep({ kind: "form", focus: firstError(errors) ?? "heading" });
  const reviewing = step.kind === "review" && check.ok ? { review: check.review, requestId: step.requestId } : null;

  useEffect(() => {
    if (step.kind === "review") reviewHeading.current?.focus();
    else if (step.focus === "heading") formHeading.current?.focus();
    else if (step.focus !== null) {
      document.getElementById(step.focus === "payerCount" ? "payerCount-2" : step.focus)?.focus();
    }
  }, [step]);

  const set = (field: DraftField) => (value: string) => setInput((prev) => ({ ...prev, [field]: value }));
  const touch = (field: DraftField) => () => setTouched((prev) => new Set(prev).add(field));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(new Set(FIELDS));
    setStep(
      check.ok
        ? { kind: "review", requestId: requestIdFor(check.review.request) }
        : { kind: "form", focus: firstError(errors) ?? null },
    );
  };

  return (
    <PageShell
      chrome={view.chrome}
      layout="split"
      main={
        reviewing ? (
          <Review
            view={view}
            review={reviewing.review}
            clientRequestId={reviewing.requestId}
            headingRef={reviewHeading}
            onEdit={() => setStep({ kind: "form", focus: "heading" })}
          />
        ) : (
          <form noValidate onSubmit={submit} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 ref={formHeading} tabIndex={-1} className="text-title font-bold focus:outline-none">
                Split a purchase
              </h1>
              <p className="text-muted">
                Everyone pays an equal share in {WORDS.asset}, and the seller gets one payment.
              </p>
            </div>
            <TextField
              id="title"
              label="Checkout name"
              hint="What you're buying together, like Concert tickets."
              value={input.title}
              error={errorOf("title")}
              onChange={set("title")}
              onBlur={touch("title")}
            />
            <TextField
              id="seller"
              label="Seller wallet"
              hint="The Solana wallet that receives the payment. It can't be your own."
              value={input.seller}
              error={errorOf("seller")}
              onChange={set("seller")}
              onBlur={touch("seller")}
              mono
            />
            <TextField
              id="total"
              label={`Total in ${WORDS.asset}`}
              hint="The full price. Each payer's exact share appears in the preview."
              value={input.total}
              error={errorOf("total")}
              onChange={set("total")}
              onBlur={touch("total")}
              inputMode="decimal"
            />
            <fieldset aria-describedby={errorOf("payerCount") ? "payerCount-error" : undefined} className="flex flex-col gap-2">
              <legend className="mb-2 font-semibold">Split between</legend>
              <div className="flex gap-3">
                {(["2", "3"] as const).map((n) => (
                  <label
                    key={n}
                    className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-control border border-line-strong px-4 has-checked:border-brand has-checked:bg-brand-soft"
                  >
                    <input
                      type="radio"
                      id={`payerCount-${n}`}
                      name="payerCount"
                      value={n}
                      checked={input.payerCount === n}
                      onChange={() => set("payerCount")(n)}
                      className="size-5 accent-brand"
                    />
                    {n} payers
                  </label>
                ))}
              </div>
              <FieldError id="payerCount-error" message={errorOf("payerCount")} />
            </fieldset>
            <div>
              <button type="submit" data-action="primary" className={BUTTON.primary}>
                {ACTIONS.review_checkout.label}
              </button>
            </div>
          </form>
        )
      }
      side={<TabCard tab={reviewing ? reviewing.review.tab : previewTab(input, ctx)} heading="h2" hero showShares />}
    />
  );
}

function Review({
  view,
  review,
  clientRequestId,
  headingRef,
  onEdit,
}: {
  readonly view: FormView;
  readonly review: DraftReview;
  readonly clientRequestId: ClientRequestId;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly onEdit: () => void;
}): ReactNode {
  const { request, tab } = review;
  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-6">
      <h1 id="review-title" ref={headingRef} tabIndex={-1} className="text-title font-bold focus:outline-none">
        Check the details
      </h1>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 wide:grid-cols-3">
        <dt className="text-muted">Checkout name</dt>
        <dd className="break-words wide:col-span-2">{request.title}</dd>
        <dt className="text-muted">{WORDS.seller}</dt>
        <dd className="flex flex-col items-start gap-2 wide:col-span-2">
          <AddressText value={request.sellerWallet} form="full" />
          <CopyButton value={request.sellerWallet} labelSuffix="seller wallet" />
        </dd>
        <dt className="text-muted">{WORDS.total}</dt>
        <dd className="wide:col-span-2">
          <Amount value={tab.total} />
          <span className="block text-small text-muted">{NETWORK_LABELS[view.config.network]}</span>
        </dd>
      </dl>
      <section aria-labelledby="shares-title">
        <h2 id="shares-title" className="text-section font-bold">
          Each payer&apos;s share
        </h2>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {tab.spots.map((spot) => (
            <li key={spot.slot} className="flex items-center justify-between gap-4 py-3">
              <span className="flex items-center gap-2">
                <span className="text-muted">
                  {WORDS.spot} {spotNumber(spot.slot)}
                </span>
                {spot.isViewer ? (
                  <span className="rounded-control bg-brand px-2 text-small font-semibold text-white">{WORDS.you}</span>
                ) : (
                  SPOT_STATUSES.open.label
                )}
              </span>
              <Amount value={spot.share} />
            </li>
          ))}
        </ul>
      </section>
      <p className="flex items-start gap-2 rounded-control bg-brand-soft px-4 py-3">
        <Icon name="info" />
        These details can&apos;t change after you create the checkout.
      </p>
      <ActionGroup actions={deriveReviewActions(view, request, clientRequestId)} onEditDetails={onEdit} />
    </section>
  );
}

function TextField({
  id,
  label,
  hint,
  value,
  error,
  onChange,
  onBlur,
  inputMode,
  mono = false,
}: {
  readonly id: DraftField;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
  readonly inputMode?: "decimal";
  readonly mono?: boolean;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        id={id}
        name={id}
        value={value}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`min-h-11 w-full rounded-control border bg-white px-3 py-2 text-ink ${mono ? "font-mono" : ""} ${error ? "border-danger" : "border-line-strong"}`}
      />
      <p id={`${id}-hint`} className="text-small text-muted">
        {hint}
      </p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { readonly id: string; readonly message: string | undefined }): ReactNode {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-2 text-small text-danger">
      <Icon name="alert" className="size-4" />
      {message}
    </p>
  );
}
