import type { SignFailure } from "@/lib/wallet/environment";
import type { Problem } from "@/lib/wallet/machine";
import type { RequestProblem } from "./api";
import type { ErrorCode, Network } from "./contracts";
import type { CheckFailure, ReturnFailure } from "./payment-check";

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
  readonly busy?: string;
};

export const ACTIONS = {
  review_checkout: { label: "Review checkout", needs: "nothing", element: "button" },
  edit_details: { label: "Edit details", needs: "nothing", element: "button" },
  create_checkout: { label: "Create checkout", needs: "backend", element: "button", busy: "Creating…" },
  copy_link: { label: "Copy link", needs: "nothing", element: "button" },
  connect_wallet: { label: "Connect wallet", needs: "wallet", element: "button" },
  join: { label: "Join checkout", needs: "backend", element: "button", busy: "Joining…" },
  mark_ready: { label: "I'm ready", needs: "backend", element: "button", busy: "Saving…" },
  mark_not_ready: { label: "Not ready yet", needs: "backend", element: "button", busy: "Saving…" },
  start_payment: { label: "Start payment", needs: "backend", element: "button", busy: "Starting…" },
  approve: { label: "Approve in wallet", needs: "wallet", element: "button", busy: "Approving…" },
  decline: { label: "Decline payment", needs: "backend", element: "button", busy: "Declining…" },
  retry: { label: "Try again", needs: "backend", element: "button", busy: "Starting…" },
  view_status: { label: "View payment status", needs: "nothing", element: "link" },
  view_receipt: { label: "View receipt", needs: "nothing", element: "link" },
  back_to_checkout: { label: "Back to checkout", needs: "nothing", element: "link" },
  view_on_explorer: { label: "View on Solana Explorer", needs: "chain", element: "external_link" },
  open_sample_room: { label: "Open the sample checkout", needs: "nothing", element: "link" },
  create_a_checkout: { label: "Create a checkout", needs: "nothing", element: "link" },
  reload_page: { label: "Try again", needs: "nothing", element: "button" },
} as const satisfies Record<string, ActionMeta>;
export type ActionKind = keyof typeof ACTIONS;

export type StopReason =
  | "short_usdc"
  | "short_sol"
  | "no_token_account"
  | "network_unreachable"
  | "network_rejected"
  | "not_sent";

type StopWords = { readonly happened: string; readonly next: string | null };

export const STOP_REASONS = {
  short_usdc: {
    happened:
      "A payer's wallet didn't hold their full share in test USDC, so the payment didn't start. Nothing was sent and no network fee was paid.",
    next: "Each payer checks that their wallet holds their share in test USDC on Solana Devnet.",
  },
  short_sol: {
    happened:
      "The organizer's wallet didn't hold enough SOL for the network fee, so the payment didn't start. Nothing was sent and no network fee was paid.",
    next: "The organizer adds SOL on Solana Devnet to their wallet.",
  },
  no_token_account: {
    happened:
      "A wallet in this payment, a payer's or the seller's, can't receive test USDC yet, so the payment didn't start. Nothing was sent and no network fee was paid.",
    next: "That wallet receives test USDC on Solana Devnet once before the next try.",
  },
  network_unreachable: {
    happened: "OneTab couldn't reach Solana Devnet while preparing the payment, so nothing was sent and no network fee was paid.",
    next: null,
  },
  network_rejected: {
    happened:
      "The network rejected the payment, so no share reached the seller. The organizer's wallet may have paid a small network fee in SOL.",
    next: "Before the next try, each payer checks that their wallet still holds their share in test USDC.",
  },
  not_sent: {
    happened: "The payment stopped before it was sent, so nothing reached the seller and no network fee was paid.",
    next: "Before the next try, each payer checks that their wallet holds their share in test USDC, and the organizer checks that theirs holds SOL for the network fee.",
  },
} as const satisfies { readonly [K in StopReason]: StopWords };

export const CAUSE_OF_CODE = {
  INSUFFICIENT_USDC: "short_usdc",
  INSUFFICIENT_SOL: "short_sol",
  TOKEN_ACCOUNT_MISSING: "no_token_account",
  RPC_UNAVAILABLE: "network_unreachable",
} as const satisfies Partial<Record<ErrorCode, StopReason>>;

export type FundingCause = (typeof CAUSE_OF_CODE)["INSUFFICIENT_USDC" | "INSUFFICIENT_SOL" | "TOKEN_ACCOUNT_MISSING"];

const CAUSES_BY_CODE: Partial<Record<ErrorCode, StopReason>> = CAUSE_OF_CODE;

export function causeOfCode(code: ErrorCode): StopReason | null {
  return CAUSES_BY_CODE[code] ?? null;
}

const toldInFull = (words: { readonly happened: string; readonly next: string }) => `${words.happened} ${words.next}`;

export type ProblemWithWords =
  | Exclude<RequestProblem | CheckFailure | ReturnFailure | SignFailure, "signed_out" | "stale">
  | "approval_refused"
  | "room_changed_unread";

export const REQUEST_PROBLEMS = {
  room_full: "Someone took the last spot first. This checkout is full.",
  room_changed: "The checkout moved on before this went through. It shows the latest now.",
  room_changed_unread: "The checkout moved on before this went through. OneTab couldn't load the latest yet.",
  short_usdc: toldInFull(STOP_REASONS.short_usdc),
  short_sol: toldInFull(STOP_REASONS.short_sol),
  no_token_account: toldInFull(STOP_REASONS.no_token_account),
  rate_limited: "Too many tries in a row. Wait a few seconds, then try again.",
  refused: "OneTab couldn't accept this, so nothing changed. Reload the page and try again.",
  unavailable: "OneTab couldn't confirm this went through. Trying again is safe.",
  mismatch: "The payment OneTab received doesn't match this checkout, so your wallet wasn't opened. Nothing was approved.",
  unsupported: "Approving isn't available here yet, so your wallet wasn't opened. Nothing was approved.",
  rejected:
    "You didn't approve in your wallet, so nothing was sent. You can approve again. Declining stops this payment for everyone, and the checkout stays on hold until it's safely closed.",
  busy: "Your wallet already has an approval request open. Finish it there first.",
  failed: "Your wallet didn't return an approval OneTab can use, so nothing was approved. Try again.",
  unchecked: "OneTab couldn't check the approval your wallet returned, so nothing was sent.",
  approval_refused: "OneTab couldn't accept this approval, so nothing was sent. You can approve again.",
} as const satisfies Record<ProblemWithWords, string>;

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
  network_fee: "Network fee",
  fee_you_pay: "You pay the network fee in SOL, because you're the organizer.",
  fee_organizer_pays: "The organizer pays the network fee, even if your wallet shows one.",
  approval_covers:
    "Your approval covers the whole payment, so your wallet may show every share, not just yours. Nothing moves until everyone approves.",
  payers: "Payers",
  seller: "Seller",
  seller_no_spot: "You're the seller, so you don't take a spot.",
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
  creation_unavailable: "OneTab can't reach its payment service right now, so it can't create a checkout. Try again in a moment.",
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
  declined: "You declined this payment.",
  seller_wallet: "seller wallet",
  you_are_ready: "You're ready.",
  end_sign_in: "End sign-in",
  no_payment_yet: "No payment has started yet. Its status appears here once everyone approves.",
  approvals_open:
    "Approvals are open on the checkout page. The payment goes out once every payer approves it, and its status appears here then.",
  room_unreachable: "Can't reach OneTab right now. This page keeps trying and shows the last update it got.",
  keeps_checking_here: "This page keeps checking the same transaction, and no new payment will start.",
  keeps_checking_payers:
    "OneTab keeps checking the same transaction while a payer has this checkout open, and no new payment will start.",
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
  payment_prompt: {
    state: "Approving",
    control: "Approving…",
    line: "Approve the payment in your wallet. It covers every share in one payment.",
  },
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
