"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { WORDS } from "@/client/catalog";
import type { SampleWallet } from "@/lib/wallet/sample";
import { BUTTON } from "../button";
import { Icon } from "../icon";
import { AddressText } from "../values";
import { WALLET_STATUS_ACTION_ID } from "./wallet-status";
import { useSampleWallet, useWalletSession } from "./wallet-scope";

const PANEL_BUTTON = `${BUTTON.quiet} aria-disabled:cursor-not-allowed aria-disabled:text-muted aria-disabled:hover:bg-white`;

/**
 * The in-page stand-in for a wallet on sample pages. Styled like the sample banner so nobody mistakes
 * it for a real wallet. Returns null outside a sample page, so a live page can never show it.
 */
export function SampleWalletPanel(): ReactNode {
  const wallet = useSampleWallet();
  return wallet && <Panel wallet={wallet} />;
}

function Panel({ wallet }: { readonly wallet: SampleWallet }): ReactNode {
  const view = useSyncExternalStore(wallet.subscribe, wallet.view, wallet.view);
  const { session, expired } = useWalletSession();
  const { prompt } = view;
  const idle = prompt === null;

  const endSignIn = () => {
    if (!session) return;
    flushSync(() => expired(session));
    document.getElementById(WALLET_STATUS_ACTION_ID)?.focus();
  };

  return (
    <aside aria-label={WORDS.sample_wallet} className="mt-3 flex flex-col gap-3 rounded-control bg-brand-soft px-4 py-3 text-ink">
      <p className="flex items-start gap-2">
        <Icon name="wallet" />
        <span>
          <strong className="font-semibold">{WORDS.sample_wallet}.</strong> {WORDS.sample_wallet_note}
        </span>
      </p>
      <div className="grid gap-4 pl-7 wide:grid-cols-12">
        <fieldset className="flex flex-col wide:col-span-5">
          <legend className="text-small font-semibold text-muted">{WORDS.sample_account}</legend>
          {view.accounts.map((account) => (
            <label key={account.wallet} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="sample-wallet-account"
                checked={view.selected === account.wallet}
                onChange={() => wallet.select(account.wallet)}
                className="size-5 accent-brand"
              />
              {account.label}
              <AddressText value={account.wallet} form="short" />
            </label>
          ))}
        </fieldset>
        <section aria-labelledby="sample-wallet-requests" className="flex flex-col gap-2 wide:col-span-7">
          <p id="sample-wallet-requests" className="text-small font-semibold text-muted">
            {WORDS.sample_requests}
          </p>
          <p data-sample-prompt={prompt?.kind ?? "none"}>
            {prompt === null ? WORDS.no_requests : prompt.kind === "connect" ? WORDS.connect_request : WORDS.sign_request}
          </p>
          {prompt?.kind === "sign" && (
            <p className="rounded-control border border-line-strong bg-white px-3 py-2 text-small break-words">{prompt.text}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" aria-disabled={idle || undefined} onClick={() => wallet.approve()} className={PANEL_BUTTON}>
              {WORDS.approve}
            </button>
            <button type="button" aria-disabled={idle || undefined} onClick={() => wallet.reject()} className={PANEL_BUTTON}>
              {WORDS.reject}
            </button>
            {session && (
              <button type="button" onClick={endSignIn} className={BUTTON.link}>
                {WORDS.end_sign_in}
              </button>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
