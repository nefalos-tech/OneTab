import {
  getAddressEncoder, getBase58Decoder, getCompiledTransactionMessageDecoder,
  getTransactionDecoder, getTransactionEncoder, signatureBytes,
  type Address, type ReadonlyUint8Array,
} from '@solana/kit';
import { equalBytes, type MessageCandidate, type PaymentPlan } from '../../../src/lib/payments/payment-core.js';

export type SignatureTarget = Readonly<{ plan: PaymentPlan; message: MessageCandidate }>;
export type PayerSignature = Readonly<{ wallet: Address; signatureBytes: ReadonlyUint8Array }>;
export type SignedPayment = Readonly<{ transactionBytes: ReadonlyUint8Array; reference: string }>;
export type DiagnosticPayment = Readonly<{ transactionBytes: ReadonlyUint8Array; reference: string | null }>;

function snapshotTarget(target: SignatureTarget) {
  const messageBytes = Uint8Array.from(target.message.messageBytes);
  const transactionBytes = Uint8Array.from(target.message.transactionBytes);
  const transaction = getTransactionDecoder().decode(transactionBytes);
  const compiled = getCompiledTransactionMessageDecoder().decode(messageBytes);
  const wallets = target.plan.contributions.map(payer => payer.wallet);
  const feePayer = target.plan.feePayer;
  const signers = Object.keys(transaction.signatures);
  if (!equalBytes(messageBytes, transaction.messageBytes)
    || !equalBytes(transactionBytes, getTransactionEncoder().encode(transaction))
    || compiled.version !== 'legacy' || compiled.staticAccounts[0] !== feePayer
    || signers[0] !== feePayer || signers.length !== wallets.length
    || new Set(wallets).size !== wallets.length || !wallets.includes(feePayer)
    || signers.some(signer => !wallets.some(wallet => wallet === signer))
    || Object.values(transaction.signatures).some(signature => signature !== null)) {
    throw new Error('Invalid signature target');
  }
  return { messageBytes, transaction, wallets, feePayer };
}

function snapshotSignature(input: PayerSignature): PayerSignature {
  return { wallet: input.wallet, signatureBytes: Uint8Array.from(input.signatureBytes) };
}

function checkSignatures(target: ReturnType<typeof snapshotTarget>, inputs: readonly PayerSignature[], incomplete = false) {
  if ((!incomplete && inputs.length !== target.wallets.length)
    || new Set(inputs.map(input => input.wallet)).size !== inputs.length) throw new Error('Signatures incomplete');
  for (const input of inputs) {
    if (!target.wallets.includes(input.wallet) || input.signatureBytes.length !== 64
      || input.signatureBytes.every(byte => byte === 0)) throw new Error('Invalid signature');
  }
}

async function verifySignature(messageBytes: ReadonlyUint8Array, input: PayerSignature): Promise<PayerSignature> {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(getAddressEncoder().encode(input.wallet)).buffer, 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, Uint8Array.from(input.signatureBytes).buffer, Uint8Array.from(messageBytes).buffer)) {
    throw new Error('Invalid signature');
  }
  return input;
}

export async function verifyPayerSignature(target: SignatureTarget, input: PayerSignature): Promise<PayerSignature> {
  const snapshot = snapshotTarget(target);
  const signature = snapshotSignature(input);
  checkSignatures(snapshot, [signature], true);
  return verifySignature(snapshot.messageBytes, signature);
}

export async function verifyWalletSignature(target: SignatureTarget, wallet: Address, returned: ReadonlyUint8Array): Promise<PayerSignature> {
  const snapshot = snapshotTarget(target);
  const returnedBytes = Uint8Array.from(returned);
  const transaction = getTransactionDecoder().decode(returnedBytes);
  if (!equalBytes(transaction.messageBytes, snapshot.messageBytes)
    || !equalBytes(returnedBytes, getTransactionEncoder().encode(transaction))) throw new Error('Wallet changed transaction');
  for (const [signer, signature] of Object.entries(transaction.signatures)) {
    if (signer !== wallet && signature !== null && signature.some(byte => byte !== 0)) throw new Error('Unexpected signature slot');
  }
  const signature = transaction.signatures[wallet];
  if (!signature) throw new Error('Missing wallet signature');
  const input = snapshotSignature({ wallet, signatureBytes: signature });
  checkSignatures(snapshot, [input], true);
  return verifySignature(snapshot.messageBytes, input);
}

function assemble(target: ReturnType<typeof snapshotTarget>, inputs: readonly PayerSignature[]): DiagnosticPayment {
  const signatures = { ...target.transaction.signatures };
  for (const input of inputs) signatures[input.wallet] = signatureBytes(input.signatureBytes);
  const transactionBytes = Uint8Array.from(getTransactionEncoder().encode({ ...target.transaction, signatures }));
  const organizer = signatures[target.feePayer];
  return { transactionBytes, reference: organizer ? getBase58Decoder().decode(organizer) : null };
}

export async function assembleSignedPayment(target: SignatureTarget, inputs: readonly PayerSignature[]): Promise<SignedPayment> {
  const snapshot = snapshotTarget(target);
  const signatures = inputs.map(snapshotSignature);
  checkSignatures(snapshot, signatures);
  await Promise.all(signatures.map(signature => verifySignature(snapshot.messageBytes, signature)));
  const signed = assemble(snapshot, signatures);
  if (signed.reference === null) throw new Error('Missing organizer signature');
  return { transactionBytes: signed.transactionBytes, reference: signed.reference };
}

export function assembleTrustedSignatures(target: SignatureTarget, inputs: readonly PayerSignature[]): SignedPayment;
export function assembleTrustedSignatures(target: SignatureTarget, inputs: readonly PayerSignature[], options: { incompleteDiagnostic: true }): DiagnosticPayment;
export function assembleTrustedSignatures(target: SignatureTarget, inputs: readonly PayerSignature[], options?: { incompleteDiagnostic: true }): DiagnosticPayment {
  const snapshot = snapshotTarget(target);
  const signatures = inputs.map(snapshotSignature);
  checkSignatures(snapshot, signatures, options?.incompleteDiagnostic);
  return assemble(snapshot, signatures);
}
