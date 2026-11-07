import type { ReactNode } from "react";
import { WORDS, type Situation, type Tone } from "@/client/catalog";
import type { ActionsView, StatusView, YouView } from "@/client/checkout-view";
import { ActionGroup } from "./actions";
import { Icon, type IconName } from "./icon";
import { Amount } from "./values";

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

export function StatusPanel({
  status,
  you,
  actions,
  heading,
  reason = null,
  children,
}: {
  readonly status: StatusView;
  readonly you: YouView | null;
  readonly actions: ActionsView;
  readonly heading: "h1" | "h2";
  readonly reason?: string | null;
  readonly children?: ReactNode;
}): ReactNode {
  const Heading = heading;
  return (
    <section data-situation={status.situation} aria-labelledby="status-label" className="flex flex-col gap-4">
      <Heading
        id="status-label"
        className={`flex items-center gap-2 self-start rounded-control px-3 py-2 text-section font-bold ${TONE[status.tone]}`}
      >
        <Icon name={ICON[status.situation]} />
        <span data-status-label="">{status.label}</span>
      </Heading>
      <p role="status" data-status-line="" className="max-w-prose">
        {status.line}
      </p>
      {reason && (
        <p data-status-reason="" className="max-w-prose text-muted">
          {reason}
        </p>
      )}
      {you && (
        <div className="border-l-4 border-accent pl-4">
          <h3 className="font-semibold text-muted">{WORDS.your_share}</h3>
          <p>
            <Amount value={you.share} size="hero" />
          </p>
        </div>
      )}
      <ActionGroup actions={actions}>{children}</ActionGroup>
    </section>
  );
}
