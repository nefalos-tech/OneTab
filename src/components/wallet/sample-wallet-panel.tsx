"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { WORDS } from "@/client/catalog";
import type { SampleWallet } from "@/lib/wallet/sample";
import { BUTTON } from "../button";
import { Icon } from "../icon";
import { AddressText } from "../values";
import { WALLET_STATUS_ACTION_ID } from "./wallet-status";
import { useSampleWallet, useWalletSession } from "./wallet-scope";

const ACCOUNTS_ID = "sample-wallet-accounts";

const PROMPT_WORDS = {
  connect: { request: WORDS.connect_request, announcement: WORDS.connect_request_announcement },
  sign: { request: WORDS.sign_request, announcement: WORDS.sign_request_announcement },
} as const;

export function SampleWalletPanel(): ReactNode {
  const wallet = useSampleWallet();
  return wallet && <Panel wallet={wallet} />;
}

function Panel({ wallet }: { readonly wallet: SampleWallet }): ReactNode {
  const view = useSyncExternalStore(wallet.subscribe, wallet.view, wallet.view);
  const { session, expired } = useWalletSession();
  const [accountsOpen, setAccountsOpen] = useState(false);
  const switchAccount = useRef<HTMLButtonElement>(null);
  const { prompt } = view;
  const selected = view.accounts.find((account) => account.wallet === view.selected);

  const endSignIn = () => {
    if (!session) return;
    flushSync(() => expired(session));
    document.getElementById(WALLET_STATUS_ACTION_ID)?.focus();
  };

  const answer = (send: () => void) => {
    flushSync(send);
    switchAccount.current?.focus();
  };

  return (
    <aside aria-label={WORDS.sample_wallet} className="mt-3 flex flex-col gap-3 rounded-control bg-brand-soft px-4 py-1 text-ink">
      <div className="flex flex-wrap items-center gap-x-4">
        <p className="flex items-center gap-2">
          <Icon name="wallet" />
          <strong className="font-semibold">{WORDS.sample_wallet}</strong>
        </p>
        {selected && (
          <p className="flex items-center gap-2">
            {selected.label}
            <AddressText value={selected.wallet} form="short" />
          </p>
        )}
        {session && (
          <button type="button" onClick={endSignIn} className={BUTTON.link}>
            {WORDS.end_sign_in}
          </button>
        )}
        <button
          ref={switchAccount}
          type="button"
          aria-expanded={accountsOpen}
          aria-controls={ACCOUNTS_ID}
          onClick={() => setAccountsOpen(!accountsOpen)}
          className={BUTTON.link}
        >
          {WORDS.switch_account}
        </button>
      </div>
      {(accountsOpen || prompt) && <p className="pl-7 text-small text-muted">{WORDS.sample_wallet_note}</p>}
      {accountsOpen && (
        <fieldset id={ACCOUNTS_ID} className="flex flex-col pl-7">
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
      )}
      {prompt && (
        <div className="flex flex-col gap-2 pb-2 pl-7">
          <p data-sample-prompt={prompt.kind} className="font-semibold">
            {PROMPT_WORDS[prompt.kind].request}
          </p>
          {prompt.kind === "sign" && (
            <p className="rounded-control border border-line-strong bg-white px-3 py-2 text-small break-words">{prompt.text}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => answer(() => wallet.approve())} className={BUTTON.quiet}>
              {WORDS.approve}
            </button>
            <button type="button" onClick={() => answer(() => wallet.reject())} className={BUTTON.quiet}>
              {WORDS.reject}
            </button>
          </div>
        </div>
      )}
      <p role="status" className="sr-only">
        {prompt && PROMPT_WORDS[prompt.kind].announcement}
      </p>
    </aside>
  );
}
