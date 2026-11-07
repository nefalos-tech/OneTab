import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  approvalSchema, assembleSubmission, assembleVerifiedApprovals, frozenSchema, inspectPayment,
  verifyApproval, type Approval, type FrozenPayment, type Slot, type Submission,
} from './payment.js';
import { receiptSchema, type ProofRpc } from './rpc.js';
import { ProofFailure } from './errors.js';

const stateSchema = z.enum(['collecting', 'ready', 'submitting', 'unresolved', 'declined', 'failed', 'finalized']);
const experimentRow = z.object({ frozen: z.string(), state: stateSchema, reason: z.string().nullable(), receipt: z.string().nullable() });
const submissionRow = z.object({ reference: z.string(), signed: z.string(), hash: z.string(), dispatched: z.union([z.literal(0), z.literal(1)]) });
const approvalRow = z.object({ body: z.string() });
const roleRow = z.object({ slot: z.union([z.literal(0), z.literal(1)]) });
const hash = (input: string) => createHash('sha256').update(input).digest('hex');
export type Boundary = 'before_submission_commit' | 'after_submission_commit' | 'after_dispatch_claim' | 'after_send';
export const invitationsSchema = z.array(z.strictObject({ slot: z.union([z.literal(0), z.literal(1)]), capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }))
  .length(2).refine(values => new Set(values.map(value => value.slot)).size === 2);
export type RoleInvitation = z.infer<typeof invitationsSchema>[number];
export function newInvitations(): RoleInvitation[] {
  return ([0, 1] satisfies Slot[]).map(slot => ({ slot, capability: randomBytes(32).toString('base64url') }));
}

export class Coordinator {
  private readonly db: DatabaseSync;

  constructor(private readonly options: { stateFile: string; rpc: ProofRpc; checkpoint?: (boundary: Boundary) => void }) {
    process.umask(0o077);
    mkdirSync(dirname(options.stateFile), { recursive: true, mode: 0o700 });
    if ((statSync(dirname(options.stateFile)).mode & 0o077) !== 0) throw new Error('State requires a private dedicated directory');
    this.db = new DatabaseSync(options.stateFile);
    chmodSync(options.stateFile, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS experiment (
        id INTEGER PRIMARY KEY CHECK (id = 1), frozen TEXT NOT NULL,
        state TEXT NOT NULL, reason TEXT, receipt TEXT
      );
      CREATE TABLE IF NOT EXISTS approvals (
        slot INTEGER PRIMARY KEY CHECK (slot IN (0,1)), body TEXT NOT NULL, accepted TEXT NOT NULL,
        experiment INTEGER NOT NULL DEFAULT 1 REFERENCES experiment(id)
      );
      CREATE TABLE IF NOT EXISTS submission (
        id INTEGER PRIMARY KEY CHECK (id = 1), reference TEXT NOT NULL UNIQUE,
        signed TEXT NOT NULL, hash TEXT NOT NULL, dispatched INTEGER NOT NULL DEFAULT 0,
        experiment INTEGER NOT NULL DEFAULT 1 REFERENCES experiment(id)
      );
      CREATE TABLE IF NOT EXISTS capabilities (hash TEXT PRIMARY KEY, slot INTEGER NOT NULL UNIQUE CHECK (slot IN (0,1)), token TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, observed TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT);
      CREATE TRIGGER IF NOT EXISTS immutable_experiment BEFORE UPDATE OF frozen ON experiment BEGIN SELECT RAISE(ABORT, 'immutable message'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_approval BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT, 'immutable approval'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_submission BEFORE UPDATE OF reference,signed,hash ON submission BEGIN SELECT RAISE(ABORT, 'immutable submission'); END;
    `);
    const synchronous = this.db.prepare('PRAGMA synchronous').get();
    const journal = this.db.prepare('PRAGMA journal_mode').get();
    if (synchronous?.synchronous !== 2 || journal?.journal_mode !== 'delete') throw new Error('Unsafe SQLite settings');
  }

  close(): void { this.db.close(); }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  payment(): FrozenPayment {
    const row = experimentRow.parse(this.db.prepare('SELECT frozen,state,reason,receipt FROM experiment WHERE id=1').get());
    return frozenSchema.parse(JSON.parse(row.frozen));
  }

  async initialize(payment: FrozenPayment, roles: readonly RoleInvitation[] = newInvitations()): Promise<readonly RoleInvitation[]> {
    await inspectPayment(payment, { plan: payment.plan, planHash: payment.planHash, messageHash: payment.messageHash });
    const invitations = invitationsSchema.parse(roles);
    this.transaction(() => {
      if (this.db.prepare('SELECT id FROM experiment').get()) throw new Error('One immutable experiment already exists');
      this.db.prepare('INSERT INTO experiment(id,frozen,state) VALUES(1,?,?)').run(JSON.stringify(payment), 'collecting');
      for (const invitation of invitations) this.db.prepare('INSERT INTO capabilities(hash,slot,token) VALUES(?,?,?)').run(hash(invitation.capability), invitation.slot, invitation.capability);
    });
    return invitations;
  }

  role(capability: string): Slot {
    const row = roleRow.safeParse(this.db.prepare('SELECT slot FROM capabilities WHERE hash=?').get(hash(capability)));
    if (!row.success) throw new Error('Unauthorized local capability');
    return row.data.slot;
  }

  privateInvitations(): RoleInvitation[] {
    return invitationsSchema.parse(this.db.prepare('SELECT slot,token FROM capabilities ORDER BY slot').all().map(value => {
      const row = z.object({ slot: z.number(), token: z.string() }).parse(value);
      return { slot: row.slot, capability: row.token };
    }));
  }

  private approvals(): Approval[] {
    return this.db.prepare('SELECT body FROM approvals ORDER BY slot').all().map(row => approvalSchema.parse(JSON.parse(approvalRow.parse(row).body)));
  }

  private submission(): (Submission & { dispatched: boolean }) | null {
    const raw = this.db.prepare('SELECT reference,signed,hash,dispatched FROM submission WHERE id=1').get();
    if (!raw) return null;
    const row = submissionRow.parse(raw);
    return { reference: row.reference, signedBase64: row.signed, signedHash: row.hash, dispatched: row.dispatched === 1 };
  }

  view() {
    const raw = this.db.prepare('SELECT frozen,state,reason,receipt FROM experiment WHERE id=1').get();
    if (!raw) return { kind: 'unprepared' } as const;
    const row = experimentRow.parse(raw);
    const payment = frozenSchema.parse(JSON.parse(row.frozen));
    const approvedSlots = this.db.prepare('SELECT slot,accepted FROM approvals ORDER BY slot').all().map(value =>
      z.object({ slot: z.number(), accepted: z.string() }).parse(value));
    return {
      kind: 'experiment' as const, id: payment.id, plan: payment.plan, planHash: payment.planHash,
      messageHash: payment.messageHash, lastValidBlockHeight: payment.lastValidBlockHeight,
      transactionVersion: payment.version, state: row.state, reason: row.reason, approvedSlots,
      transactionReference: this.submission()?.reference ?? null,
      receipt: row.receipt ? receiptSchema.parse(JSON.parse(row.receipt)) : null,
      firstSignatureDiagnostic: this.db.prepare("SELECT kind,observed FROM observations WHERE kind IN ('signature_refused','inconclusive') ORDER BY id DESC LIMIT 1").get() ?? null,
    };
  }

  async upload(slot: Slot, input: unknown) {
    const payment = this.payment();
    const approval = await verifyApproval(payment, input);
    if (approval.slot !== slot) throw new Error('Wrong payer slot');
    const existing = this.approvals().find(value => value.slot === slot);
    if (existing) {
      if (existing.signatureBase64 !== approval.signatureBase64) throw new Error('Conflicting approval');
      return this.view();
    }
    await this.assertSignable();
    this.transaction(() => {
      const current = this.view();
      if (current.kind !== 'experiment') throw new Error('No experiment');
      const existing = this.approvals().find(value => value.slot === slot);
      if (existing) {
        if (existing.signatureBase64 !== approval.signatureBase64) throw new Error('Conflicting approval');
        return;
      }
      if (current.state !== 'collecting') throw new Error('Approval collection stopped');
      this.db.prepare('INSERT INTO approvals(slot,body,accepted) VALUES(?,?,?)').run(slot, JSON.stringify(approval), new Date().toISOString());
      const approvals = this.approvals();
      if (approvals.length === 2) {
        const submission = assembleVerifiedApprovals(payment, approvals);
        this.db.prepare('INSERT INTO submission(id,reference,signed,hash) VALUES(1,?,?,?)')
          .run(submission.reference, submission.signedBase64, hashBytes(submission.signedBase64));
        this.db.prepare('UPDATE experiment SET state=? WHERE id=1').run('ready');
        this.options.checkpoint?.('before_submission_commit');
      }
    });
    if (this.submission()) this.options.checkpoint?.('after_submission_commit');
    return this.view();
  }

  decline() {
    this.transaction(() => {
      const current = this.view();
      if (current.kind === 'experiment' && ['collecting', 'ready'].includes(current.state)) {
        this.db.prepare('UPDATE experiment SET state=?,reason=? WHERE id=1').run('declined', 'wallet_declined_authorizations_preserved');
      }
    });
    return this.view();
  }

  async simulateFirstSignature() {
    const payment = this.payment();
    const approvals = this.approvals();
    if (approvals.length !== 1) throw new Error('Diagnostic requires exactly one signature');
    const incomplete = assembleVerifiedApprovals(payment, approvals, true);
    const result = await this.options.rpc.simulateIncomplete(incomplete.signedBase64);
    this.db.prepare('INSERT INTO observations(observed,kind,reason) VALUES(?,?,?)')
      .run(new Date().toISOString(), result.kind, result.kind === 'inconclusive' ? result.reason : null);
    return result;
  }

  async refresh() {
    const submission = this.submission();
    const current = this.view();
    if (!submission || current.kind !== 'experiment' || ['finalized', 'failed'].includes(current.state)) return current;
    await this.verifyDurableSubmission(submission);
    try {
      const observation = await this.options.rpc.observe(this.payment(), submission);
      this.transaction(() => {
        const latest = this.view();
        if (latest.kind !== 'experiment' || ['finalized', 'failed'].includes(latest.state)) return;
        this.db.prepare('INSERT INTO observations(observed,kind,reason) VALUES(?,?,?)')
          .run(new Date().toISOString(), observation.kind, observation.kind === 'finalized' ? null : observation.reason);
        this.db.exec("DELETE FROM observations WHERE kind NOT IN ('signature_refused','inconclusive') AND id NOT IN (SELECT id FROM observations ORDER BY id DESC LIMIT 64)");
        if (observation.kind === 'finalized') {
          this.db.prepare('UPDATE experiment SET state=?,reason=NULL,receipt=? WHERE id=1').run('finalized', JSON.stringify(observation.receipt));
        } else if (observation.kind === 'failed' || submission.dispatched) {
          this.db.prepare('UPDATE experiment SET state=?,reason=? WHERE id=1').run(observation.kind, observation.reason);
        }
      });
    } catch { if (submission.dispatched) this.markUnresolved('rpc_observation_unavailable'); }
    return this.view();
  }

  private markUnresolved(reason: string): void {
    this.db.prepare("UPDATE experiment SET state='unresolved',reason=? WHERE id=1 AND state NOT IN ('finalized','failed','declined')").run(reason);
  }

  async submit() {
    let submission = this.submission();
    if (!submission) throw new Error('Signatures incomplete');
    await this.verifyDurableSubmission(submission);
    await this.refresh();
    const refreshed = this.view();
    submission = this.submission();
    if (!submission || submission.dispatched || refreshed.kind !== 'experiment' || refreshed.state !== 'ready') return refreshed;
    const height = await this.options.rpc.height();
    const shouldSend = this.transaction(() => {
      const current = this.view();
      submission = this.submission();
      if (!submission || submission.dispatched || current.kind !== 'experiment' || current.state !== 'ready') return false;
      if (height > BigInt(this.payment().lastValidBlockHeight)) { this.markUnresolved('lifetime_exceeded_no_finalized_evidence'); return false; }
      this.db.prepare('UPDATE submission SET dispatched=1 WHERE id=1').run();
      this.db.prepare('UPDATE experiment SET state=? WHERE id=1').run('submitting');
      return true;
    });
    if (!shouldSend) return this.view();
    this.options.checkpoint?.('after_dispatch_claim');
    const durable = this.submission();
    if (!durable) throw new Error('Durable submission missing');
    try {
      const returned = await this.options.rpc.send(durable);
      this.options.checkpoint?.('after_send');
      if (returned !== durable.reference) this.markUnresolved('rpc_returned_reference_mismatch');
    } catch { this.markUnresolved('send_response_unknown'); }
    return this.refresh();
  }

  async signingPayload(): Promise<FrozenPayment> {
    await this.assertSignable();
    const payment = this.payment();
    return inspectPayment(payment, payment);
  }

  private async assertSignable(): Promise<void> {
    const current = this.view();
    if (current.kind !== 'experiment' || current.state !== 'collecting') throw new Error('Approval collection stopped');
    if (await this.options.rpc.height() > BigInt(current.lastValidBlockHeight)) {
      this.markUnresolved('lifetime_exceeded_no_finalized_evidence');
      throw new ProofFailure('MESSAGE_EXPIRED');
    }
  }

  private async verifyDurableSubmission(submission: Submission): Promise<void> {
    const payment = this.payment();
    await inspectPayment(payment, payment);
    const rebuilt = await assembleSubmission(payment, this.approvals());
    if (submission.reference !== rebuilt.reference || submission.signedBase64 !== rebuilt.signedBase64
      || submission.signedHash !== rebuilt.signedHash) throw new Error('Stored submission integrity failure');
  }
}

function hashBytes(base64: string): string { return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex'); }
