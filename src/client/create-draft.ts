/**
 * The create form's boundary: raw text in, a checked request with exact shares or plain-word field
 * errors out. F3 adds the POST, the clientRequestId and server errors, and sends `request` as is.
 */
import { isAddress, type Address, type PayerCount, type PublicConfig, type TokenUnits } from "./contracts";
import { WORDS } from "./catalog";
import type { CreateRequest, TabView } from "./checkout-view";
import { formatMoney, parseAmountInput, splitEqually, toTokenUnits, type AmountProblem, type Money } from "./units";

/** Exactly what the inputs hold. Nothing here is trusted. */
export type DraftInput = {
  readonly title: string;
  readonly seller: string;
  readonly total: string;
  readonly payerCount: string;
};
export type DraftField = keyof DraftInput;
export type DraftErrors = Readonly<Partial<Record<DraftField, string>>>;

export type DraftReview = {
  readonly request: CreateRequest;
  /** The tab card preview: spot 1 is the organizer, the rest are open, each with its exact share. */
  readonly tab: TabView;
};

export type DraftCheck = { readonly ok: true; readonly review: DraftReview } | { readonly ok: false; readonly errors: DraftErrors };

export const TITLE_MAX = 80;

export function checkDraft(
  input: DraftInput,
  ctx: { readonly config: PublicConfig; readonly organizer: Address | null },
): DraftCheck {
  const errors: Partial<Record<DraftField, string>> = {};
  const decimals = ctx.config.tokenDecimals;

  const title = input.title.trim();
  if (title === "") errors.title = "Give the checkout a name, like Cabin weekend groceries.";
  else if (title.length > TITLE_MAX) errors.title = `Keep the name to ${TITLE_MAX} characters or fewer.`;

  const seller = input.seller.trim();
  let sellerWallet: Address | null = null;
  if (seller === "") errors.seller = "Enter the seller's Solana wallet address.";
  else if (!isAddress(seller)) errors.seller = "This isn't a Solana wallet address. Copy it again from the seller.";
  else if (seller === ctx.organizer) errors.seller = "The seller can't be your own wallet. Enter the seller's wallet.";
  else sellerWallet = seller;

  const payerCount: PayerCount | null = input.payerCount === "2" ? 2 : input.payerCount === "3" ? 3 : null;
  if (payerCount === null) errors.payerCount = "Choose 2 or 3 payers.";

  const amount = parseAmountInput(input.total, decimals);
  if (!amount.ok) errors.total = AMOUNT_PROBLEMS[amount.problem](decimals);
  else if (payerCount !== null && BigInt(amount.units) < BigInt(payerCount))
    errors.total = `The total is too small to split. Each payer needs at least ${formatMoney({ units: toTokenUnits(1n), decimals })} ${WORDS.asset}.`;

  if (!amount.ok || sellerWallet === null || payerCount === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  const shares = splitEqually(amount.units, payerCount);
  const money = (units: TokenUnits): Money => ({ units, decimals });
  return {
    ok: true,
    review: {
      request: { title, sellerWallet, totalUnits: amount.units, payerCount },
      tab: {
        title,
        total: money(amount.units),
        seller: sellerWallet,
        progress: `1 of ${payerCount} joined, 0 ready`,
        spots: shares.map((share, slot) => ({
          slot,
          wallet: slot === 0 ? ctx.organizer : null,
          share: money(share),
          status: slot === 0 ? "joined" : "open",
          isViewer: slot === 0,
          isOrganizer: slot === 0,
        })),
      },
    },
  };
}

const AMOUNT_PROBLEMS: { readonly [P in AmountProblem]: (decimals: number) => string } = {
  empty: () => `Enter the total in ${WORDS.asset}, like 60 or 24.50.`,
  not_a_number: () => "Use digits and a decimal point only, like 24.50.",
  too_many_decimals: (decimals) => `Use at most ${decimals} decimal places.`,
  not_positive: () => "The total must be more than zero.",
  too_large: () => "This total is too large. Enter a smaller amount.",
};
