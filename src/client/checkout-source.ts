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

export type CheckoutRouteProps = {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: SearchParams;
};

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

export async function loadCreate(props: { readonly searchParams: SearchParams }): Promise<CreateState> {
  const [query, fixturesOn] = await Promise.all([props.searchParams, fixturesEnabled()]);
  if (query.sample !== undefined) {
    if (!fixturesOn) notFound();
    return sampleCreateState();
  }
  return { config: null, session: null, source: { kind: "live", samplesOn: fixturesOn } };
}

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
