import { appendFileSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { Coordinator } from '../src/coordinator.js';
import { approvalSchema, frozenSchema } from '../src/payment.js';
import { prepareExperiment } from '../src/setup.js';
import { FakeRpc } from './fixtures.js';

const [stateFile, fixtureFile, boundary] = process.argv.slice(2);
if (!stateFile || !fixtureFile || !boundary) throw new Error('Crash fixture arguments required');
const fixture = z.strictObject({ payment: frozenSchema, second: approvalSchema }).parse(JSON.parse(readFileSync(fixtureFile, 'utf8')));
const rpc = new FakeRpc();
const send = rpc.send.bind(rpc);
rpc.send = async submission => {
  appendFileSync(`${stateFile}.sends`, JSON.stringify({ reference: submission.reference, hash: submission.signedHash }) + '\n', { mode: 0o600 });
  if (boundary === 'after_send') process.kill(process.pid, 'SIGKILL');
  return send(submission);
};
const proof = new Coordinator({ stateFile, rpc, checkpoint: value => { if (value === boundary) process.kill(process.pid, 'SIGKILL'); } });
if (boundary === 'after_initialize') {
  await prepareExperiment({ proof, rpc, stateFile, plan: fixture.payment.plan, port: 4317,
    checkpoint: () => process.kill(process.pid, 'SIGKILL') });
} else if (boundary === 'before_submission_commit' || boundary === 'after_submission_commit') {
  await proof.upload(1, fixture.second);
} else { await proof.submit(); }
proof.close();
