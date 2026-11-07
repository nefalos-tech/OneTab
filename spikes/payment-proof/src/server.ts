import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { Coordinator } from './coordinator.js';

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type'] !== 'application/json') throw new Error('JSON required');
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 10_000) throw new Error('Request too large');
  }
  return JSON.parse(body);
}

export function startServer(options: { proof: Coordinator; port: number; distDirectory: string }) {
  const origin = `http://127.0.0.1:${options.port}`;
  const assets = new Map<string, { bytes: Buffer; type: string }>();
  const dist = resolve(options.distDirectory);
  for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = resolve(entry.parentPath, entry.name);
    const path = `/${relative(dist, absolute).split('\\').join('/')}`;
    if (!/\.(js|css|html)$/.test(path)) continue;
    assets.set(path === '/index.html' ? '/' : path, {
      bytes: readFileSync(absolute), type: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html',
    });
  }
  const send = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
      if (request.headers.host !== `127.0.0.1:${options.port}`) { send(response, 403, { error: 'HOST_MISMATCH' }); return; }
      const url = new URL(request.url ?? '/', origin);
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        if (!asset) throw new Error('Asset unavailable');
        response.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' }); response.end(asset.bytes); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/view') { send(response, 200, options.proof.view()); return; }
      if (request.headers.origin !== undefined && request.headers.origin !== origin) { send(response, 403, { error: 'ORIGIN_MISMATCH' }); return; }
      const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      if (!token) { send(response, 401, { error: 'CAPABILITY_REQUIRED' }); return; }
      let slot;
      try { slot = options.proof.role(token); } catch { send(response, 403, { error: 'INVALID_CAPABILITY' }); return; }
      if (request.method === 'GET' && url.pathname === '/api/payload') { send(response, 200, await options.proof.signingPayload()); return; }
      if (request.method !== 'POST' || request.headers.origin !== origin) { send(response, 403, { error: 'ORIGIN_REQUIRED' }); return; }
      const input = await readJson(request);
      switch (url.pathname) {
        case '/api/approval': send(response, 200, await options.proof.upload(slot, input)); return;
        case '/api/decline': send(response, 200, options.proof.decline()); return;
        case '/api/refresh': send(response, 200, await options.proof.refresh()); return;
        case '/api/simulate-first': send(response, 200, await options.proof.simulateFirstSignature()); return;
        case '/api/submit':
          if (slot !== 0) { send(response, 403, { error: 'ORGANIZER_REQUIRED' }); return; }
          send(response, 200, await options.proof.submit()); return;
        default: send(response, 404, { error: 'NOT_FOUND' });
      }
    })().catch(() => send(response, 400, { error: 'PROOF_REQUEST_REJECTED' }));
  });
  server.listen(options.port, '127.0.0.1');
  return server;
}
