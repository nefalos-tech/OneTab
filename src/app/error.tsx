"use client";

import Link from "next/link";
import { ACTIONS, NETWORK_LABELS, WORDS } from "@/client/catalog";
import { BUTTON } from "@/components/button";
import { SiteHeader } from "@/components/page-shell";

export default function ErrorPage({ retry }: { readonly error: unknown; readonly retry: () => void }) {
  return (
    <>
      <SiteHeader networkLabel={NETWORK_LABELS.devnet} viewerWallet={null} />
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-result flex-col gap-4 px-6 py-16 focus:outline-none">
        <h1 className="text-title font-bold">This page didn&apos;t load</h1>
        <p role="alert">Something went wrong while loading this page. Nothing was sent from it.</p>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={retry} className={BUTTON.primary}>
            {ACTIONS.reload_page.label}
          </button>
          <Link href="/" className={BUTTON.link}>
            {WORDS.home}
          </Link>
        </div>
      </main>
    </>
  );
}
