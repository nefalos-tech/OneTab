import type { Result } from "@/lib/wallet/environment";
import { checkoutApi, type CheckoutApi, type RequestProblem, type RoomReadProblem } from "./api";
import { ACTIONS, REQUEST_PROBLEMS, type ActionKind } from "./catalog";
import { checkoutLinks, type Action, type ActionOf } from "./checkout-view";
import type { CheckoutId, RoomSnapshot } from "./contracts";

export type LiveKind = {
  [K in ActionKind]: (typeof ACTIONS)[K] extends { readonly busy: string } ? K : never;
}[ActionKind];
export type LiveAction = ActionOf<LiveKind>;

export function isLiveAction(action: Action): action is LiveAction {
  return "busy" in ACTIONS[action.kind];
}

export type Outcome =
  | { readonly kind: "done" }
  | { readonly kind: "open"; readonly href: string }
  | { readonly kind: "signed_out" }
  | { readonly kind: "notice"; readonly text: string };

export type Track = <F extends string>(
  intent: "read" | "write",
  request: () => Promise<Result<RoomSnapshot, F>>,
) => Promise<Result<RoomSnapshot, F>>;

export const untracked: Track = (_intent, request) => request();

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
type Run<K extends LiveKind> = (action: ActionOf<K>, context: Context) => Promise<Outcome>;

const DONE: Outcome = { kind: "done" };

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

function run<K extends LiveKind>(action: ActionOf<K>, context: Context): Promise<Outcome> {
  return RUN[action.kind](action, context);
}

function outcomeOf(problem: RequestProblem): Outcome {
  return problem === "signed_out" ? { kind: "signed_out" } : { kind: "notice", text: REQUEST_PROBLEMS[problem] };
}

function refresh(api: CheckoutApi, id: CheckoutId, track: Track): Promise<Result<RoomSnapshot, RoomReadProblem>> {
  return track("read", () => api.readRoom(id));
}

export type Live = {
  run(action: LiveAction, track: Track): Promise<Outcome>;
  refresh(id: CheckoutId, track: Track): Promise<Result<RoomSnapshot, RoomReadProblem>>;
};

export function liveActions(api: CheckoutApi): Live {
  return {
    run: (action, track) => run(action, { api, track }),
    refresh: (id, track) => refresh(api, id, track),
  };
}

export const live: Live = liveActions(checkoutApi((path, init) => globalThis.fetch(path, init)));
