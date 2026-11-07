"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ACTIONS, WORDS } from "@/client/catalog";
import type { Action, ActionsView } from "@/client/checkout-view";
import { BUTTON } from "./button";
import { Icon } from "./icon";
import { useWalletSession } from "./wallet/wallet-scope";

type Notice = { readonly text: string; readonly followUp: Action | null };

export function ActionGroup({
  actions,
  onEditDetails,
  children,
}: {
  readonly actions: ActionsView;
  readonly onEditDetails?: () => void;
  readonly children?: ReactNode;
}): ReactNode {
  const [notice, setNotice] = useState<Notice | null>(null);

  const run = async (action: Action) => {
    if (actions.sample && ACTIONS[action.kind].needs !== "nothing") {
      const outcome = action.kind === "create_checkout" ? WORDS.nothing_created : WORDS.nothing_sent;
      setNotice({
        text: `${ACTIONS[action.kind].label} ${WORDS.not_connected_in_sample} ${outcome}`,
        followUp: actions.sample.followUp,
      });
      return;
    }
    switch (action.kind) {
      case "copy_link":
        try {
          await navigator.clipboard.writeText(new URL(action.href, window.location.origin).href);
          setNotice({ text: WORDS.link_copied, followUp: null });
        } catch {
          setNotice({ text: WORDS.copy_failed, followUp: null });
        }
        return;
      case "edit_details":
        onEditDetails?.();
        return;
      case "reload_page":
        window.location.reload();
        return;
      default:
        setNotice({ text: `${ACTIONS[action.kind].label} ${WORDS.not_connected_yet} ${WORDS.nothing_sent}`, followUp: null });
    }
  };

  const stubbed =
    actions.sample !== null &&
    [actions.primary, ...actions.secondary].some(
      (a) => a !== null && a.kind !== "connect_wallet" && ACTIONS[a.kind].needs !== "nothing",
    );
  return (
    <div className="flex flex-col gap-4">
      {actions.primary && (
        <div>
          <ActionControl action={actions.primary} variant="primary" onRun={run} />
        </div>
      )}
      {children}
      {actions.secondary.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {actions.secondary.map((a) => (
            <ActionControl key={a.kind} action={a} variant={a.kind === "back_to_checkout" ? "link" : "quiet"} onRun={run} />
          ))}
        </div>
      )}
      <div role="status" className="flex flex-col gap-1 text-small">
        {notice ? (
          <>
            <p className="flex items-start gap-2 font-semibold">
              <Icon name="info" />
              {notice.text}
            </p>
            {notice.followUp && <ActionControl action={notice.followUp} variant="link" onRun={run} />}
          </>
        ) : (
          stubbed && <p className="text-muted">{WORDS.sample_caption}</p>
        )}
      </div>
    </div>
  );
}

function ActionControl({
  action,
  variant,
  onRun,
}: {
  readonly action: Action;
  readonly variant: keyof typeof BUTTON;
  readonly onRun: (action: Action) => void;
}): ReactNode {
  const meta = ACTIONS[action.kind];
  const dataAction = variant === "primary" ? "primary" : "secondary";
  if (action.kind === "connect_wallet") return <ConnectWallet variant={variant} dataAction={dataAction} />;
  if ("href" in action && meta.element === "external_link") {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" data-action={dataAction} className={BUTTON[variant]}>
        {meta.label}
        <Icon name="external" />
        <span className="sr-only"> {WORDS.opens_new_tab}</span>
      </a>
    );
  }
  if ("href" in action && meta.element === "link") {
    return (
      <Link href={action.href} data-action={dataAction} className={BUTTON[variant]}>
        {action.kind === "back_to_checkout" && <Icon name="arrow-left" />}
        {meta.label}
      </Link>
    );
  }
  return (
    <button type="button" data-action={dataAction} onClick={() => onRun(action)} className={BUTTON[variant]}>
      {action.kind === "copy_link" && <Icon name="copy" />}
      {meta.label}
    </button>
  );
}

function ConnectWallet({
  variant,
  dataAction,
}: {
  readonly variant: keyof typeof BUTTON;
  readonly dataAction: "primary" | "secondary";
}): ReactNode {
  const { view, connect } = useWalletSession();
  const action = view.connectAction;
  if (action === null) return null;
  if (action.kind === "get_phantom") {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" data-action={dataAction} className={BUTTON[variant]}>
        {action.label}
        <Icon name="external" />
        <span className="sr-only"> {WORDS.opens_new_tab}</span>
      </a>
    );
  }
  const busy = action.kind === "busy";
  return (
    <button
      type="button"
      data-action={dataAction}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : connect}
      className={`${BUTTON[variant]} aria-disabled:cursor-progress`}
    >
      {busy && <Icon name="spinner" />}
      {action.label}
    </button>
  );
}
