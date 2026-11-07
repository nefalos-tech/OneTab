import type { Network } from "./contracts";

export type Screen = "room" | "result";
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const FLOW_STEPS = [
  { id: "create", label: "Create" },
  { id: "get_ready", label: "Get ready" },
  { id: "approve", label: "Approve" },
  { id: "paid", label: "Paid" },
] as const;
export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

type SituationMeta = {
  readonly owner: Screen;
  readonly step: FlowStepId | "complete";
  readonly tone: Tone;
  readonly label: string;
  readonly when: string;
};

export const SITUATIONS = {
  open_spots: {
    owner: "room",
    step: "get_ready",
    tone: "neutral",
    label: "Waiting for payers",
    when: "phase open, no attempt, fewer payers than spots",
  },
  full_not_ready: {
    owner: "room",
    step: "get_ready",
    tone: "neutral",
    label: "Getting ready",
    when: "phase open, no attempt, every spot taken",
  },
  ready: {
    owner: "room",
    step: "get_ready",
    tone: "info",
    label: "Everyone is ready",
    when: "phase ready, no attempt",
  },
  preparing: {
    owner: "room",
    step: "approve",
    tone: "info",
    label: "Preparing payment",
    when: "attempt preparing",
  },
  signing: {
    owner: "room",
    step: "approve",
    tone: "info",
    label: "Collecting approvals",
    when: "attempt signing",
  },
  submitting: {
    owner: "result",
    step: "paid",
    tone: "info",
    label: "Sending payment",
    when: "attempt submitting",
  },
  confirming: {
    owner: "result",
    step: "paid",
    tone: "info",
    label: "Finalizing",
    when: "attempt confirmed, but no receipt or phase not paid",
  },
  unresolved: {
    owner: "result",
    step: "paid",
    tone: "warning",
    label: "Checking the network",
    when: "attempt unresolved",
  },
  declined: {
    owner: "result",
    step: "approve",
    tone: "warning",
    label: "Approval declined",
    when: "attempt declined",
  },
  failed: {
    owner: "result",
    step: "approve",
    tone: "danger",
    label: "Payment failed",
    when: "attempt failed",
  },
  expired: {
    owner: "result",
    step: "approve",
    tone: "warning",
    label: "Approval window ended",
    when: "attempt expired",
  },
  paid: {
    owner: "result",
    step: "complete",
    tone: "success",
    label: "Paid",
    when: "phase paid and attempt confirmed with a receipt",
  },
} as const satisfies Record<string, SituationMeta>;
export type Situation = keyof typeof SITUATIONS;

export type OwnedBy<S extends Screen> = {
  [K in Situation]: (typeof SITUATIONS)[K]["owner"] extends S ? K : never;
}[Situation];

export const SPOT_STATUSES = {
  open: { label: "Open spot", meaning: "No payer has taken this spot yet." },
  joined: { label: "Joined", meaning: "A payer took this spot and is checking their share." },
  ready: { label: "Ready", meaning: "The payer is ready to approve. Ready never moves money." },
  approved: {
    label: "Approved",
    meaning: "The payer approved this payment in their wallet. Nothing moves until everyone approves.",
  },
} as const satisfies Record<string, { readonly label: string; readonly meaning: string }>;
export type SpotStatus = keyof typeof SPOT_STATUSES;

type ActionMeta = {
  readonly label: string;
  readonly needs: "nothing" | "backend" | "wallet" | "chain";
  readonly element: "button" | "link" | "external_link";
};

export const ACTIONS = {
  review_checkout: { label: "Review checkout", needs: "nothing", element: "button" },
  edit_details: { label: "Edit details", needs: "nothing", element: "button" },
  create_checkout: { label: "Create checkout", needs: "backend", element: "button" },
  copy_link: { label: "Copy link", needs: "nothing", element: "button" },
  connect_wallet: { label: "Connect wallet", needs: "wallet", element: "button" },
  join: { label: "Join checkout", needs: "backend", element: "button" },
  mark_ready: { label: "I'm ready", needs: "backend", element: "button" },
  mark_not_ready: { label: "Not ready yet", needs: "backend", element: "button" },
  start_payment: { label: "Start payment", needs: "backend", element: "button" },
  approve: { label: "Approve in wallet", needs: "wallet", element: "button" },
  retry: { label: "Try again", needs: "backend", element: "button" },
  view_status: { label: "View payment status", needs: "nothing", element: "link" },
  view_receipt: { label: "View receipt", needs: "nothing", element: "link" },
  back_to_checkout: { label: "Back to checkout", needs: "nothing", element: "link" },
  view_on_explorer: { label: "View on Solana Explorer", needs: "chain", element: "external_link" },
  open_sample_room: { label: "Open the sample checkout", needs: "nothing", element: "link" },
  create_a_checkout: { label: "Create a checkout", needs: "nothing", element: "link" },
  reload_page: { label: "Try again", needs: "nothing", element: "button" },
} as const satisfies Record<string, ActionMeta>;
export type ActionKind = keyof typeof ACTIONS;

export const NETWORK_LABELS = { devnet: "Test USDC on Solana Devnet" } as const satisfies Record<Network, string>;

export const WORDS = {
  product: "OneTab",
  asset: "test USDC",
  sample: "Sample data",
  sample_notice: "Nothing here is a real checkout or payment.",
  sample_caption: "In sample data, buttons that need a wallet or the network send nothing.",
  not_connected_in_sample: "isn't connected in sample data.",
  not_connected_yet: "isn't connected yet.",
  nothing_sent: "Nothing was sent.",
  nothing_created: "Nothing was created.",
  view_as: "View as",
  all_samples: "All samples",
  you: "You",
  organizer: "Organizer",
  your_share: "Your share",
  payers: "Payers",
  seller: "Seller",
  spot: "Spot",
  total: "Total",
  wallet_not_connected: "No wallet connected",
  viewing_as: "Viewing as",
  link_copied: "Link copied.",
  copy: "Copy",
  copied: "Copied.",
  copy_failed: "Couldn't copy. Select the text and copy it instead.",
  opens_new_tab: "(opens in a new tab)",
  receipt: "Receipt",
  transaction_reference: "Transaction reference",
  finalized_at: "Final on",
  try_sample: "Try it with sample data",
  home: "Go to the start",
  steps: "Checkout steps",
} as const;
