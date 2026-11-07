import Link from "next/link";
import { ACTIONS, NETWORK_LABELS } from "@/client/catalog";
import { BUTTON } from "@/components/button";
import { SiteHeader } from "@/components/page-shell";

export default function NotFound() {
  return (
    <>
      <SiteHeader networkLabel={NETWORK_LABELS.devnet} />
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-result flex-col gap-4 px-6 py-16 focus:outline-none">
        <h1 className="text-title font-bold">We can&apos;t find this checkout.</h1>
        <p>Check the link with the person who shared it, or create a new checkout.</p>
        <p>
          <Link href="/" className={BUTTON.primary}>
            {ACTIONS.create_a_checkout.label}
          </Link>
        </p>
      </main>
    </>
  );
}
