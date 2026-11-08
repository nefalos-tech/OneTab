"use client";

import type { ReactNode } from "react";
import { WORDS } from "@/client/catalog";
import type { WalletView } from "@/client/wallet-view";
import { currentSignInNote } from "@/lib/wallet/sign-in-diagnostic";
import { BUTTON } from "../button";
import { Icon } from "../icon";
import { WALLET_CONTROL_ID } from "./wallet-control";
import { useWalletSession } from "./wallet-scope";

export const WALLET_STATUS_ACTION_ID = "wallet-status-action";

/** The polite region always exists, so every change is announced. */
export function WalletStatus(): ReactNode {
  const { view, cancel, connect } = useWalletSession();
  const { status } = view;
  const shown = status?.kind === "waiting" || status?.kind === "problem" ? status : null;
  const note = shown ? currentSignInNote() : null;
  return (
    <div className="mx-auto max-w-content px-6">
      <div
        data-wallet-status={shown?.kind}
        className={
          shown
            ? `mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-control px-4 py-2 ${shown.kind === "problem" ? "bg-warning-soft text-warning" : "bg-brand-soft text-ink"}`
            : ""
        }
      >
        <p role="status" data-wallet-line="" className={shown ? "flex items-start gap-2 py-1 font-semibold" : "sr-only"}>
          {shown && <Icon name={shown.kind === "problem" ? "alert" : "spinner"} />}
          {status?.text}
        </p>
        {note ? (
          <p data-signin-note="" className="basis-full text-small text-muted">
            {note}
          </p>
        ) : null}
        {shown && <StatusAction status={shown} onCancel={cancel} onFix={connect} />}
      </div>
    </div>
  );
}

function StatusAction({
  status,
  onCancel,
  onFix,
}: {
  readonly status: Extract<WalletView["status"], { readonly kind: "waiting" | "problem" }>;
  readonly onCancel: () => void;
  readonly onFix: () => void;
}): ReactNode {
  if (status.kind === "problem" && status.fix.kind === "get_phantom") {
    return (
      <a id={WALLET_STATUS_ACTION_ID} href={status.fix.href} target="_blank" rel="noreferrer" className={BUTTON.quiet}>
        {status.fix.label}
        <Icon name="external" />
        <span className="sr-only"> {WORDS.opens_new_tab}</span>
      </a>
    );
  }
  return (
    <button
      id={WALLET_STATUS_ACTION_ID}
      type="button"
      onClick={() => {
        if (status.kind === "problem") return onFix();
        onCancel();
        document.getElementById(WALLET_CONTROL_ID)?.focus();
      }}
      className={BUTTON.quiet}
    >
      {status.kind === "problem" ? status.fix.label : WORDS.cancel}
    </button>
  );
}
