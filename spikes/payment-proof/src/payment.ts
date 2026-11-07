import { address, blockhash } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  DEVNET_USDC, buildPaymentMessage, createPaymentPlan, equalBytes, equalShares, inspectPaymentMessage, sha256,
  type PaymentPlan,
} from '../../../src/lib/payments/payment-core.js';
import { z } from 'zod';
import {
  assembleSignedPayment, assembleTrustedSignatures, verifyPayerSignature, verifyWalletSignature,
  type PayerSignature, type SignatureTarget,
} from '../../../src/lib/payments/signature-core.js';
import { fromBase64, toBase64 } from '../../../src/lib/payments/signing-payload.js';
export { fromBase64, toBase64 } from '../../../src/lib/payments/signing-payload.js';

export { DEVNET_USDC, equalBytes, sha256 } from '../../../src/lib/payments/payment-core.js';

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
  const amounts = [plan.total, first.units, second.units];
  if (amounts.some(value => !positiveUnits.safeParse(value).success)) return;
  const total = BigInt(plan.total);
  const shares = total >= 2n ? equalShares(total, 2) : null;
  if (!shares || first.slot !== 0 || second.slot !== 1 || plan.feePayer !== first.wallet
    || BigInt(first.units) !== shares[0] || BigInt(second.units) !== shares[1]) {
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

export function planBytes(plan: Plan): Uint8Array { return new TextEncoder().encode(JSON.stringify(planSchema.parse(plan))); }

export function corePlanFromProofPlan(input: Plan): PaymentPlan {
  const plan = planSchema.parse(input);
  return createPaymentPlan({
    totalUnits: BigInt(plan.total), sellerWallet: plan.sellerWallet, sellerTokenAccount: plan.sellerTokenAccount,
    payers: [plan.contributions[0], plan.contributions[1]],
  });
}

export async function freezePayment(input: { id: string; plan: Plan; blockhash: string; lastValidBlockHeight: string }): Promise<FrozenPayment> {
  const envelope = { ...input };
  const plan = planSchema.parse(envelope.plan);
  const message = await buildPaymentMessage(corePlanFromProofPlan(plan), {
    blockhash: blockhash(envelope.blockhash), lastValidBlockHeight: BigInt(envelope.lastValidBlockHeight),
  });
  return frozenSchema.parse({
    ...envelope, plan, version: 'legacy', planHash: await sha256(planBytes(plan)),
    messageHash: message.messageHash, messageBase64: toBase64(message.messageBytes),
    transactionBase64: toBase64(message.transactionBytes),
  });
}

export async function inspectPayment(input: unknown, expected: { plan: Plan; planHash: string; messageHash: string }): Promise<FrozenPayment> {
  const payment = frozenSchema.parse(input);
  const expectedPlan = planSchema.parse(expected.plan);
  const expectedPlanHash = expected.planHash;
  const expectedMessageHash = expected.messageHash;
  if (await sha256(planBytes(expectedPlan)) !== expectedPlanHash || payment.planHash !== expectedPlanHash
    || !equalBytes(planBytes(payment.plan), planBytes(expectedPlan))) throw new Error('Expected plan mismatch');
  await inspectPaymentMessage({
    transactionBytes: fromBase64(payment.transactionBase64), messageBytes: fromBase64(payment.messageBase64),
    messageHash: payment.messageHash,
  }, { plan: corePlanFromProofPlan(expectedPlan), blockhash: payment.blockhash, messageHash: expectedMessageHash });
  return payment;
}

function signatureTarget(payment: FrozenPayment): SignatureTarget {
  return { plan: corePlanFromProofPlan(payment.plan), message: {
    transactionBytes: fromBase64(payment.transactionBase64), messageBytes: fromBase64(payment.messageBase64),
    messageHash: payment.messageHash,
  } };
}

function payerSignature(payment: FrozenPayment, approval: Approval): PayerSignature {
  if (approval.messageHash !== payment.messageHash) throw new Error('Invalid signature');
  return { wallet: payment.plan.contributions[approval.slot].wallet, signatureBytes: fromBase64(approval.signatureBase64) };
}

export async function verifyApproval(payment: FrozenPayment, input: unknown): Promise<Approval> {
  const snapshot = frozenSchema.parse(payment);
  const approval = approvalSchema.parse(input);
  await verifyPayerSignature(signatureTarget(snapshot), payerSignature(snapshot, approval));
  return approval;
}

export async function verifyWalletReturn(payment: FrozenPayment, slot: Slot, returned: Uint8Array): Promise<Approval> {
  const snapshot = frozenSchema.parse(payment);
  const payer = snapshot.plan.contributions[slot];
  const signature = await verifyWalletSignature(signatureTarget(snapshot), payer.wallet, returned);
  return { slot, messageHash: snapshot.messageHash, signatureBase64: toBase64(signature.signatureBytes) };
}

export async function assembleSubmission(payment: FrozenPayment, inputs: readonly Approval[]): Promise<Submission> {
  const snapshot = frozenSchema.parse(payment);
  const approvals = inputs.map(input => approvalSchema.parse(input));
  const signed = await assembleSignedPayment(signatureTarget(snapshot), approvals.map(approval => payerSignature(snapshot, approval)));
  return { reference: signed.reference, signedBase64: toBase64(signed.transactionBytes), signedHash: await sha256(signed.transactionBytes) };
}

export function assembleVerifiedApprovals(payment: FrozenPayment, approvals: readonly Approval[], incompleteDiagnostic = false): Omit<Submission, 'signedHash'> {
  const snapshot = frozenSchema.parse(payment);
  const target = signatureTarget(snapshot);
  const signatures = approvals.map(input => payerSignature(snapshot, approvalSchema.parse(input)));
  const signed = incompleteDiagnostic
    ? assembleTrustedSignatures(target, signatures, { incompleteDiagnostic: true })
    : assembleTrustedSignatures(target, signatures);
  return { reference: signed.reference ?? '', signedBase64: toBase64(signed.transactionBytes) };
}
