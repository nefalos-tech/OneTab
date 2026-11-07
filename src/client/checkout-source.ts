/**
 * Where pages get their data, and the only module that reads the environment or calls notFound().
 * Pages may import it; components may not (eslint.config.mjs). F3 fills the live branches and keeps
 * these signatures, so pages and screens don't change.
 */
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { CheckoutState, CreateState } from "./checkout-view";
import {
  parseCheckoutRef,
  parseFixtureFlag,
  sampleCheckoutState,
  sampleCreateState,
  sampleIndex,
  type SampleIndexEntry,
} from "./fixtures";

export type { SampleIndexEntry };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Satisfied by PageProps<"/checkouts/[id]"> and PageProps<"/checkouts/[id]/result">. */
export type CheckoutRouteProps = {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: SearchParams;
};

/**
 * The room and result pages call this and nothing else. A UUID never yields sample data.
 *
 * TODO(F3): load config, session and snapshot for a live id. CHECKOUT_NOT_FOUND becomes notFound();
 * CONFIGURATION_UNAVAILABLE and network errors reach the error boundary, never a sample.
 * TODO(F4, F5): when polling arrives, move a viewer to the owner screen only when the polled state
 * changes owner (SITUATIONS[s].owner), never on first load, so Back to checkout never bounces back.
 */
export async function loadCheckout(props: CheckoutRouteProps): Promise<CheckoutState> {
  const [{ id }, query, fixturesOn] = await Promise.all([props.params, props.searchParams, fixturesEnabled()]);
  const ref = parseCheckoutRef({ id, as: query.as, fixturesOn });
  if (ref?.kind !== "sample") notFound();
  return sampleCheckoutState(ref);
}

/**
 * The checkout layout calls this before its loading boundary streams, so an unknown or gated
 * address answers with a real 404 status instead of a 200 page that says not found.
 */
export async function requireCheckoutAddress(params: Promise<{ readonly id: string }>): Promise<void> {
  const [{ id }, fixturesOn] = await Promise.all([params, fixturesEnabled()]);
  if (parseCheckoutRef({ id, as: undefined, fixturesOn })?.kind !== "sample") notFound();
}

/** `/?sample` selects sample data explicitly. Plain `/` is the live create screen. */
export async function loadCreate(props: { readonly searchParams: SearchParams }): Promise<CreateState> {
  const [query, fixturesOn] = await Promise.all([props.searchParams, fixturesEnabled()]);
  if (query.sample !== undefined) {
    if (!fixturesOn) notFound();
    return sampleCreateState();
  }
  // TODO(F3): config from GET /api/config and session from GET /api/auth/session.
  return { config: null, session: null, source: { kind: "live", samplesOn: fixturesOn } };
}

/** The /samples page. 404 while sample data is off. */
export async function loadSampleIndex(): Promise<readonly SampleIndexEntry[]> {
  if (!(await fixturesEnabled())) notFound();
  return sampleIndex();
}

/**
 * Read per request, so `next start` honors the environment it started with and no page bakes the
 * build machine's answer into static HTML.
 */
async function fixturesEnabled(): Promise<boolean> {
  await connection();
  return parseFixtureFlag(process.env.ONETAB_FIXTURES, process.env.NODE_ENV);
}
