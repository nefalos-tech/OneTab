import { NETWORK_LABELS } from "@/client/catalog";
import { SiteHeader } from "@/components/page-shell";

const BLOCK = "rounded-control bg-brand-soft";

/** Room-shaped placeholders, so nothing shifts when the checkout arrives. */
export default function Loading() {
  return (
    <>
      <SiteHeader networkLabel={NETWORK_LABELS.devnet} viewerWallet={null} />
      <main id="main" tabIndex={-1} aria-busy="true" className="mx-auto max-w-content px-6 pt-8 pb-16 focus:outline-none">
        <p role="status" className="sr-only">
          Loading the checkout
        </p>
        <div aria-hidden="true" className="flex flex-col gap-8">
          <div className={`h-10 w-2/3 ${BLOCK}`} />
          <div className="grid gap-8 wide:grid-cols-12">
            <div className="flex flex-col gap-8 wide:col-span-7">
              <div className="h-64 rounded-card bg-brand-soft" />
              <div className={`h-40 ${BLOCK}`} />
            </div>
            <div className="flex flex-col gap-4 wide:col-span-5">
              <div className={`h-10 w-1/2 ${BLOCK}`} />
              <div className={`h-16 ${BLOCK}`} />
              <div className={`h-11 w-40 ${BLOCK}`} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
