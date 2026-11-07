/**
 * Interim sample snapshots until B1 publishes src/fixtures/. At the swap, fixtures.ts imports B1's
 * snapshots and this file is deleted.
 *
 * Each sample is a one-line spec. build() applies the contracts.md phase rule, the equal split with
 * its remainder, frozen readiness once an attempt exists, signer sets and receipts, so samples are
 * consistent by construction. Every address starts with SAMPLE and ends in four readable characters,
 * so a screenshot can't pass for a real wallet and the short form tells payers apart.
 */
import {
  isAddress,
  isCheckoutId,
  isTokenUnits,
  type Address,
  type AttemptError,
  type AttemptState,
  type AttemptSummary,
  type CheckoutId,
  type PayerCount,
  type Phase,
  type PublicConfig,
  type RoomSnapshot,
  type TokenUnits,
} from "./contracts";
import { splitEqually } from "./units";

function sampleBase58(word: string, ending: string, length: number): string {
  const s = `SAMPLE${word}`.padEnd(length - ending.length, "1") + ending;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s) || s.length !== length) throw new Error(`Sample value is not base58: ${s}`);
  return s;
}

function sampleAddress(word: string, ending: string): Address {
  const s = sampleBase58(word, ending, 44);
  if (!isAddress(s)) throw new Error(`Sample address is not an address: ${s}`);
  return s;
}

function units(s: string): TokenUnits {
  if (!isTokenUnits(s)) throw new Error(`Sample amount is not integer units: ${s}`);
  return s;
}

function sampleId(n: number, variant: "8" | "9"): CheckoutId {
  const s = `00000000-0000-4000-${variant}000-${n.toString(16).padStart(12, "0")}`;
  if (!isCheckoutId(s)) throw new Error(`Sample id is not a UUID: ${s}`);
  return s;
}

/** The labeled test configuration contracts.md asks fixture mode to supply. */
export const SAMPLE_CONFIG: PublicConfig = {
  network: "devnet",
  mint: sampleAddress("testMint", "Usdc"),
  tokenDecimals: 6,
  confirmationTarget: "finalized",
};

export const SAMPLE_WALLETS = {
  organizer: sampleAddress("organizer", "org1"),
  bea: sampleAddress("payerBea", "Bea2"),
  cam: sampleAddress("payerCam", "Cam3"),
  /** Signed in but holds no spot: a guest in an open room, a spectator otherwise. */
  outsider: sampleAddress("someoneWithTheLink", "Gst4"),
  seller: sampleAddress("se11er", "Se11"),
} as const;

export const SAMPLE_SESSION_EXPIRY = "2099-01-01T00:00:00.000Z";

const SPOT_WALLETS = [SAMPLE_WALLETS.organizer, SAMPLE_WALLETS.bea, SAMPLE_WALLETS.cam] as const;
const TRANSACTION_REFERENCE = sampleBase58("transaction", "Txn5", 88);
const LAST_VALID_BLOCK_HEIGHT = "312345678";
const CREATED_AT = "2026-11-07T09:00:00.000Z";
const OBSERVED_AT = "2026-11-07T14:05:00.000Z";

const PURCHASES = {
  cabin: { title: "Cabin weekend groceries", total: "10000000", payers: 3 },
  concert: { title: "Concert tickets", total: "60000000", payers: 2 },
} as const satisfies Record<string, { title: string; total: string; payers: PayerCount }>;

type Spots = "all" | readonly number[];

type Spec = {
  readonly purchase: keyof typeof PURCHASES;
  /** Spots filled from slot 0. An attempt fills every spot. */
  readonly joined?: number;
  readonly ready?: Spots;
  readonly attempt?: {
    readonly state: AttemptState;
    readonly approved?: Spots;
    readonly canRetry?: boolean;
    /** Sets the transaction reference. */
    readonly sent?: boolean;
    /** A finalized receipt. With state "confirmed" this makes the phase paid. */
    readonly receipt?: boolean;
    readonly error?: AttemptError;
  };
};

const NOT_ENOUGH_USDC: AttemptError = {
  code: "INSUFFICIENT_USDC",
  message: "The wallet in spot 3 didn't hold enough test USDC for its share.",
};

const SPECS = {
  "open-spots": { purchase: "cabin", joined: 2, ready: [0] },
  "full-not-ready": { purchase: "cabin", joined: 3, ready: [0, 1] },
  ready: { purchase: "concert", joined: 2, ready: "all" },
  preparing: { purchase: "cabin", attempt: { state: "preparing" } },
  signing: { purchase: "cabin", attempt: { state: "signing", approved: [0] } },
  submitting: { purchase: "cabin", attempt: { state: "submitting", approved: "all", sent: true } },
  confirming: { purchase: "cabin", attempt: { state: "confirmed", approved: "all", sent: true } },
  unresolved: { purchase: "cabin", attempt: { state: "unresolved", approved: "all", sent: true } },
  "declined-on-hold": { purchase: "cabin", attempt: { state: "declined", approved: [0], canRetry: false } },
  "declined-retry": { purchase: "cabin", attempt: { state: "declined", approved: [0], canRetry: true } },
  "failed-on-hold": {
    purchase: "cabin",
    attempt: { state: "failed", approved: "all", sent: true, canRetry: false, error: NOT_ENOUGH_USDC },
  },
  "failed-retry": {
    purchase: "cabin",
    attempt: { state: "failed", approved: "all", sent: true, canRetry: true, error: NOT_ENOUGH_USDC },
  },
  "expired-on-hold": { purchase: "cabin", attempt: { state: "expired", approved: [0, 1], canRetry: false } },
  "expired-retry": { purchase: "cabin", attempt: { state: "expired", approved: [0, 1], canRetry: true } },
  paid: { purchase: "concert", attempt: { state: "confirmed", approved: "all", sent: true, receipt: true } },
} as const satisfies Record<string, Spec>;

export type SampleName = keyof typeof SPECS;

function spotWallet(slot: number): Address {
  const wallet = SPOT_WALLETS[slot];
  if (wallet === undefined) throw new Error(`No sample wallet for slot ${slot}`);
  return wallet;
}

const includes = (spots: Spots | undefined, slot: number): boolean =>
  spots === "all" || (spots ?? []).includes(slot);

/** contracts.md "Derive phase in this order". */
function phaseOf(snapshot: Omit<RoomSnapshot, "phase">): Phase {
  const a = snapshot.attempt;
  if (a?.receipt?.confirmationStatus === "finalized") return "paid";
  if (a && (a.state === "declined" || a.state === "unresolved" || a.state === "failed" || a.state === "expired"))
    return "needs_attention";
  if (a) return "paying";
  const full = snapshot.participants.length === snapshot.checkout.payerCount;
  return full && snapshot.participants.every((p) => p.ready) ? "ready" : "open";
}

function build(index: number, spec: Spec): RoomSnapshot {
  const purchase = PURCHASES[spec.purchase];
  const totalUnits = units(purchase.total);
  const shares = splitEqually(totalUnits, purchase.payers);
  const attempt = spec.attempt;
  const joined = attempt ? purchase.payers : (spec.joined ?? 1);
  const participants = shares.slice(0, joined).map((shareUnits, slot) => ({
    slot,
    wallet: spotWallet(slot),
    shareUnits,
    ready: attempt !== undefined || includes(spec.ready, slot),
  }));
  const checkout = {
    id: sampleId(index + 1, "8"),
    title: purchase.title,
    organizerWallet: SAMPLE_WALLETS.organizer,
    sellerWallet: SAMPLE_WALLETS.seller,
    network: SAMPLE_CONFIG.network,
    mint: SAMPLE_CONFIG.mint,
    tokenDecimals: SAMPLE_CONFIG.tokenDecimals,
    totalUnits,
    payerCount: purchase.payers,
    createdAt: CREATED_AT,
  };
  const summary: AttemptSummary | null = attempt
    ? {
        id: sampleId(index + 1, "9"),
        state: attempt.state,
        signedWallets: participants.filter((p) => includes(attempt.approved, p.slot)).map((p) => p.wallet),
        transactionReference: attempt.sent ? TRANSACTION_REFERENCE : null,
        lastValidBlockHeight: attempt.state === "preparing" ? null : LAST_VALID_BLOCK_HEIGHT,
        error: attempt.error ?? null,
        canRetry: attempt.canRetry ?? false,
        receipt: attempt.receipt
          ? {
              transactionReference: TRANSACTION_REFERENCE,
              confirmationStatus: "finalized",
              sellerWallet: SAMPLE_WALLETS.seller,
              totalUnits,
              contributions: participants.map((p) => ({ slot: p.slot, wallet: p.wallet, amountUnits: p.shareUnits })),
              observedAt: OBSERVED_AT,
              explorerUrl: `https://explorer.solana.com/tx/${TRANSACTION_REFERENCE}?cluster=devnet`,
            }
          : null,
      }
    : null;
  const snapshot = { checkout, participants, attempt: summary };
  return { ...snapshot, phase: phaseOf(snapshot) };
}

export const SNAPSHOTS = Object.fromEntries(
  Object.entries(SPECS).map(([name, spec], index) => [name, build(index, spec)]),
) as Readonly<Record<SampleName, RoomSnapshot>>;
