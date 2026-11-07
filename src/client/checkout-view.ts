import type {
  Address,
  AttemptSummary,
  CheckoutId,
  PayerCount,
  PublicConfig,
  Receipt,
  RoomSnapshot,
  Session,
  TokenUnits,
} from "./contracts";
import {
  FLOW_STEPS,
  NETWORK_LABELS,
  SITUATIONS,
  type ActionKind,
  type FlowStepId,
  type OwnedBy,
  type Screen,
  type Situation,
  type SpotStatus,
  type Tone,
} from "./catalog";
import { splitEqually, type Money } from "./units";
import type { SampleWalletSeed } from "@/lib/wallet/sample";

export type CheckoutState = {
  readonly config: PublicConfig;
  readonly snapshot: RoomSnapshot;
  /** The viewer's identity. Loaders supply the sample persona's; Viewer replaces it with the wallet's. */
  readonly session: Session | null;
  readonly source: CheckoutSource;
};

export type CheckoutSource =
  | {
      readonly kind: "sample";
      readonly fixtureLabel: string;
      readonly links: ScreenLinks;
      readonly personas: readonly PersonaOption[];
      readonly wallet: SampleWalletSeed;
    }
  | { readonly kind: "live"; readonly links: ScreenLinks };

export type ScreenLinks = { readonly [S in Screen]: string };
export type PersonaOption = { readonly label: string; readonly links: ScreenLinks; readonly current: boolean };

export type CreateState = {
  readonly config: PublicConfig | null;
  readonly session: Session | null;
  readonly source:
    | { readonly kind: "sample"; readonly sampleRoomHref: string; readonly wallet: SampleWalletSeed }
    | { readonly kind: "live"; readonly samplesOn: boolean };
};

export const SAMPLES_PATH = "/samples";

export const spotNumber = (slot: number): number => slot + 1;
export const SAMPLE_CREATE_PATH = "/?sample";

export function checkoutLinks(segment: CheckoutId | `sample-${string}`, query = ""): ScreenLinks {
  return { room: `/checkouts/${segment}${query}`, result: `/checkouts/${segment}/result${query}` };
}

export type ViewerRole =
  | { readonly kind: "organizer"; readonly slot: number }
  | { readonly kind: "payer"; readonly slot: number }
  | { readonly kind: "guest" }
  | { readonly kind: "spectator" }
  | { readonly kind: "signed_out" };

export type Chrome = {
  readonly networkLabel: string;
  readonly flow: readonly FlowStepView[];
  readonly sample: SampleBanner | null;
};
export type FlowStepView = {
  readonly id: FlowStepId;
  readonly label: string;
  readonly state: "done" | "current" | "upcoming";
};
export type SampleBanner = {
  readonly fixtureLabel: string | null;
  readonly personas: readonly { readonly label: string; readonly href: string; readonly current: boolean }[];
  readonly indexHref: string;
};

export type StatusView = {
  readonly situation: Situation;
  readonly tone: Tone;
  readonly label: string;
  readonly line: string;
};

export type SpotView = {
  readonly slot: number;
  readonly wallet: Address | null;
  readonly share: Money;
  readonly status: SpotStatus;
  readonly isViewer: boolean;
  readonly isOrganizer: boolean;
};
export type TabView = {
  readonly title: string;
  readonly total: Money;
  readonly seller: Address | null;
  readonly spots: readonly SpotView[];
  readonly progress: string;
};
export type YouView = { readonly share: Money; readonly status: SpotStatus; readonly isOrganizer: boolean };

/** The POST /api/checkouts body without clientRequestId, which F3 adds. */
export type CreateRequest = {
  readonly title: string;
  readonly sellerWallet: Address;
  readonly totalUnits: TokenUnits;
  readonly payerCount: PayerCount;
};

type NoPayload = Record<never, never>;
type Href = { readonly href: string };
type ActionPayload = {
  readonly review_checkout: NoPayload;
  readonly edit_details: NoPayload;
  readonly create_checkout: { readonly request: CreateRequest };
  readonly copy_link: Href;
  readonly connect_wallet: NoPayload;
  readonly join: NoPayload;
  readonly mark_ready: NoPayload;
  readonly mark_not_ready: NoPayload;
  readonly start_payment: NoPayload;
  readonly approve: NoPayload;
  readonly retry: { readonly retryOfAttemptId: string };
  readonly view_status: Href;
  readonly view_receipt: Href;
  readonly back_to_checkout: Href;
  readonly view_on_explorer: Href;
  readonly open_sample_room: Href;
  readonly create_a_checkout: Href;
  readonly reload_page: NoPayload;
};
export type Action = { [K in ActionKind]: { readonly kind: K } & ActionPayload[K] }[ActionKind];

export type ActionsView = {
  readonly primary: Action | null;
  readonly secondary: readonly Action[];
  readonly sample: { readonly followUp: Action | null } | null;
};

export type Recovery =
  | { readonly kind: "on_hold" }
  | { readonly kind: "organizer_can_retry"; readonly retryOfAttemptId: string }
  | { readonly kind: "waiting_for_organizer" };

export type ResultBody =
  | { readonly kind: "not_started" }
  | { readonly kind: "in_progress"; readonly transactionReference: string | null }
  | { readonly kind: "unresolved"; readonly transactionReference: string | null }
  | {
      readonly kind: "needs_attention";
      readonly recovery: Recovery;
      readonly detail: string | null;
      readonly transactionReference: string | null;
    }
  | { readonly kind: "paid"; readonly receipt: ReceiptView };

export type ReceiptView = {
  readonly transactionReference: string;
  readonly seller: Address;
  readonly total: Money;
  readonly contributions: readonly {
    readonly slot: number;
    readonly wallet: Address;
    readonly amount: Money;
    readonly isViewer: boolean;
  }[];
  readonly observedAt: string;
  readonly explorerUrl: string | null;
};

export type RoomView = {
  readonly chrome: Chrome;
  readonly status: StatusView;
  readonly tab: TabView;
  readonly you: YouView | null;
  readonly actions: ActionsView;
};

export type ResultView = {
  readonly chrome: Chrome;
  readonly status: StatusView;
  readonly tab: TabView;
  readonly body: ResultBody;
  readonly actions: ActionsView;
};

export type CreateView =
  | {
      readonly kind: "form";
      readonly chrome: Chrome;
      readonly config: PublicConfig;
      readonly organizer: Address | null;
      readonly sampleRoomHref: string | null;
    }
  | {
      readonly kind: "unavailable";
      readonly chrome: Chrome;
      readonly samples: { readonly indexHref: string; readonly createHref: string } | null;
    };

export function deriveRoomView(state: CheckoutState): RoomView {
  const c = classify(state.snapshot);
  const role = roleOf(state.snapshot, state.session, c.situation);
  const tab = tabOf(state.snapshot, role);
  const me = tab.spots.find((s) => s.isViewer) ?? null;
  const plan = isOwnedBy(c.situation, "room")
    ? ROOM_ACTIONS[c.situation]({ role, me: me?.status ?? null, links: state.source.links })
    : {
        primary:
          c.situation === "paid"
            ? ({ kind: "view_receipt", href: state.source.links.result } as const)
            : ({ kind: "view_status", href: state.source.links.result } as const),
        secondary: [],
      };
  return {
    chrome: chromeOf(state, SITUATIONS[c.situation].step, "room"),
    status: statusOf(c, role, tab),
    tab,
    you: me && { share: me.share, status: me.status, isOrganizer: me.isOrganizer },
    actions: { ...plan, sample: sampleActions(state) },
  };
}

export function deriveResultView(state: CheckoutState): ResultView {
  const c = classify(state.snapshot);
  const role = roleOf(state.snapshot, state.session, c.situation);
  const tab = tabOf(state.snapshot, role);
  const body = bodyOf(c, role, tab, state.source.kind === "sample");
  return {
    chrome: chromeOf(state, SITUATIONS[c.situation].step, "result"),
    status: statusOf(c, role, tab),
    tab,
    body,
    actions: { ...resultActions(body, state.source.links), sample: sampleActions(state) },
  };
}

export function deriveCreateView(state: CreateState): CreateView {
  const chrome: Chrome = {
    networkLabel: NETWORK_LABELS[state.config?.network ?? "devnet"],
    flow: flowOf("create"),
    sample: state.source.kind === "sample" ? { fixtureLabel: null, personas: [], indexHref: SAMPLES_PATH } : null,
  };
  if (state.config === null) {
    const samplesOn = state.source.kind === "live" && state.source.samplesOn;
    return {
      kind: "unavailable",
      chrome,
      samples: samplesOn ? { indexHref: SAMPLES_PATH, createHref: SAMPLE_CREATE_PATH } : null,
    };
  }
  return {
    kind: "form",
    chrome,
    config: state.config,
    organizer: state.session?.wallet ?? null,
    sampleRoomHref: state.source.kind === "sample" ? state.source.sampleRoomHref : null,
  };
}

export function deriveReviewActions(
  view: Extract<CreateView, { readonly kind: "form" }>,
  request: CreateRequest,
): ActionsView {
  return {
    primary: { kind: "create_checkout", request },
    secondary: [{ kind: "edit_details" }],
    sample: view.sampleRoomHref === null ? null : { followUp: { kind: "open_sample_room", href: view.sampleRoomHref } },
  };
}

type PaidAttempt = AttemptSummary & { readonly state: "confirmed"; readonly receipt: Receipt };

type Classified =
  | { readonly situation: "open_spots" | "full_not_ready" | "ready"; readonly attempt: null }
  | {
      readonly situation: Exclude<Situation, "open_spots" | "full_not_ready" | "ready" | "paid">;
      readonly attempt: AttemptSummary;
    }
  | { readonly situation: "paid"; readonly attempt: PaidAttempt };

function classify(snapshot: RoomSnapshot): Classified {
  const a = snapshot.attempt;
  if (a === null) {
    if (snapshot.phase === "ready") return { situation: "ready", attempt: null };
    const full = snapshot.participants.length >= snapshot.checkout.payerCount;
    return { situation: full ? "full_not_ready" : "open_spots", attempt: null };
  }
  switch (a.state) {
    case "confirmed":
      return snapshot.phase === "paid" && a.receipt !== null
        ? { situation: "paid", attempt: { ...a, state: "confirmed", receipt: a.receipt } }
        : { situation: "confirming", attempt: a };
    case "preparing":
    case "signing":
    case "submitting":
    case "unresolved":
    case "declined":
    case "failed":
    case "expired":
      return { situation: a.state, attempt: a };
    default: {
      const unknown: never = a.state;
      throw new Error(`Unknown attempt state ${String(unknown)}`);
    }
  }
}

function isOwnedBy<S extends Screen>(situation: Situation, screen: S): situation is OwnedBy<S> {
  return SITUATIONS[situation].owner === screen;
}

function roleOf(snapshot: RoomSnapshot, session: Session | null, situation: Situation): ViewerRole {
  if (session === null) return { kind: "signed_out" };
  const spot = snapshot.participants.find((p) => p.wallet === session.wallet);
  if (spot) {
    return session.wallet === snapshot.checkout.organizerWallet
      ? { kind: "organizer", slot: spot.slot }
      : { kind: "payer", slot: spot.slot };
  }
  if (session.wallet === snapshot.checkout.sellerWallet) return { kind: "spectator" };
  return situation === "open_spots" ? { kind: "guest" } : { kind: "spectator" };
}

function tabOf(snapshot: RoomSnapshot, role: ViewerRole): TabView {
  const { checkout } = snapshot;
  const money = (units: TokenUnits): Money => ({ units, decimals: checkout.tokenDecimals });
  const signed = new Set(snapshot.attempt?.signedWallets ?? []);
  const equal = splitEqually(checkout.totalUnits, checkout.payerCount);
  const viewerSlot = role.kind === "organizer" || role.kind === "payer" ? role.slot : null;
  const spots = equal.map((equalShare, slot): SpotView => {
    const p = snapshot.participants.find((x) => x.slot === slot);
    if (!p) {
      return { slot, wallet: null, share: money(equalShare), status: "open", isViewer: false, isOrganizer: false };
    }
    return {
      slot,
      wallet: p.wallet,
      share: money(p.shareUnits),
      status: signed.has(p.wallet) ? "approved" : p.ready ? "ready" : "joined",
      isViewer: slot === viewerSlot,
      isOrganizer: p.wallet === checkout.organizerWallet,
    };
  });
  const n = checkout.payerCount;
  const joined = spots.filter((s) => s.status !== "open").length;
  const ready = spots.filter((s) => s.status === "ready" || s.status === "approved").length;
  const progress =
    snapshot.attempt === null
      ? `${joined} of ${n} joined, ${ready} ready`
      : `${spots.filter((s) => s.status === "approved").length} of ${n} approved`;
  return { title: checkout.title, total: money(checkout.totalUnits), seller: checkout.sellerWallet, spots, progress };
}

type CopyContext = {
  readonly role: ViewerRole;
  readonly me: SpotStatus | null;
  readonly openSpots: number;
  readonly notReady: number;
  readonly approvals: { readonly done: number; readonly total: number };
  readonly recovery: Recovery | null;
};

function statusOf(c: Classified, role: ViewerRole, tab: TabView): StatusView {
  const meta = SITUATIONS[c.situation];
  const context: CopyContext = {
    role,
    me: tab.spots.find((s) => s.isViewer)?.status ?? null,
    openSpots: tab.spots.filter((s) => s.status === "open").length,
    notReady: tab.spots.filter((s) => s.status === "joined").length,
    approvals: { done: tab.spots.filter((s) => s.status === "approved").length, total: tab.spots.length },
    recovery:
      c.situation === "declined" || c.situation === "failed" || c.situation === "expired"
        ? recoveryOf(c.attempt, role)
        : null,
  };
  return { situation: c.situation, tone: meta.tone, label: meta.label, line: STATUS_COPY[c.situation](context) };
}

function recoveryOf(attempt: AttemptSummary, role: ViewerRole): Recovery {
  if (!attempt.canRetry) return { kind: "on_hold" };
  return role.kind === "organizer"
    ? { kind: "organizer_can_retry", retryOfAttemptId: attempt.id }
    : { kind: "waiting_for_organizer" };
}

function bodyOf(c: Classified, role: ViewerRole, tab: TabView, sample: boolean): ResultBody {
  switch (c.situation) {
    case "open_spots":
    case "full_not_ready":
    case "ready":
    case "preparing":
    case "signing":
      return { kind: "not_started" };
    case "submitting":
    case "confirming":
      return { kind: "in_progress", transactionReference: c.attempt.transactionReference };
    case "unresolved":
      return { kind: "unresolved", transactionReference: c.attempt.transactionReference };
    case "declined":
    case "failed":
    case "expired":
      return {
        kind: "needs_attention",
        recovery: recoveryOf(c.attempt, role),
        detail: c.attempt.error?.message ?? null,
        transactionReference: c.attempt.transactionReference,
      };
    case "paid":
      return { kind: "paid", receipt: receiptOf(c.attempt.receipt, tab, sample) };
  }
}

function receiptOf(receipt: Receipt, tab: TabView, sample: boolean): ReceiptView {
  const decimals = tab.total.decimals;
  return {
    transactionReference: receipt.transactionReference,
    seller: receipt.sellerWallet,
    total: { units: receipt.totalUnits, decimals },
    contributions: receipt.contributions.map((c) => ({
      slot: c.slot,
      wallet: c.wallet,
      amount: { units: c.amountUnits, decimals },
      isViewer: tab.spots.some((s) => s.slot === c.slot && s.isViewer),
    })),
    observedAt: formatUtc(receipt.observedAt),
    explorerUrl: sample ? null : receipt.explorerUrl,
  };
}

const UTC_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

function formatUtc(iso: string): string {
  return `${UTC_FORMAT.format(new Date(iso))} UTC`;
}

function resultActions(body: ResultBody, links: ScreenLinks): ActionPlan {
  const back = { kind: "back_to_checkout", href: links.room } as const;
  switch (body.kind) {
    case "not_started":
      return { primary: back, secondary: [] };
    case "in_progress":
    case "unresolved":
      return { primary: null, secondary: [back] };
    case "needs_attention":
      return {
        primary:
          body.recovery.kind === "organizer_can_retry"
            ? { kind: "retry", retryOfAttemptId: body.recovery.retryOfAttemptId }
            : null,
        secondary: [back],
      };
    case "paid":
      return {
        primary: body.receipt.explorerUrl === null ? null : { kind: "view_on_explorer", href: body.receipt.explorerUrl },
        secondary: [back],
      };
  }
}

function flowOf(step: FlowStepId | "complete"): readonly FlowStepView[] {
  const current = FLOW_STEPS.findIndex((s) => s.id === step);
  return FLOW_STEPS.map((s, i) => ({
    id: s.id,
    label: s.label,
    state: step === "complete" || i < current ? "done" : i === current ? "current" : "upcoming",
  }));
}

function chromeOf(state: CheckoutState, step: FlowStepId | "complete", screen: Screen): Chrome {
  const { source } = state;
  return {
    networkLabel: NETWORK_LABELS[state.config.network],
    flow: flowOf(step),
    sample:
      source.kind === "sample"
        ? {
            fixtureLabel: source.fixtureLabel,
            personas: source.personas.map((p) => ({ label: p.label, href: p.links[screen], current: p.current })),
            indexHref: SAMPLES_PATH,
          }
        : null,
  };
}

function sampleActions(state: CheckoutState): ActionsView["sample"] {
  return state.source.kind === "sample" ? { followUp: null } : null;
}

type ActorContext = { readonly role: ViewerRole; readonly me: SpotStatus | null; readonly links: ScreenLinks };
type ActionPlan = { readonly primary: Action | null; readonly secondary: readonly Action[] };

const NONE: ActionPlan = { primary: null, secondary: [] };
const CONNECT: ActionPlan = { primary: { kind: "connect_wallet" }, secondary: [] };
const isMember = (role: ViewerRole): boolean => role.kind === "organizer" || role.kind === "payer";
const readinessToggle = (me: SpotStatus | null): Action =>
  me === "ready" ? { kind: "mark_not_ready" } : { kind: "mark_ready" };

const ROOM_ACTIONS: { readonly [S in OwnedBy<"room">]: (c: ActorContext) => ActionPlan } = {
  open_spots: (c) =>
    c.role.kind === "signed_out"
      ? CONNECT
      : isMember(c.role)
        ? { primary: { kind: "copy_link", href: c.links.room }, secondary: [readinessToggle(c.me)] }
        : c.role.kind === "guest"
          ? { primary: { kind: "join" }, secondary: [] }
          : NONE,
  full_not_ready: (c) =>
    c.role.kind === "signed_out"
      ? CONNECT
      : !isMember(c.role)
        ? NONE
        : c.me === "ready"
          ? { primary: null, secondary: [{ kind: "mark_not_ready" }] }
          : { primary: { kind: "mark_ready" }, secondary: [] },
  ready: (c) =>
    c.role.kind === "signed_out"
      ? CONNECT
      : !isMember(c.role)
        ? NONE
        : {
            primary: c.role.kind === "organizer" ? { kind: "start_payment" } : null,
            secondary: [{ kind: "mark_not_ready" }],
          },
  preparing: (c) => (c.role.kind === "signed_out" ? CONNECT : NONE),
  signing: (c) =>
    c.role.kind === "signed_out"
      ? CONNECT
      : isMember(c.role) && c.me !== "approved"
        ? { primary: { kind: "approve" }, secondary: [] }
        : NONE,
};

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
const FULL = "This checkout is full.";
const SIGNED_OUT = "Connect your wallet if you hold a spot.";

const recoveryLine = (r: Recovery | null, onHold: string): string =>
  r?.kind === "organizer_can_retry"
    ? "Try again to ask everyone to approve a new payment."
    : r?.kind === "waiting_for_organizer"
      ? "The organizer can start a new payment, and everyone approves again."
      : onHold;

const STATUS_COPY: { readonly [S in Situation]: (c: CopyContext) => string } = {
  open_spots: (c) =>
    c.role.kind === "guest"
      ? "There's an open spot. Join to pay your share."
      : c.role.kind === "signed_out"
        ? "Connect your wallet to take an open spot."
        : c.role.kind === "organizer"
          ? `Waiting for ${count(c.openSpots, "more payer")}. Copy the link and send it to them.`
          : c.role.kind === "payer"
            ? `You joined. Waiting for ${count(c.openSpots, "more payer")}.`
            : `Waiting for ${count(c.openSpots, "more payer")} to join.`,
  full_not_ready: (c) =>
    isMember(c.role) && c.me !== "ready"
      ? "Everyone has joined. Check your share, then tell the group you're ready."
      : isMember(c.role)
        ? `You're ready. Waiting for ${count(c.notReady, "more payer")} to get ready.`
        : c.role.kind === "signed_out"
          ? `Waiting for ${count(c.notReady, "payer")} to get ready. ${SIGNED_OUT}`
          : `${FULL} Waiting for ${count(c.notReady, "payer")} to get ready.`,
  ready: (c) =>
    c.role.kind === "organizer"
      ? "Everyone is ready. Start the payment to ask each payer to approve their share."
      : isMember(c.role)
        ? "Everyone is ready. Waiting for the organizer to start the payment."
        : c.role.kind === "signed_out"
          ? `Everyone is ready. ${SIGNED_OUT}`
          : `${FULL} Everyone is ready to pay.`,
  preparing: (c) =>
    `Preparing the payment, and approvals open in a moment.${c.role.kind === "signed_out" ? ` ${SIGNED_OUT}` : ""}`,
  signing: (c) =>
    isMember(c.role) && c.me !== "approved"
      ? "Approve your share in your wallet. Nothing is sent until everyone approves."
      : isMember(c.role)
        ? `You approved. Waiting for ${count(c.approvals.total - c.approvals.done, "more approval")}.`
        : `${c.approvals.done} of ${c.approvals.total} payers approved.${c.role.kind === "signed_out" ? ` ${SIGNED_OUT}` : ""}`,
  submitting: () =>
    "Sending one payment with every share to the seller. We'll confirm it once the network finalizes it.",
  confirming: () => "The network accepted the payment. The receipt appears once it's final.",
  unresolved: () =>
    "We can't confirm the result yet. We keep checking the same transaction, and no new payment will start.",
  declined: (c) =>
    `A payer declined. ${recoveryLine(c.recovery, "Approvals already given aren't withdrawn, so this payment stays on hold until it's safely closed.")}`,
  failed: (c) =>
    `No share reached the seller${c.role.kind === "organizer" ? ", but you may still pay a small network fee" : ""}. ${recoveryLine(c.recovery, "A new payment can start once this one is safely closed.")}`,
  expired: (c) =>
    `The approval window ended and nothing reached the seller. ${recoveryLine(c.recovery, "A new payment can start once this one is safely closed.")}`,
  paid: () => "The seller received every share in one transaction.",
};
