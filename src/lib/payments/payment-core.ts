import {
  address, appendTransactionMessageInstructions, blockhash, compileTransaction,
  createTransactionMessage, createNoopSigner, getTransactionDecoder, getTransactionEncoder,
  setTransactionMessageComputeUnitLimit, setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Address, type Blockhash, type ReadonlyUint8Array,
} from '@solana/kit';
import { getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const U64_MAX = (1n << 64n) - 1n;
const validatedPlan = Symbol('validated payment plan');
export type Payers<T> = readonly [T, T] | readonly [T, T, T];
export type PayerSource = Readonly<{ wallet: Address; sourceTokenAccount: Address }>;
export type PaymentPlanInput = Readonly<{
  totalUnits: bigint; sellerWallet: Address; sellerTokenAccount: Address; payers: Payers<PayerSource>;
}>;
export type Contribution = Readonly<PayerSource & { slot: 0 | 1 | 2; units: bigint }>;
export type PaymentPlan = Readonly<{
  [validatedPlan]: true;
  network: 'devnet'; mint: Address<typeof DEVNET_USDC>; decimals: 6;
  tokenProgram: typeof TOKEN_PROGRAM_ADDRESS;
  totalUnits: bigint; sellerWallet: Address; sellerTokenAccount: Address;
  feePayer: Address; contributions: Payers<Contribution>;
}>;
export type Lifetime = Readonly<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>;
export type MessageCandidate = Readonly<{
  transactionBytes: ReadonlyUint8Array; messageBytes: ReadonlyUint8Array; messageHash: string;
}>;
export type ExpectedMessage = Readonly<{ plan: PaymentPlan; blockhash: Blockhash; messageHash: string }>;

export function equalShares(total: bigint, count: 2): readonly [bigint, bigint];
export function equalShares(total: bigint, count: 3): readonly [bigint, bigint, bigint];
export function equalShares(total: bigint, count: 2 | 3): Payers<bigint>;
export function equalShares(total: bigint, count: 2 | 3): Payers<bigint> {
  if (typeof total !== 'bigint' || total <= 0n || total > U64_MAX || (count !== 2 && count !== 3)) {
    throw new Error('Invalid payment total or payer count');
  }
  const share = total / BigInt(count);
  if (share === 0n) throw new Error('Every payer must contribute a positive amount');
  const remainder = total % BigInt(count);
  return count === 2 ? Object.freeze([share + remainder, share])
    : Object.freeze([share + (remainder > 0n ? 1n : 0n), share + (remainder > 1n ? 1n : 0n), share]);
}

export function createPaymentPlan(input: PaymentPlanInput): PaymentPlan {
  const count = input.payers.length;
  const shares = equalShares(input.totalUnits, count);
  const contribution = (payer: PayerSource, slot: 0 | 1 | 2, units: bigint): Contribution => Object.freeze({
    slot, wallet: address(payer.wallet), sourceTokenAccount: address(payer.sourceTokenAccount), units,
  });
  const contributions: Payers<Contribution> = count === 2
    ? Object.freeze([contribution(input.payers[0], 0, shares[0]), contribution(input.payers[1], 1, shares[1])])
    : Object.freeze([contribution(input.payers[0], 0, shares[0]), contribution(input.payers[1], 1, shares[1]),
      contribution(input.payers[2], 2, equalShares(input.totalUnits, 3)[2])]);
  const plan: PaymentPlan = {
    [validatedPlan]: true, network: 'devnet', mint: address(DEVNET_USDC), decimals: 6,
    tokenProgram: TOKEN_PROGRAM_ADDRESS, totalUnits: input.totalUnits,
    sellerWallet: address(input.sellerWallet), sellerTokenAccount: address(input.sellerTokenAccount),
    feePayer: contributions[0].wallet, contributions,
  };
  const accounts = [plan.sellerWallet, plan.sellerTokenAccount, plan.mint, plan.tokenProgram,
    ...contributions.flatMap(payer => [payer.wallet, payer.sourceTokenAccount])];
  if (new Set(accounts).size !== accounts.length) throw new Error('Accounts must be distinct');
  return Object.freeze(plan);
}

export function equalBytes(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function sha256(bytes: ReadonlyUint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function canonicalTransaction(plan: PaymentPlan, hash: Blockhash) {
  const withPayer = setTransactionMessageFeePayer(plan.feePayer, createTransactionMessage({ version: 'legacy' }));
  const withLifetime = setTransactionMessageLifetimeUsingBlockhash({
    blockhash: hash, lastValidBlockHeight: 0n,
  }, withPayer);
  const withBudget = setTransactionMessageComputeUnitPrice(0n, setTransactionMessageComputeUnitLimit(400_000, withLifetime));
  return compileTransaction(appendTransactionMessageInstructions(plan.contributions.map(payer =>
    getTransferCheckedInstruction({
      source: payer.sourceTokenAccount, mint: plan.mint, destination: plan.sellerTokenAccount,
      authority: createNoopSigner(payer.wallet), amount: payer.units, decimals: plan.decimals,
    })), withBudget));
}

export async function buildPaymentMessage(plan: PaymentPlan, lifetime: Lifetime): Promise<MessageCandidate> {
  if (typeof lifetime.lastValidBlockHeight !== 'bigint' || lifetime.lastValidBlockHeight < 0n || lifetime.lastValidBlockHeight > U64_MAX) {
    throw new Error('Invalid last valid block height');
  }
  const transaction = canonicalTransaction(plan, blockhash(lifetime.blockhash));
  return Object.freeze({
    transactionBytes: Uint8Array.from(getTransactionEncoder().encode(transaction)),
    messageBytes: Uint8Array.from(transaction.messageBytes), messageHash: await sha256(transaction.messageBytes),
  });
}

export async function inspectPaymentMessage(candidate: MessageCandidate, expected: ExpectedMessage): Promise<MessageCandidate> {
  const transactionBytes = Uint8Array.from(candidate.transactionBytes);
  const messageBytes = Uint8Array.from(candidate.messageBytes);
  const messageHash = candidate.messageHash;
  const expectedHash = expected.messageHash;
  const canonical = canonicalTransaction(expected.plan, blockhash(expected.blockhash));
  const actual = getTransactionDecoder().decode(transactionBytes);
  if (!equalBytes(actual.messageBytes, canonical.messageBytes) || !equalBytes(messageBytes, canonical.messageBytes)
    || !equalBytes(transactionBytes, getTransactionEncoder().encode(canonical))
    || messageHash !== expectedHash || await sha256(messageBytes) !== expectedHash) {
    throw new Error('Full payment message mismatch');
  }
  return Object.freeze({ transactionBytes, messageBytes, messageHash });
}
