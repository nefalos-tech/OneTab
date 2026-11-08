import { createContext, use, useEffect, useRef, type ReactNode } from "react";
import { WORDS, type Situation, type Tone } from "@/client/catalog";
import type { ActionsView, ApprovalView, Reason, StatusView, YouView } from "@/client/checkout-view";
import { ActionGroup } from "./actions";
import { CopyButton } from "./copy-button";
import { Icon, type IconName } from "./icon";
import { AddressText, Amount } from "./values";

const TONE: { readonly [T in Tone]: string } = {
  neutral: "border border-line-strong text-ink",
  info: "bg-brand-soft text-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

const ICON: { readonly [S in Situation]: IconName } = {
  open_spots: "clock",
  full_not_ready: "clock",
  ready: "check",
  preparing: "spinner",
  signing: "clock",
  submitting: "spinner",
  confirming: "spinner",
  unresolved: "spinner",
  declined: "alert",
  failed: "failed",
  expired: "alert",
  paid: "check",
};

/** True on the screen a live page moved the viewer to, so it reads the new status first. */
export const ArrivedByMove = createContext(false);

export function StatusPanel({
  status,
  you,
  approval = null,
  actions,
  heading,
  reason = null,
  connection,
  children,
}: {
  readonly status: StatusView;
  readonly you: YouView | null;
  readonly approval?: ApprovalView | null;
  readonly actions: ActionsView;
  readonly heading: "h1" | "h2";
  readonly reason?: Reason | null;
  readonly connection: string | null;
  readonly children?: ReactNode;
}): ReactNode {
  const Heading = heading;
  const block = useRef<HTMLDivElement>(null);
  const arrived = use(ArrivedByMove);
  useEffect(() => {
    if (arrived) block.current?.focus();
  }, [arrived]);
  return (
    <section
      data-situation={status.situation}
      data-attempt={status.attempt ?? undefined}
      aria-labelledby="status-label"
      className="flex flex-col gap-4"
    >
      <Heading
        id="status-label"
        className={`flex items-center gap-2 self-start rounded-control px-3 py-2 text-section font-bold ${TONE[status.tone]}`}
      >
        <Icon name={ICON[status.situation]} />
        <span data-status-label="">{status.label}</span>
      </Heading>
      <div ref={block} role="status" tabIndex={-1} data-status-block="" className="flex flex-col gap-4 focus:outline-none">
        <p data-status-line="" className="max-w-prose">
          {status.line}
        </p>
        {connection && (
          <p data-connection="" className="flex items-start gap-2 text-small text-muted">
            <Icon name="alert" />
            {connection}
          </p>
        )}
        {reason && (
          <div data-status-reason="" data-reason-from={reason.from} className="flex max-w-prose flex-col gap-1 text-muted">
            <p>{reason.happened}</p>
            {reason.next && <p>{reason.next}</p>}
          </div>
        )}
      </div>
      {approval ? (
        <ApprovalSummary approval={approval} />
      ) : (
        you && (
          <div className="border-l-4 border-accent pl-4">
            <h3 className="font-semibold text-muted">{WORDS.your_share}</h3>
            <p>
              <Amount value={you.share} size="hero" />
            </p>
          </div>
        )
      )}
      <ActionGroup actions={actions} fallbackFocus={block}>
        {children}
      </ActionGroup>
    </section>
  );
}

function ApprovalSummary({ approval }: { readonly approval: ApprovalView }): ReactNode {
  return (
    <div className="flex flex-col gap-4 border-l-4 border-accent pl-4">
      <div>
        <h3 className="font-semibold text-muted">{WORDS.your_share}</h3>
        <p>
          <Amount value={approval.share} size="hero" />
        </p>
      </div>
      <dl className="flex flex-col gap-3">
        <div>
          <dt className="text-small text-muted">{WORDS.seller}</dt>
          <dd className="flex items-start justify-between gap-3">
            <AddressText value={approval.seller} form="full" />
            <CopyButton value={approval.seller} labelSuffix={WORDS.seller_wallet} />
          </dd>
        </div>
        <div>
          <dt className="text-small text-muted">{WORDS.total}</dt>
          <dd>
            <Amount value={approval.total} />
            <span className="block text-small text-muted">{approval.network}</span>
          </dd>
        </div>
        <div>
          <dt className="text-small text-muted">{WORDS.network_fee}</dt>
          <dd>{approval.fee}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 rounded-control bg-brand-soft px-4 py-3">
        <Icon name="info" />
        {WORDS.approval_covers}
      </p>
    </div>
  );
}
