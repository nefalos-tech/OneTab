import { describe, expect, expectTypeOf, it } from "vitest";
import type { Result } from "@/lib/wallet/environment";
import { checkoutApi, type FetchLike } from "./api";
import { ACTIONS, REQUEST_PROBLEMS, type ActionKind } from "./catalog";
import type { Action } from "./checkout-view";
import type { ClientRequestId, RoomSnapshot } from "./contracts";
import { SAMPLE_WALLETS } from "./fixture-data";
import { FIXTURES } from "./fixtures";
import { isLiveAction, liveActions, roomTracker, untracked, type LiveAction, type LiveKind, type Track } from "./live-actions";

type Call = { readonly method: string; readonly path: string; readonly body: unknown };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errorBody = (code: string) => ({ error: { code, message: "Something the browser never shows." } });

/** Answers each request with the next response in line, and records what was sent. */
function server(...responses: (() => Response | Promise<Response>)[]): { readonly fetch: FetchLike; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (path, init) => {
      calls.push({ method: String(init.method), path, body: init.body ? JSON.parse(String(init.body)) : null });
      const next = responses.shift();
      if (!next) throw new Error(`Unexpected request ${init.method} ${path}`);
      return next();
    },
  };
}

function shownBy(): { readonly track: Track; readonly shown: RoomSnapshot[] } {
  const shown: RoomSnapshot[] = [];
  return { shown, track: roomTracker((snapshot) => shown.push(snapshot)) };
}

const OPEN = FIXTURES["open-spots"].snapshot;
const JOINED: RoomSnapshot = {
  ...OPEN,
  participants: [...OPEN.participants, { slot: 2, wallet: SAMPLE_WALLETS.cam, shareUnits: OPEN.participants[1]!.shareUnits, ready: false }],
};
const FULL = FIXTURES["full-not-ready"].snapshot;
const ID = OPEN.checkout.id;
const REQUEST_ID = "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b" as ClientRequestId;
const CREATE: Extract<LiveAction, { kind: "create_checkout" }> = {
  kind: "create_checkout",
  request: {
    title: OPEN.checkout.title,
    sellerWallet: OPEN.checkout.sellerWallet,
    totalUnits: OPEN.checkout.totalUnits,
    payerCount: OPEN.checkout.payerCount,
  },
  clientRequestId: REQUEST_ID,
};
const JOIN: Extract<LiveAction, { kind: "join" }> = { kind: "join", checkoutId: ID };
const EXAMPLES: { readonly [K in LiveKind]: Extract<LiveAction, { kind: K }> } = { create_checkout: CREATE, join: JOIN };

describe("live actions", () => {
  it("create opens the new room's link, with no query", async () => {
    const { fetch } = server(() => json(201, { data: OPEN }));
    expect(await liveActions(checkoutApi(fetch)).run(CREATE, untracked)).toEqual({ kind: "open", href: `/checkouts/${ID}` });
  });

  it("create with no answer says trying again is safe, and trying again sends the same request ID", async () => {
    const { fetch, calls } = server(() => Promise.reject(new TypeError("fetch failed")), () => json(200, { data: OPEN }));
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(CREATE, untracked)).toEqual({ kind: "notice", text: REQUEST_PROBLEMS.unavailable });
    expect(await live.run(CREATE, untracked)).toEqual({ kind: "open", href: `/checkouts/${ID}` });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", "/api/checkouts", { ...CREATE.request, clientRequestId: REQUEST_ID }],
      ["POST", "/api/checkouts", { ...CREATE.request, clientRequestId: REQUEST_ID }],
    ]);
  });

  it("join puts the room it answers with on screen and has nothing to say", async () => {
    const { fetch, calls } = server(() => json(200, { data: JOINED }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(JOIN, track)).toEqual({ kind: "done" });
    expect(shown).toEqual([JOINED]);
    expect(calls.map((c) => [c.method, c.path])).toEqual([["POST", `/api/checkouts/${ID}/join`]]);
  });

  it("join to a room that filled first reads the room again and shows it full", async () => {
    const fullRoom = { ...FULL, checkout: { ...FULL.checkout, id: ID } };
    const { fetch, calls } = server(() => json(409, errorBody("ROOM_FULL")), () => json(200, { data: fullRoom }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(JOIN, track)).toEqual({ kind: "done" });
    expect(shown).toEqual([fullRoom]);
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ["POST", `/api/checkouts/${ID}/join`],
      ["GET", `/api/checkouts/${ID}`],
    ]);
  });

  it("join to a full room says someone took the last spot when the room can't be read again", async () => {
    const { fetch } = server(() => json(409, errorBody("ROOM_FULL")), () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).run(JOIN, track)).toEqual({ kind: "notice", text: REQUEST_PROBLEMS.room_full });
    expect(shown).toEqual([]);
  });

  it("an ended sign-in on create or join is signed_out, with no notice and nothing shown", async () => {
    const { fetch } = server(() => json(401, errorBody("UNAUTHENTICATED")), () => json(401, errorBody("UNAUTHENTICATED")));
    const { track, shown } = shownBy();
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(CREATE, track)).toEqual({ kind: "signed_out" });
    expect(await live.run(JOIN, track)).toEqual({ kind: "signed_out" });
    expect(shown).toEqual([]);
  });

  it("a refused or rate-limited join says so and changes nothing", async () => {
    const { fetch } = server(() => json(403, errorBody("ORIGIN_MISMATCH")), () => json(429, errorBody("RATE_LIMITED")));
    const { track, shown } = shownBy();
    const live = liveActions(checkoutApi(fetch));
    expect(await live.run(JOIN, track)).toEqual({ kind: "notice", text: REQUEST_PROBLEMS.refused });
    expect(await live.run(JOIN, track)).toEqual({ kind: "notice", text: REQUEST_PROBLEMS.rate_limited });
    expect(shown).toEqual([]);
  });

  it("refresh reads the room through the tracker", async () => {
    const { fetch } = server(() => json(200, { data: OPEN }));
    const { track, shown } = shownBy();
    expect(await liveActions(checkoutApi(fetch)).refresh(ID, track)).toEqual({ ok: true, value: OPEN });
    expect(shown).toEqual([OPEN]);
  });

  it("is live exactly for the actions with a busy label, and runs each of them", async () => {
    expectTypeOf<LiveKind>().toEqualTypeOf<"create_checkout" | "join">();
    for (const kind of Object.keys(ACTIONS) as ActionKind[]) {
      expect(isLiveAction({ kind } as Action), kind).toBe(kind in EXAMPLES);
    }
    for (const action of Object.values(EXAMPLES)) {
      const { fetch, calls } = server(() => json(200, { data: OPEN }));
      await liveActions(checkoutApi(fetch)).run(action, untracked);
      expect(calls, action.kind).toHaveLength(1);
    }
  });
});

type Request = { readonly intent: "read" | "write"; readonly ok: boolean };
type Step = { readonly kind: "send" | "answer"; readonly index: number };

/** Every order of sends and answers where requests are sent in index order and each answer follows its send. */
function interleavings(count: number): Step[][] {
  const orders: Step[][] = [];
  const walk = (sent: number, answered: ReadonlySet<number>, steps: Step[]) => {
    if (steps.length === 2 * count) {
      orders.push(steps);
      return;
    }
    if (sent < count) walk(sent + 1, answered, [...steps, { kind: "send", index: sent }]);
    for (let i = 0; i < sent; i++) {
      if (!answered.has(i)) walk(sent, new Set([...answered, i]), [...steps, { kind: "answer", index: i }]);
    }
  };
  walk(0, new Set(), []);
  return orders;
}

function scenarios(): Request[][] {
  const options: Request[] = [
    { intent: "read", ok: true },
    { intent: "read", ok: false },
    { intent: "write", ok: true },
    { intent: "write", ok: false },
  ];
  const grow = (lists: Request[][]) => lists.flatMap((list) => options.map((r) => [...list, r]));
  const one = options.map((r) => [r]);
  const two = grow(one);
  return [...one, ...two, ...grow(two)];
}

const SNAPSHOTS = [OPEN, FULL, FIXTURES.ready.snapshot];
const label = (requests: Request[]) => requests.map((r) => `${r.intent} ${r.ok ? "ok" : "fails"}`).join(", ");

describe("roomTracker, in every order of sends and answers", () => {
  it.each(scenarios().map((requests) => [label(requests), requests] as const))("%s", async (_, requests) => {
    for (const order of interleavings(requests.length)) {
      const shown: number[] = [];
      const track = roomTracker((snapshot) => shown.push(SNAPSHOTS.indexOf(snapshot)));
      const answers = requests.map((r, i): Result<RoomSnapshot, "unavailable"> =>
        r.ok ? { ok: true, value: SNAPSHOTS[i]! } : { ok: false, failure: "unavailable" },
      );
      const release: (() => void)[] = [];
      const pending: Promise<Result<RoomSnapshot, "unavailable">>[] = [];
      const writesOpen = new Set<number>();
      const straddles = new Set<number>();
      const where = order.map((s) => `${s.kind} ${s.index}`).join(", ");

      for (const step of order) {
        const request = requests[step.index]!;
        if (step.kind === "send") {
          if (request.intent === "read" && writesOpen.size > 0) straddles.add(step.index);
          if (request.intent === "write") writesOpen.add(step.index);
          pending[step.index] = track(request.intent, () => new Promise((resolve) => (release[step.index] = () => resolve(answers[step.index]!))));
          continue;
        }
        const newestBefore = Math.max(-1, ...shown);
        release[step.index]!();
        expect(await pending[step.index], where).toBe(answers[step.index]);
        writesOpen.delete(step.index);
        const shows = request.ok && !straddles.has(step.index) && step.index > newestBefore;
        expect(shown.at(-1) ?? -1, `${where}: answer ${step.index}`).toBe(shows ? step.index : newestBefore);
      }
      const eligible = requests.flatMap((r, i) => (r.ok && !straddles.has(i) ? [i] : []));
      expect(shown.at(-1) ?? -1, `${where}: last shown`).toBe(Math.max(-1, ...eligible));
      expect(shown, `${where}: never older after newer`).toEqual([...shown].sort((a, b) => a - b));
    }
  });
});
