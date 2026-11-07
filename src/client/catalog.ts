import type { Problem } from "@/lib/wallet/machine";
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
  cancel: "Cancel",
  copy_address: "Copy address",
  disconnect: "Disconnect",
  wallet: "Wallet",
  signed_in_as: "Signed in as",
  sample_wallet: "Sample wallet",
  sample_wallet_note: "Stands in for a real wallet in sample data. It never signs a payment.",
  sample_account: "Account",
  switch_account: "Switch account",
  connect_request: "OneTab wants to see your wallet address.",
  sign_request: "OneTab asks you to sign this message:",
  connect_request_announcement: "Sample wallet: OneTab asks you to approve the connection.",
  sign_request_announcement: "Sample wallet: OneTab asks you to sign the sign-in message.",
  approve: "Approve",
  reject: "Reject",
  end_sign_in: "End sign-in",
} as const;

type WalletFixMeta =
  | { readonly label: string; readonly element: "button" }
  | { readonly label: string; readonly element: "external_link"; readonly href: string };

export const WALLET_FIXES = {
  connect_wallet: { label: ACTIONS.connect_wallet.label, element: "button" },
  sign_in_again: { label: "Sign in again", element: "button" },
  try_again: { label: "Try again", element: "button" },
  get_phantom: { label: "Get Phantom", element: "external_link", href: "https://phantom.com/download" },
} as const satisfies Record<string, WalletFixMeta>;
export type WalletFixKind = keyof typeof WALLET_FIXES;

export const WALLET_WAITING = {
  connect_prompt: { state: "Connecting", control: "Connecting…", line: "Approve the connection in your wallet." },
  sign_prompt: {
    state: "Signing in",
    control: "Signing in…",
    line: "Sign the sign-in message in your wallet. Signing in proves the wallet is yours. It can't move money.",
  },
  server: { state: "Checking sign-in", control: "Signing in…", line: "Signing in…" },
} as const satisfies Record<string, { readonly state: string; readonly control: string; readonly line: string }>;
export type WalletWaiting = keyof typeof WALLET_WAITING;

export const WALLET_PROBLEMS = {
  no_wallet: {
    state: "No wallet found",
    message: "No Solana wallet found. Install Phantom, then reload this page.",
    fix: "get_phantom",
  },
  wrong_network: {
    state: "Wrong network",
    message: "Your wallet isn't on Solana Devnet. Switch it to Devnet, then connect again.",
    fix: "connect_wallet",
  },
  connect_rejected: {
    state: "Connection refused",
    message: "You closed the connection request. Nothing was shared.",
    fix: "connect_wallet",
  },
  sign_rejected: { state: "Sign-in refused", message: "You didn't sign in. Nothing was signed or sent.", fix: "sign_in_again" },
  cannot_sign: { state: "Wallet can't sign in", message: "This wallet can't sign in to OneTab. Use Phantom.", fix: "get_phantom" },
  challenge_stale: {
    state: "Sign-in message expired",
    message: "That sign-in message expired. Sign in again for a new one.",
    fix: "sign_in_again",
  },
  unavailable: {
    state: "Sign-in unavailable",
    message: "Sign-in isn't available right now. Try again in a moment.",
    fix: "try_again",
  },
  account_switched: {
    state: "Account switched",
    message: "Your wallet switched to {address}. Sign in again to continue as that wallet.",
    fix: "sign_in_again",
  },
  session_expired: {
    state: "Sign-in expired",
    message: "Your sign-in expired. Sign in again with the same wallet to continue.",
    fix: "sign_in_again",
  },
} as const satisfies Record<
  Problem,
  { readonly state: string; readonly message: string; readonly fix: WalletFixKind }
>;
