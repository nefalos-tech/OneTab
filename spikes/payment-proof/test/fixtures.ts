import { randomBytes, randomUUID } from 'node:crypto';
import { getAddressDecoder, getAddressEncoder, getTransactionDecoder, getTransactionEncoder, signatureBytes } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  DEVNET_USDC, freezePayment, fromBase64, planSchema, toBase64,
  type FrozenPayment, type Slot, type Submission,
} from '../src/payment.js';
import type { Observation, ProofRpc, Simulation } from '../src/rpc.js';

export const randomAddress = () => getAddressDecoder().decode(randomBytes(32));

export async function syntheticFixture(total = '4000001') {
  const keys = await Promise.all([0, 1].map(() => crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])));
  const wallets = await Promise.all(keys.map(async key => getAddressDecoder().decode(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey)))));
  const plan = planSchema.parse({
    network: 'devnet', mint: DEVNET_USDC, decimals: 6, tokenProgram: TOKEN_PROGRAM_ADDRESS,
    sellerWallet: randomAddress(), sellerTokenAccount: randomAddress(), feePayer: wallets[0], total,
    contributions: wallets.map((wallet, slot) => ({
      slot, wallet, sourceTokenAccount: randomAddress(), units: String(BigInt(total) / 2n + (slot === 0 ? BigInt(total) % 2n : 0n)),
    })),
  });
  const payment = await freezePayment({ id: randomUUID(), plan, blockhash: randomAddress(), lastValidBlockHeight: '100' });
  async function approval(slot: Slot, source: FrozenPayment = payment) {
    const key = keys[slot];
    if (!key) throw new Error('Synthetic key missing');
    return { slot, messageHash: source.messageHash, signatureBase64: toBase64(new Uint8Array(await crypto.subtle.sign('Ed25519', key.privateKey, Uint8Array.from(fromBase64(source.messageBase64)).buffer))) };
  }
  async function walletReturn(slot: Slot, source: FrozenPayment = payment) {
    const signed = await approval(slot, source);
    const transaction = getTransactionDecoder().decode(fromBase64(source.transactionBase64));
    return Uint8Array.from(getTransactionEncoder().encode({ ...transaction, signatures: {
      ...transaction.signatures, [plan.contributions[slot].wallet]: signatureBytes(fromBase64(signed.signatureBase64)),
    } }));
  }
  return { payment, plan, keys, approval, walletReturn, publicKey: (slot: Slot) => Uint8Array.from(getAddressEncoder().encode(plan.contributions[slot].wallet)) };
}

export class FakeRpc implements ProofRpc {
  sends: Submission[] = [];
  observations: string[] = [];
  currentHeight = 50n;
  observation: Observation = { kind: 'unresolved', reason: 'awaiting_finalized_evidence' };
  sendError = false;
  differentReference = false;
  async prepare() { return { blockhash: randomAddress(), lastValidBlockHeight: '100' }; }
  async height() { return this.currentHeight; }
  async send(submission: Submission) {
    this.sends.push(submission);
    if (this.sendError) throw new Error('Synthetic dropped response');
    return this.differentReference ? randomAddress() : submission.reference;
  }
  async observe(_payment: FrozenPayment, submission: Submission) { this.observations.push(submission.reference); return this.observation; }
  async simulateIncomplete(): Promise<Simulation> { return { kind: 'signature_refused' }; }
  async checkFee() { return { feeLamports: '10000' }; }
}
