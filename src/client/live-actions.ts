import type { Result } from "@/lib/wallet/environment";
import { checkoutApi, type CheckoutApi, type RequestProblem, type RoomReadProblem } from "./api";
import { ACTIONS, REQUEST_PROBLEMS, type ActionKind } from "./catalog";
import { checkoutLinks, type Action } from "./checkout-view";
import type { CheckoutId, RoomSnapshot } from "./contracts";

/** The actions ActionGroup sends to the backend: exactly the ones with a busy label in ACTIONS. */
export type LiveKind = {
  [K in ActionKind]: (typeof ACTIONS)[K] extends { readonly busy: string } ? K : never;
}[ActionKind];
export type LiveAction = Extract<Action, { readonly kind: LiveKind }>;

export function isLiveAction(action: Action): action is LiveAction {
  return "busy" in ACTIONS[action.kind];
}

/**
 * What ActionGroup does after a live action.
 * - done: the room shows the reply, or a newer one.
 * - open: go to a new checkout's room.
 * - signed_out: the server ended the sign-in. The wallet status explains it.
 * - notice: say why nothing changed. The button stays, so trying again is the same click.
 */
export type Outcome =
  | { readonly kind: "done" }
  | { readonly kind: "open"; readonly href: string }
  | { readonly kind: "signed_out" }
  | { readonly kind: "notice"; readonly text: string };

/**
 * Sends a request that answers with the room, and puts the answer on screen when it is the newest.
 * Returns the answer unchanged. A write changes the room, such as a join. A read only fetches it.
 */
export type Track = <F extends string>(
  intent: "read" | "write",
  request: () => Promise<Result<RoomSnapshot, F>>,
) => Promise<Result<RoomSnapshot, F>>;

/** For screens outside a live room, such as create. Shows nothing. */
export const untracked: Track = (_intent, request) => request();

/**
 * The only writer of the snapshot a live room shows after its server load. Each request takes a ticket
 * when it is sent, and an answer shows only when its ticket is newer than the one on screen, so the last
 * request sent wins. A read sent while a write is in flight never shows, because it may describe the room
 * before that write. A failed answer shows nothing.
 */
export function roomTracker(show: (snapshot: RoomSnapshot) => void): Track {
  let sent = 0;
  let shown = 0;
  let writesInFlight = 0;
  return async (intent, request) => {
    sent += 1;
    const ticket = sent;
    const straddlesWrite = intent === "read" && writesInFlight > 0;
    if (intent === "write") writesInFlight += 1;
    try {
      const answer = await request();
      if (answer.ok && !straddlesWrite && ticket > shown) {
        shown = ticket;
        show(answer.value);
      }
      return answer;
    } finally {
      if (intent === "write") writesInFlight -= 1;
    }
  };
}

type Context = { readonly api: CheckoutApi; readonly track: Track };
type Run<K extends LiveKind> = (action: Extract<LiveAction, { readonly kind: K }>, context: Context) => Promise<Outcome>;

const DONE: Outcome = { kind: "done" };

/** One row per live action. A new busy label without a row fails the typecheck. */
const RUN: { readonly [K in LiveKind]: Run<K> } = {
  create_checkout: async ({ request, clientRequestId }, { api }) => {
    const created = await api.create(request, clientRequestId);
    return created.ok ? { kind: "open", href: checkoutLinks(created.value.checkout.id).room } : outcomeOf(created.failure);
  },
  join: async ({ checkoutId }, { api, track }) => {
    const joined = await track("write", () => api.join(checkoutId));
    if (joined.ok) return DONE;
    if (joined.failure === "room_full" && (await refresh(api, checkoutId, track)).ok) return DONE;
    return outcomeOf(joined.failure);
  },
};

function outcomeOf(problem: RequestProblem): Outcome {
  return problem === "signed_out" ? { kind: "signed_out" } : { kind: "notice", text: REQUEST_PROBLEMS[problem] };
}

function refresh(api: CheckoutApi, id: CheckoutId, track: Track): Promise<Result<RoomSnapshot, RoomReadProblem>> {
  return track("read", () => api.readRoom(id));
}

export type Live = {
  run(action: LiveAction, track: Track): Promise<Outcome>;
  /** Reads the room through the scope's tracker. F4's poll calls this. */
  refresh(id: CheckoutId, track: Track): Promise<Result<RoomSnapshot, RoomReadProblem>>;
};

export function liveActions(api: CheckoutApi): Live {
  return {
    // RUN[action.kind] is a union of rows, and TypeScript can't pair it with the action's own kind.
    run: (action, track) => (RUN[action.kind] as Run<LiveKind>)(action, { api, track }),
    refresh: (id, track) => refresh(api, id, track),
  };
}

/** Relative paths, so each request carries the session cookie and the page's origin. */
export const live: Live = liveActions(checkoutApi((path, init) => globalThis.fetch(path, init)));
