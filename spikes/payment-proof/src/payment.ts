import {
  address, appendTransactionMessageInstructions, blockhash, compileTransaction, signatureBytes,
  createTransactionMessage, createNoopSigner, getAddressEncoder, getBase58Decoder,
  getCompiledTransactionMessageDecoder, getTransactionDecoder, getTransactionEncoder,
  setTransactionMessageComputeUnitLimit, setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { z } from 'zod';

export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const U64_MAX = (1n << 64n) - 1n;
export const addressSchema = z.string().transform(value => address(value));
export const unitsSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).pipe(z.string().refine(value => BigInt(value) <= U64_MAX));
const positiveUnits = unitsSchema.pipe(z.string().refine(value => BigInt(value) > 0n));
export const slotSchema = z.union([z.literal(0), z.literal(1)]);
export type Slot = z.infer<typeof slotSchema>;
const contributionSchema = z.strictObject({
  slot: slotSchema, wallet: addressSchema, sourceTokenAccount: addressSchema, units: positiveUnits,
});
export const planSchema = z.strictObject({
  network: z.literal('devnet'), mint: z.literal(DEVNET_USDC).transform(address),
  decimals: z.literal(6), tokenProgram: z.literal(TOKEN_PROGRAM_ADDRESS),
  sellerWallet: addressSchema, sellerTokenAccount: addressSchema, feePayer: addressSchema,
  total: positiveUnits, contributions: z.tuple([contributionSchema, contributionSchema]),
}).superRefine((plan, ctx) => {
  const [first, second] = plan.contributions;
  const total = BigInt(plan.total);
  if (first.slot !== 0 || second.slot !== 1 || plan.feePayer !== first.wallet
    || BigInt(first.units) !== total / 2n + total % 2n || BigInt(second.units) !== total / 2n) {
    ctx.addIssue({ code: 'custom', message: 'Invalid equal split or organizer' });
  }
  const accounts = [first.wallet, second.wallet, plan.sellerWallet, first.sourceTokenAccount,
    second.sourceTokenAccount, plan.sellerTokenAccount, plan.mint, plan.tokenProgram];
  if (new Set(accounts).size !== accounts.length) ctx.addIssue({ code: 'custom', message: 'Accounts must be distinct' });
});
export type Plan = z.infer<typeof planSchema>;
export const frozenSchema = z.strictObject({
  id: z.uuid(), plan: planSchema, planHash: z.string().regex(/^[a-f0-9]{64}$/),
  messageHash: z.string().regex(/^[a-f0-9]{64}$/), blockhash: z.string().transform(blockhash),
  lastValidBlockHeight: unitsSchema, messageBase64: z.string(), transactionBase64: z.string(),
  version: z.literal('legacy'),
});
export type FrozenPayment = z.infer<typeof frozenSchema>;
export const approvalSchema = z.strictObject({
  slot: slotSchema, messageHash: z.string().regex(/^[a-f0-9]{64}$/), signatureBase64: z.string(),
});
export type Approval = z.infer<typeof approvalSchema>;
export type Submission = Readonly<{ reference: string; signedBase64: string; signedHash: string }>;

export function toBase64(bytes: ReadonlyUint8Array): string { return btoa(String.fromCharCode(...bytes)); }
export function fromBase64(value: string): Uint8Array {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (toBase64(bytes) !== value) throw new Error('Noncanonical base64');
  return bytes;
}
export function equalBytes(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
export async function sha256(bytes: ReadonlyUint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
export function planBytes(plan: Plan): Uint8Array { return new TextEncoder().encode(JSON.stringify(planSchema.parse(plan))); }

function canonicalTransaction(plan: Plan, hash: string, lastHeight: string) {
  const withPayer = setTransactionMessageFeePayer(plan.feePayer, createTransactionMessage({ version: 'legacy' }));
  const withLifetime = setTransactionMessageLifetimeUsingBlockhash({
    blockhash: blockhash(hash), lastValidBlockHeight: BigInt(lastHeight),
  }, withPayer);
  const withBudget = setTransactionMessageComputeUnitPrice(0n, setTransactionMessageComputeUnitLimit(400_000, withLifetime));
  return compileTransaction(appendTransactionMessageInstructions(plan.contributions.map(payer =>
    getTransferCheckedInstruction({
      source: payer.sourceTokenAccount, mint: plan.mint, destination: plan.sellerTokenAccount,
      authority: createNoopSigner(payer.wallet), amount: BigInt(payer.units), decimals: plan.decimals,
    })), withBudget));
}

export async function freezePayment(input: { id: string; plan: Plan; blockhash: string; lastValidBlockHeight: string }): Promise<FrozenPayment> {
  const plan = planSchema.parse(input.plan);
  const tx = canonicalTransaction(plan, input.blockhash, input.lastValidBlockHeight);
  return frozenSchema.parse({
    ...input, plan, version: 'legacy', planHash: await sha256(planBytes(plan)),
    messageHash: await sha256(tx.messageBytes), messageBase64: toBase64(tx.messageBytes),
    transactionBase64: toBase64(getTransactionEncoder().encode(tx)),
  });
}

export async function inspectPayment(input: unknown, expected: { plan: Plan; planHash: string; messageHash: string }): Promise<FrozenPayment> {
  const payment = frozenSchema.parse(input);
  const expectedPlan = planSchema.parse(expected.plan);
  if (await sha256(planBytes(expectedPlan)) !== expected.planHash || payment.planHash !== expected.planHash
    || !equalBytes(planBytes(payment.plan), planBytes(expectedPlan))) throw new Error('Expected plan mismatch');
  const original = fromBase64(payment.transactionBase64);
  const actual = getTransactionDecoder().decode(original);
  const message = fromBase64(payment.messageBase64);
  const canonical = canonicalTransaction(expectedPlan, payment.blockhash, payment.lastValidBlockHeight);
  const decoded = getCompiledTransactionMessageDecoder().decode(actual.messageBytes);
  if (decoded.version !== 'legacy' || decoded.instructions.length !== 4 || !equalBytes(actual.messageBytes, canonical.messageBytes)
    || !equalBytes(message, canonical.messageBytes) || !equalBytes(original, getTransactionEncoder().encode(canonical))
    || await sha256(message) !== expected.messageHash || payment.messageHash !== expected.messageHash) {
    throw new Error('Full payment message mismatch');
  }
  const signers = Object.keys(actual.signatures);
  if (signers.length !== 2 || !payment.plan.contributions.every(payer => signers.includes(payer.wallet))) {
    throw new Error('Expected two payer signers');
  }
  return payment;
}

export async function verifyApproval(payment: FrozenPayment, input: unknown): Promise<Approval> {
  const approval = approvalSchema.parse(input);
  const payer = payment.plan.contributions[approval.slot];
  const bytes = fromBase64(approval.signatureBase64);
  if (approval.messageHash !== payment.messageHash || bytes.length !== 64 || bytes.every(byte => byte === 0)) throw new Error('Invalid signature');
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(getAddressEncoder().encode(payer.wallet)).buffer, 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, Uint8Array.from(bytes).buffer, Uint8Array.from(fromBase64(payment.messageBase64)).buffer)) {
    throw new Error('Invalid signature');
  }
  return approval;
}

export async function verifyWalletReturn(payment: FrozenPayment, slot: Slot, returned: Uint8Array): Promise<Approval> {
  const transaction = getTransactionDecoder().decode(returned);
  if (!equalBytes(transaction.messageBytes, fromBase64(payment.messageBase64))
    || !equalBytes(returned, getTransactionEncoder().encode(transaction))) throw new Error('Wallet changed transaction');
  const payer = payment.plan.contributions[slot];
  for (const [signer, signature] of Object.entries(transaction.signatures)) {
    if (signer !== payer.wallet && signature !== null && signature.some(value => value !== 0)) throw new Error('Unexpected signature slot');
  }
  const signature = transaction.signatures[payer.wallet];
  if (!signature) throw new Error('Missing wallet signature');
  return verifyApproval(payment, { slot, messageHash: payment.messageHash, signatureBase64: toBase64(signature) });
}

export async function assembleSubmission(payment: FrozenPayment, inputs: readonly Approval[]): Promise<Submission> {
  if (inputs.length !== 2 || new Set(inputs.map(approval => approval.slot)).size !== 2) throw new Error('Signatures incomplete');
  const approvals = await Promise.all(inputs.map(input => verifyApproval(payment, input)));
  const submission = assembleVerifiedApprovals(payment, approvals);
  return { ...submission, signedHash: await sha256(fromBase64(submission.signedBase64)) };
}

export function assembleVerifiedApprovals(payment: FrozenPayment, approvals: readonly Approval[], incompleteDiagnostic = false): Omit<Submission, 'signedHash'> {
  if ((!incompleteDiagnostic && approvals.length !== 2) || new Set(approvals.map(value => value.slot)).size !== approvals.length) throw new Error('Signatures incomplete');
  const original = getTransactionDecoder().decode(fromBase64(payment.transactionBase64));
  const signatures = { ...original.signatures };
  for (const approval of approvals) {
    const bytes = fromBase64(approval.signatureBase64);
    const key = payment.plan.contributions[approval.slot].wallet;
    signatures[key] = signatureBytes(bytes);
  }
  const transaction = { ...original, signatures };
  const signed = getTransactionEncoder().encode(transaction);
  const organizer = signatures[payment.plan.feePayer];
  if (!organizer && !incompleteDiagnostic) throw new Error('Missing organizer signature');
  return { reference: organizer ? getBase58Decoder().decode(organizer) : '', signedBase64: toBase64(signed) };
}
