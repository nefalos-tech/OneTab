import type {
  Address,
  AttemptId,
  AttemptSummary,
  BlockHeight,
  CheckoutId,
  ClientRequestId,
  Network,
  PayerCount,
  PublicConfig,
  Receipt,
  RoomSnapshot,
  Session,
  TokenUnits,
} from "./contracts";

export type { AttemptId, ClientRequestId, Session } from "./contracts";
import {
  FLOW_STEPS,
  NETWORK_LABELS,
  SITUATIONS,
  STOP_REASONS,
  WORDS,
  causeOfCode,
  type ActionKind,
  type FundingCause,
  type FlowStepId,
  type OwnedBy,
  type Screen,
  type Situation,
  type SpotStatus,
  type StopReason,
  type Tone,
} from "./catalog";
import { splitEqually, type Money } from "./units";
import type { SampleWalletSeed } from "@/lib/wallet/sample";

export type CheckoutState = {
  readonly snapshot: RoomSnapshot;
  readonly session: Session | null;
  readonly source: CheckoutSource;
  readonly page: PageFacts;
};

export type PageFacts = {
  readonly noted: readonly NotedCause[];
  readonly roomUnreachable: boolean;
};

export type NotedCause = { readonly attemptId: AttemptId; readonly cause: FundingCause };

export const NOTHING_HEARD: PageFacts = Object.freeze({ noted: Object.freeze([]), roomUnreachable: false });

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

export const shortAddress = (address: string): string => `${address.slice(0, 4)}…${address.slice(-4)}`;
export const SAMPLE_CREATE_PATH = "/?sample";

export function checkoutLinks(segment: CheckoutId | `sample-${string}`, query = ""): ScreenLinks {
  return { room: `/checkouts/${segment}${query}`, result: `/checkouts/${segment}/result${query}` };
}

export type ViewerRole =
  | { readonly kind: "organizer"; readonly slot: number }
  | { readonly kind: "payer"; readonly slot: number }
  | { readonly kind: "seller" }
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
  readonly attempt: AttemptId | null;
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

export type ApprovalView = {
  readonly share: Money;
  readonly seller: Address;
  readonly total: Money;
  readonly network: string;
  readonly fee: string;
};

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
  readonly create_checkout: { readonly request: CreateRequest; readonly clientRequestId: ClientRequestId };
  readonly copy_link: Href;
  readonly connect_wallet: NoPayload;
  readonly join: { readonly checkoutId: CheckoutId };
  readonly mark_ready: { readonly checkoutId: CheckoutId };
  readonly mark_not_ready: { readonly checkoutId: CheckoutId };
  readonly start_payment: { readonly checkoutId: CheckoutId };
  readonly approve: { readonly terms: ApprovalTerms };
  readonly decline: { readonly checkoutId: CheckoutId; readonly attemptId: AttemptId };
  readonly retry: { readonly checkoutId: CheckoutId; readonly retryOfAttemptId: Replaceable };
  readonly view_status: Href;
  readonly view_receipt: Href;
  readonly back_to_checkout: Href;
  readonly view_on_explorer: Href;
  readonly open_sample_room: Href;
  readonly create_a_checkout: Href;
  readonly reload_page: NoPayload;
};
export type ActionOf<K extends ActionKind> = { [P in K]: { readonly kind: P } & ActionPayload[P] }[K];
export type Action = ActionOf<ActionKind>;

export type ApprovalTerms = {
  readonly checkoutId: CheckoutId;
  readonly attemptId: AttemptId;
  readonly network: Network;
  readonly mint: Address;
  readonly tokenDecimals: number;
  readonly totalUnits: TokenUnits;
  readonly payerCount: PayerCount;
  readonly seller: Address;
  readonly feePayer: Address;
  readonly contributions: readonly { readonly slot: number; readonly wallet: Address; readonly amountUnits: TokenUnits }[];
  readonly payer: Address;
  readonly lastValidBlockHeight: BlockHeight | null;
};

export type ActionsView = {
  readonly primary: Action | null;
  readonly secondary: readonly Action[];
  readonly sample: { readonly followUp: Action | null } | null;
};

export type Notice = {
  readonly text: string;
  readonly followUp: Action | null;
  readonly wallet: Address | null;
  readonly raisedBy: Action;
  readonly about: AttemptId | null;
};

export function noticeOf(notice: Omit<Notice, "about">, about?: AttemptId): Notice {
  return { ...notice, about: about ?? attemptOf(notice.raisedBy) };
}

export function noticeApplies(notice: Notice, now: { readonly wallet: Address | null; readonly actions: ActionsView }): boolean {
  const { kind } = notice.raisedBy;
  return notice.wallet === now.wallet && offered(now.actions).some((a) => a.kind === kind && attemptOf(a) === notice.about);
}

export function busyShown(running: ActionKind | null, prompting: AttemptId | null, actions: ActionsView): ActionKind | null {
  if (running !== null) return running;
  return offered(actions).some((a) => a.kind === "approve" && a.terms.attemptId === prompting) ? "approve" : null;
}

function attemptOf(action: Action): AttemptId | null {
  switch (action.kind) {
    case "approve":
      return action.terms.attemptId;
    case "decline":
      return action.attemptId;
    case "retry":
      return action.retryOfAttemptId;
    default:
      return null;
  }
}

const offered = (actions: ActionsView): readonly Action[] =>
  [actions.primary, ...actions.secondary].filter((a): a is Action => a !== null);

declare const replaceableBrand: unique symbol;

export type Replaceable = AttemptId & { readonly [replaceableBrand]: true };

function replaceable(attempt: AttemptSummary): Replaceable | null {
  return attempt.canRetry && (attempt.state === "failed" || attempt.state === "expired") ? (attempt.id as Replaceable) : null;
}

export type Recovery =
  | { readonly kind: "on_hold" }
  | { readonly kind: "organizer_can_retry"; readonly retryOfAttemptId: Replaceable }
  | { readonly kind: "waiting_for_organizer" };

export type Reason = {
  readonly key: StopReason;
  readonly happened: string;
  readonly next: string | null;
  readonly from: "room" | "this_page" | "attempt";
};

export type ResultBody =
  | { readonly kind: "not_started" }
  | { readonly kind: "approvals"; readonly stage: "preparing" | "signing" }
  | { readonly kind: "in_progress"; readonly transactionReference: string | null }
  | { readonly kind: "unresolved"; readonly transactionReference: string | null }
  | {
      readonly kind: "needs_attention";
      readonly recovery: Recovery;
      readonly reason: Reason | null;
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
  readonly approval: ApprovalView | null;
  readonly actions: ActionsView;
  readonly connection: string | null;
};

export type ResultView = {
  readonly chrome: Chrome;
  readonly status: StatusView;
  readonly tab: TabView;
  readonly body: ResultBody;
  readonly actions: ActionsView;
  readonly connection: string | null;
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
  const terms = termsOf(state.snapshot, state.session);
  const plan = isOwnedBy(c.situation, "room")
    ? ROOM_ACTIONS[c.situation]({
        checkoutId: state.snapshot.checkout.id,
        role,
        me: me?.status ?? null,
        links: state.source.links,
        terms,
      })
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
    approval: terms && approvalOf(terms),
    actions: { ...plan, sample: sampleActions(state) },
    connection: connectionOf(state.page),
  };
}

const connectionOf = (page: PageFacts): string | null => (page.roomUnreachable ? WORDS.room_unreachable : null);

function approvalOf(terms: ApprovalTerms): ApprovalView | null {
  const mine = terms.contributions.find((c) => c.wallet === terms.payer);
  if (mine === undefined) return null;
  return {
    share: { units: mine.amountUnits, decimals: terms.tokenDecimals },
    seller: terms.seller,
    total: { units: terms.totalUnits, decimals: terms.tokenDecimals },
    network: NETWORK_LABELS[terms.network],
    fee: terms.payer === terms.feePayer ? WORDS.fee_you_pay : WORDS.fee_organizer_pays,
  };
}

export function deriveResultView(state: CheckoutState): ResultView {
  const c = classify(state.snapshot);
  const role = roleOf(state.snapshot, state.session, c.situation);
  const tab = tabOf(state.snapshot, role);
  const body = bodyOf(c, role, tab, state.page, state.source.kind === "sample" ? null : state.snapshot.checkout.network);
  return {
    chrome: chromeOf(state, SITUATIONS[c.situation].step, "result"),
    status: statusOf(c, role, tab),
    tab,
    body,
    actions: {
      ...resultActions(body, {
        checkoutId: state.snapshot.checkout.id,
        signedOut: role.kind === "signed_out",
        links: state.source.links,
      }),
      sample: sampleActions(state),
    },
    connection: connectionOf(state.page),
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
  clientRequestId: ClientRequestId,
): ActionsView {
  return {
    primary: view.organizer === null ? { kind: "connect_wallet" } : { kind: "create_checkout", request, clientRequestId },
    secondary: [{ kind: "edit_details" }],
    sample: view.sampleRoomHref === null ? null : { followUp: { kind: "open_sample_room", href: view.sampleRoomHref } },
  };
}

export function termsOf(snapshot: RoomSnapshot, session: Session | null): ApprovalTerms | null {
  const { checkout, participants, attempt } = snapshot;
  if (attempt === null || (attempt.state !== "preparing" && attempt.state !== "signing")) return null;
  if (session === null || session.wallet === checkout.sellerWallet || participants.length !== checkout.payerCount) return null;
  if (!participants.some((p) => p.wallet === session.wallet) || attempt.signedWallets.includes(session.wallet)) return null;
  return {
    checkoutId: checkout.id,
    attemptId: attempt.id,
    network: checkout.network,
    mint: checkout.mint,
    tokenDecimals: checkout.tokenDecimals,
    totalUnits: checkout.totalUnits,
    payerCount: checkout.payerCount,
    seller: checkout.sellerWallet,
    feePayer: checkout.organizerWallet,
    contributions: [...participants]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({ slot: p.slot, wallet: p.wallet, amountUnits: p.shareUnits })),
    payer: session.wallet,
    lastValidBlockHeight: attempt.lastValidBlockHeight,
  };
}

declare const verified: unique symbol;

type VerifiedReceipt = Receipt & { readonly [verified]: true };

function verifiedReceipt(snapshot: RoomSnapshot): VerifiedReceipt | null {
  const { attempt, checkout } = snapshot;
  if (snapshot.phase !== "paid" || attempt === null || attempt.state !== "confirmed" || attempt.receipt === null) return null;
  const receipt = attempt.receipt;
  const shares = [...snapshot.participants].sort((a, b) => a.slot - b.slot);
  const proves =
    isTransactionReference(receipt.transactionReference) &&
    receipt.transactionReference === attempt.transactionReference &&
    receipt.sellerWallet === checkout.sellerWallet &&
    receipt.totalUnits === checkout.totalUnits &&
    receipt.contributions.length === shares.length &&
    receipt.contributions.every(
      (c, i) => c.slot === shares[i]?.slot && c.wallet === shares[i]?.wallet && c.amountUnits === shares[i]?.shareUnits,
    );
  return proves ? (receipt as VerifiedReceipt) : null;
}

const isTransactionReference = (s: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s);

const EXPLORER: { readonly [N in Network]: (reference: string) => string } = {
  devnet: (reference) => `https://explorer.solana.com/tx/${reference}?cluster=devnet`,
};

type Classified =
  | { readonly situation: "open_spots" | "full_not_ready" | "ready"; readonly attempt: null }
  | { readonly situation: "confirming"; readonly attempt: AttemptSummary | null }
  | {
      readonly situation: Exclude<Situation, "open_spots" | "full_not_ready" | "ready" | "confirming" | "paid">;
      readonly attempt: AttemptSummary;
    }
  | { readonly situation: "paid"; readonly attempt: AttemptSummary; readonly receipt: VerifiedReceipt };

function classify(snapshot: RoomSnapshot): Classified {
  const a = snapshot.attempt;
  if (snapshot.phase === "paid") {
    const receipt = verifiedReceipt(snapshot);
    return receipt !== null && a !== null ? { situation: "paid", attempt: a, receipt } : { situation: "confirming", attempt: a };
  }
  if (a === null) {
    if (snapshot.phase === "ready") return { situation: "ready", attempt: null };
    const full = snapshot.participants.length >= snapshot.checkout.payerCount;
    return { situation: full ? "full_not_ready" : "open_spots", attempt: null };
  }
  switch (a.state) {
    case "confirmed":
      return { situation: "confirming", attempt: a };
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

export function situationOf(snapshot: RoomSnapshot): Situation {
  return classify(snapshot).situation;
}

export function ownerOf(snapshot: RoomSnapshot): Screen {
  return SITUATIONS[situationOf(snapshot)].owner;
}

function isOwnedBy<S extends Screen>(situation: Situation, screen: S): situation is OwnedBy<S> {
  return SITUATIONS[situation].owner === screen;
}

function roleOf(snapshot: RoomSnapshot, session: Session | null, situation: Situation): ViewerRole {
  if (session === null) return { kind: "signed_out" };
  if (session.wallet === snapshot.checkout.sellerWallet) return { kind: "seller" };
  const spot = snapshot.participants.find((p) => p.wallet === session.wallet);
  if (spot) {
    return session.wallet === snapshot.checkout.organizerWallet
      ? { kind: "organizer", slot: spot.slot }
      : { kind: "payer", slot: spot.slot };
  }
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
  return {
    situation: c.situation,
    tone: meta.tone,
    label: meta.label,
    line: STATUS_COPY[c.situation](context),
    attempt: c.attempt?.id ?? null,
  };
}

function recoveryOf(attempt: AttemptSummary, role: ViewerRole): Recovery {
  const id = replaceable(attempt);
  if (id === null) return { kind: "on_hold" };
  return role.kind === "organizer" ? { kind: "organizer_can_retry", retryOfAttemptId: id } : { kind: "waiting_for_organizer" };
}

function bodyOf(c: Classified, role: ViewerRole, tab: TabView, page: PageFacts, network: Network | null): ResultBody {
  switch (c.situation) {
    case "open_spots":
    case "full_not_ready":
    case "ready":
      return { kind: "not_started" };
    case "preparing":
    case "signing":
      return { kind: "approvals", stage: c.situation };
    case "submitting":
    case "confirming":
      return { kind: "in_progress", transactionReference: c.attempt?.transactionReference ?? null };
    case "unresolved":
      return { kind: "unresolved", transactionReference: c.attempt.transactionReference };
    case "declined":
    case "failed":
    case "expired":
      return {
        kind: "needs_attention",
        recovery: recoveryOf(c.attempt, role),
        reason: reasonOf(c.attempt, page.noted),
        transactionReference: c.attempt.transactionReference,
      };
    case "paid":
      return { kind: "paid", receipt: receiptOf(c.receipt, tab, network) };
  }
}

function reasonOf(attempt: AttemptSummary, noted: readonly NotedCause[]): Reason | null {
  if (attempt.state !== "failed") return null;
  if (attempt.transactionReference !== null) return reason("network_rejected", "attempt");
  const fromRoom = attempt.error === null ? null : causeOfCode(attempt.error.code);
  if (fromRoom !== null) return reason(fromRoom, "room");
  const heard = noted.find((n) => n.attemptId === attempt.id);
  return heard === undefined ? reason("not_sent", "attempt") : reason(heard.cause, "this_page");
}

const reason = (key: StopReason, from: Reason["from"]): Reason => ({ key, ...STOP_REASONS[key], from });

function receiptOf(receipt: VerifiedReceipt, tab: TabView, network: Network | null): ReceiptView {
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
    explorerUrl: network === null ? null : EXPLORER[network](receipt.transactionReference),
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

function resultActions(
  body: ResultBody,
  c: { readonly checkoutId: CheckoutId; readonly signedOut: boolean; readonly links: ScreenLinks },
): ActionPlan {
  const back = { kind: "back_to_checkout", href: c.links.room } as const;
  const connect = c.signedOut ? ({ kind: "connect_wallet" } as const) : null;
  switch (body.kind) {
    case "not_started":
    case "approvals":
      return { primary: back, secondary: [] };
    case "in_progress":
    case "unresolved":
      return { primary: connect, secondary: [back] };
    case "needs_attention":
      return {
        primary:
          body.recovery.kind === "organizer_can_retry"
            ? { kind: "retry", checkoutId: c.checkoutId, retryOfAttemptId: body.recovery.retryOfAttemptId }
            : connect,
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
    networkLabel: NETWORK_LABELS[state.snapshot.checkout.network],
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

type ActorContext = {
  readonly checkoutId: CheckoutId;
  readonly role: ViewerRole;
  readonly me: SpotStatus | null;
  readonly links: ScreenLinks;
  readonly terms: ApprovalTerms | null;
};
type ActionPlan = { readonly primary: Action | null; readonly secondary: readonly Action[] };

const NONE: ActionPlan = { primary: null, secondary: [] };
const CONNECT: ActionPlan = { primary: { kind: "connect_wallet" }, secondary: [] };
const isMember = (role: ViewerRole): boolean => role.kind === "organizer" || role.kind === "payer";
const readinessToggle = (c: ActorContext): Action =>
  c.me === "ready" ? { kind: "mark_not_ready", checkoutId: c.checkoutId } : { kind: "mark_ready", checkoutId: c.checkoutId };

const ROOM_ACTIONS: { readonly [S in OwnedBy<"room">]: (c: ActorContext) => ActionPlan } = {
  open_spots: (c) =>
    c.role.kind === "signed_out"
      ? CONNECT
      : isMember(c.role)
        ? { primary: { kind: "copy_link", href: c.links.room }, secondary: [readinessToggle(c)] }
        : c.role.kind === "guest"
          ? { primary: { kind: "join", checkoutId: c.checkoutId }, secondary: [] }
          : NONE,
  full_not_ready: (c) =>
    c.role.kind === "signed_out"
      ? CONNECT
      : !isMember(c.role)
        ? NONE
        : c.me === "ready"
          ? { primary: null, secondary: [readinessToggle(c)] }
          : { primary: readinessToggle(c), secondary: [] },
  ready: (c) =>
    c.role.kind === "signed_out"
      ? CONNECT
      : !isMember(c.role)
        ? NONE
        : {
            primary: c.role.kind === "organizer" ? { kind: "start_payment", checkoutId: c.checkoutId } : null,
            secondary: [{ kind: "mark_not_ready", checkoutId: c.checkoutId }],
          },
  preparing: (c) => (c.role.kind === "signed_out" ? CONNECT : NONE),
  signing: (c) =>
    c.role.kind === "signed_out"
      ? CONNECT
      : isMember(c.role) && c.terms
        ? { primary: { kind: "approve", terms: c.terms }, secondary: [] }
        : NONE,
};

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
const FULL = "This checkout is full.";

const STOPPED: { readonly [S in "failed" | "expired"]: { readonly [R in Recovery["kind"]]: string } } = {
  failed: { organizer_can_retry: WORDS.failed_retry, waiting_for_organizer: WORDS.failed_waiting, on_hold: WORDS.failed_on_hold },
  expired: { organizer_can_retry: WORDS.expired_retry, waiting_for_organizer: WORDS.expired_waiting, on_hold: WORDS.expired_on_hold },
};

const signInIfOut = (c: CopyContext): string => (c.role.kind === "signed_out" ? ` ${WORDS.sign_in}` : "");

const STATUS_COPY: { readonly [S in Situation]: (c: CopyContext) => string } = {
  open_spots: (c) =>
    c.role.kind === "guest"
      ? "There's an open spot. Join to pay your share."
      : c.role.kind === "signed_out"
        ? "Sign in with your wallet to take an open spot."
        : c.role.kind === "seller"
          ? WORDS.seller_no_spot
          : c.role.kind === "organizer"
            ? `${c.me === "ready" ? `${WORDS.you_are_ready} ` : ""}Waiting for ${count(c.openSpots, "more payer")}, so copy the link and send it to them.`
            : c.role.kind === "payer"
              ? `${c.me === "ready" ? WORDS.you_are_ready : "You joined."} Waiting for ${count(c.openSpots, "more payer")}.`
              : `Waiting for ${count(c.openSpots, "more payer")} to join.`,
  full_not_ready: (c) =>
    isMember(c.role) && c.me !== "ready"
      ? "Everyone has joined. Check your share, then tell the group you're ready, which moves no money."
      : isMember(c.role)
        ? `${WORDS.you_are_ready} Waiting for ${count(c.notReady, "more payer")} to get ready.`
        : c.role.kind === "signed_out"
          ? `Waiting for ${count(c.notReady, "payer")} to get ready. ${WORDS.sign_in}`
          : `${FULL} Waiting for ${count(c.notReady, "payer")} to get ready.`,
  ready: (c) =>
    c.role.kind === "organizer"
      ? "Everyone is ready. Start the payment to ask each payer to approve it."
      : isMember(c.role)
        ? "Everyone is ready. Waiting for the organizer to start the payment."
        : c.role.kind === "signed_out"
          ? `Everyone is ready. ${WORDS.sign_in}`
          : `${FULL} Everyone is ready to pay.`,
  preparing: (c) => `${WORDS.preparing}${signInIfOut(c)}`,
  signing: (c) =>
    isMember(c.role) && c.me !== "approved"
      ? "Check the payment, then approve it in your wallet. Nothing is sent until everyone approves."
      : isMember(c.role)
        ? `You approved. Waiting for ${count(c.approvals.total - c.approvals.done, "more approval")}.`
        : `${c.approvals.done} of ${c.approvals.total} payers approved.${signInIfOut(c)}`,
  submitting: (c) => `${WORDS.sending}${signInIfOut(c)}`,
  confirming: (c) => `${WORDS.finalizing}${signInIfOut(c)}`,
  unresolved: (c) => `${isMember(c.role) ? WORDS.unresolved_here : WORDS.unresolved_payers}${signInIfOut(c)}`,
  declined: (c) => `${WORDS.payer_declined}${signInIfOut(c)}`,
  failed: (c) => `${STOPPED.failed[c.recovery?.kind ?? "on_hold"]}${signInIfOut(c)}`,
  expired: (c) => `${STOPPED.expired[c.recovery?.kind ?? "on_hold"]}${signInIfOut(c)}`,
  paid: () => "The seller received every share in one transaction.",
};
