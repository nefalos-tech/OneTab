import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Coordinator } from './coordinator.js';
import { planSchema } from './payment.js';
import { DevnetRpc } from './rpc.js';
import { startServer } from './server.js';
import { prepareExperiment } from './setup.js';
import { ProofFailure } from './errors.js';
import { PaymentPreflightFailure } from '../../../src/server/payments/preflight.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  state: { type: 'string', default: './.private/proof.sqlite' }, config: { type: 'string' },
  port: { type: 'string', default: '4317' }, out: { type: 'string' },
} });
const port = z.coerce.number().int().min(1024).max(65535).parse(values.port);
const stateFile = resolve(values.state);
const rpc = new DevnetRpc(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com');
const proof = new Coordinator({ stateFile, rpc });

try {
  switch (positionals[0]) {
    case 'serve': {
      const server = startServer({ proof, port, distDirectory: resolve(dirname(fileURLToPath(import.meta.url)), '../dist') });
      process.stdout.write(`P1 loopback experiment at http://127.0.0.1:${port}\n`);
      const stop = () => server.close(() => { proof.close(); process.exit(0); });
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      break;
    }
    case 'prepare': {
      if (!values.config) throw new Error('--config required');
      const plan = planSchema.parse(JSON.parse(readFileSync(values.config, 'utf8')));
      await prepareExperiment({ proof, rpc, stateFile, plan, port });
      process.stdout.write('Immutable experiment retained. Verified private invitations are beside the SQLite file.\n');
      proof.close(); break;
    }
    case 'report': {
      const publicReport = JSON.stringify(proof.view(), null, 2) + '\n';
      if (values.out) writeFileSync(values.out, publicReport, { flag: 'wx' });
      else process.stdout.write(publicReport);
      proof.close(); break;
    }
    default: throw new Error('Use serve, prepare --config <path>, or report [--out <path>]');
  }
} catch (error) {
  proof.close();
  process.stderr.write(error instanceof ProofFailure || error instanceof PaymentPreflightFailure ? `${error.code}. ${error.message}\n` : error instanceof z.ZodError
    ? 'CONFIG_INVALID. Public plan or local command values are invalid.\n'
    : 'P1 command rejected. Check the command, private state directory, and public plan.\n');
  process.exitCode = 1;
}
