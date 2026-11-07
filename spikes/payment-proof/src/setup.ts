import { renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Coordinator } from './coordinator.js';
import { freezePayment, planBytes, equalBytes, type Plan } from './payment.js';
import { type ProofRpc } from './rpc.js';
import { ProofFailure } from './errors.js';

export async function prepareExperiment(options: {
  proof: Coordinator; rpc: ProofRpc; stateFile: string; plan: Plan; port: number;
  checkpoint?: (boundary: 'after_initialize') => void;
}): Promise<void> {
  if (options.proof.view().kind === 'unprepared') {
    const lifetime = await options.rpc.prepare(options.plan);
    const payment = await freezePayment({ id: randomUUID(), plan: options.plan, ...lifetime });
    await options.rpc.checkFee(payment);
    await options.proof.initialize(payment);
    options.checkpoint?.('after_initialize');
  }
  const payment = options.proof.payment();
  if (!equalBytes(planBytes(payment.plan), planBytes(options.plan))) throw new ProofFailure('IMMUTABLE_CONFLICT');
  const roles = options.proof.privateInvitations();
  const invitations = roles.map(role => ({ slot: role.slot, url: `http://127.0.0.1:${options.port}/#${new URLSearchParams({
    invite: JSON.stringify({ id: payment.id, slot: role.slot, capability: role.capability,
      plan: payment.plan, planHash: payment.planHash, messageHash: payment.messageHash }),
  })}` }));
  const invitationFile = `${options.stateFile}.invitations.json`;
  const temporary = `${invitationFile}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(invitations, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, invitationFile);
}
