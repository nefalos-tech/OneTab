import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { apiOrigin, checkoutApi, originFetch } from "./api";
import { checkoutLinks, type CheckoutState, type CreateState } from "./checkout-view";
import type { CheckoutId, RoomSnapshot } from "./contracts";
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

const serverApi = checkoutApi(originFetch(process.env));

/**
 * The layout, generateMetadata and the page each ask for the room. Next doesn't memoize a fetch that
 * carries a timeout signal, so React's cache is what gives them one read per request.
 */
const readRoom = cache((id: CheckoutId) => serverApi.readRoom(id));

export async function loadCheckout(props: CheckoutRouteProps): Promise<CheckoutState> {
  const [{ id }, query, fixturesOn] = await Promise.all([props.params, props.searchParams, fixturesEnabled()]);
  const ref = parseCheckoutRef({ id, as: query.as, fixturesOn });
  if (ref === null) notFound();
  if (ref.kind === "sample") return sampleCheckoutState(ref);
  return {
    snapshot: await liveRoom(ref.checkoutId),
    session: null,
    source: { kind: "live", links: checkoutLinks(ref.checkoutId) },
  };
}

export async function requireCheckoutAddress(params: Promise<{ readonly id: string }>): Promise<void> {
  const [{ id }, fixturesOn] = await Promise.all([params, fixturesEnabled()]);
  const ref = parseCheckoutRef({ id, as: undefined, fixturesOn });
  if (ref === null) notFound();
  if (ref.kind === "live") await liveRoom(ref.checkoutId);
}

export async function loadCreate(props: { readonly searchParams: SearchParams }): Promise<CreateState> {
  const [query, fixturesOn] = await Promise.all([props.searchParams, fixturesEnabled()]);
  if (query.sample !== undefined) {
    if (!fixturesOn) notFound();
    return sampleCreateState();
  }
  const config = await serverApi.readConfig();
  if (!config.ok) console.error(`GET /api/config failed, so the create screen says creation is unavailable. ${originNote()}`);
  return { config: config.ok ? config.value : null, session: null, source: { kind: "live", samplesOn: fixturesOn } };
}

export async function loadSampleIndex(): Promise<readonly SampleIndexEntry[]> {
  if (!(await fixturesEnabled())) notFound();
  return sampleIndex();
}

async function liveRoom(id: CheckoutId): Promise<RoomSnapshot> {
  const room = await readRoom(id);
  if (room.ok) return room.value;
  if (room.failure === "not_found") notFound();
  throw new Error(`Checkout ${id} didn't load. ${originNote()}`);
}

function originNote(): string {
  const origin = apiOrigin(process.env);
  return origin === null ? "No API origin is set. Set ONETAB_API_ORIGIN or APP_ORIGIN." : `The API origin is ${origin}.`;
}

/**
 * Read per request, so `next start` honors the environment it started with and no page bakes the
 * build machine's answer into static HTML.
 */
async function fixturesEnabled(): Promise<boolean> {
  await connection();
  return parseFixtureFlag(process.env.ONETAB_FIXTURES, process.env.NODE_ENV);
}
