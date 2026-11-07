import type {
  ApiResponse,
  AttemptState,
  AttemptSummary,
  PublicConfig,
  RoomSnapshot,
  SigningPayload,
} from "../contracts";

// These values are examples only and must never be used for signing or broadcasting.
const fixtureAddresses = {
  organizer: "11111111111111111111111111111111",
  payer2: "11111111111111111111111111111112",
  payer3: "11111111111111111111111111111113",
  seller: "11111111111111111111111111111114",
  mint: "11111111111111111111111111111115",
  sellerToken: "11111111111111111111111111111116",
  sources: [
    "11111111111111111111111111111117",
    "11111111111111111111111111111118",
    "11111111111111111111111111111119",
  ],
} as const;

export const fixtureConfig = {
  fixture: true,
  data: {
    network: "devnet",
    mint: fixtureAddresses.mint,
    tokenDecimals: 6,
    confirmationTarget: "finalized",
  },
} satisfies { fixture: true; data: PublicConfig };
const checkout = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Fixture checkout",
  organizerWallet: fixtureAddresses.organizer,
  sellerWallet: fixtureAddresses.seller,
  network: "devnet",
  mint: fixtureAddresses.mint,
  tokenDecimals: 6,
  totalUnits: "6000000",
  payerCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
} satisfies RoomSnapshot["checkout"];
const participants = [
  { slot: 0, wallet: fixtureAddresses.organizer, shareUnits: "2000000", ready: true },
  { slot: 1, wallet: fixtureAddresses.payer2, shareUnits: "2000000", ready: true },
  { slot: 2, wallet: fixtureAddresses.payer3, shareUnits: "2000000", ready: true },
];
const attemptId = "00000000-0000-4000-8000-000000000002";
const fixtureTransactionReference = "2".repeat(87);
const receipt = {
  transactionReference: fixtureTransactionReference,
  confirmationStatus: "finalized",
  sellerWallet: checkout.sellerWallet,
  totalUnits: checkout.totalUnits,
  contributions: participants.map(({ slot, wallet, shareUnits }) => ({
    slot,
    wallet,
    amountUnits: shareUnits,
  })),
  observedAt: "2026-01-01T00:01:00.000Z",
  explorerUrl: `https://explorer.solana.com/tx/${fixtureTransactionReference}?cluster=devnet`,
} satisfies NonNullable<AttemptSummary["receipt"]>;
function summary(state: AttemptState, canRetry = false): AttemptSummary {
  const submitted = ["submitting", "unresolved", "confirmed"].includes(state);
  return {
    id: attemptId,
    state,
    signedWallets:
      state === "signing" || state === "declined"
        ? [participants[0].wallet]
        : submitted
          ? participants.map((participant) => participant.wallet)
          : [],
    transactionReference: submitted ? fixtureTransactionReference : null,
    lastValidBlockHeight: "123456",
    error:
      state === "failed"
        ? { code: "INVALID_PAYMENT", message: "Fixture payment failed." }
        : null,
    canRetry,
    receipt: state === "confirmed" ? receipt : null,
  };
}
function room(state: AttemptState, canRetry = false): RoomSnapshot {
  return {
    checkout,
    participants,
    phase:
      state === "confirmed"
        ? "paid"
        : ["declined", "unresolved", "failed", "expired"].includes(state)
          ? "needs_attention"
          : "paying",
    attempt: summary(state, canRetry),
  };
}
export const roomFixtures = {
  fixture: true,
  data: {
    open: { checkout, participants: participants.slice(0, 1), phase: "open", attempt: null },
    fullNotReady: {
      checkout,
      participants: participants.map((participant, index) => ({
        ...participant,
        ready: index !== 2,
      })),
      phase: "open",
      attempt: null,
    },
    ready: { checkout, participants, phase: "ready", attempt: null },
    preparing: room("preparing"),
    signing: room("signing"),
    submitting: room("submitting"),
    unresolved: room("unresolved"),
    declined: room("declined"),
    confirmed: room("confirmed"),
    failedBlocked: room("failed"),
    failedRetry: room("failed", true),
    expired: room("expired", true),
  },
} satisfies { fixture: true; data: Record<string, RoomSnapshot> };
export const signingPayloadFixture = {
  fixture: true,
  data: {
    attemptId,
    checkoutId: checkout.id,
    transactionBase64: "RklYVFVSRQ==",
    messageBase64: "RklYVFVSRQ==",
    messageHash: "0000000000000000000000000000000000000000000000000000000000000000",
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: "123456",
    payment: {
      network: "devnet",
      mint: checkout.mint,
      tokenDecimals: 6,
      sellerWallet: checkout.sellerWallet,
      sellerTokenAccount: fixtureAddresses.sellerToken,
      feePayerWallet: checkout.organizerWallet,
      contributions: participants.map(({ slot, wallet, shareUnits }) => ({
        slot,
        wallet,
        amountUnits: shareUnits,
        sourceTokenAccount: fixtureAddresses.sources[slot],
      })),
    },
  },
} satisfies { fixture: true; data: SigningPayload };
export const errorFixture = {
  fixture: true,
  data: { error: { code: "ROOM_FULL", message: "This checkout is full." } },
} satisfies { fixture: true; data: ApiResponse<never> };
