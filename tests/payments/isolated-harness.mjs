import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const register = fileURLToPath(new URL("./register.mjs", import.meta.url));
const self = fileURLToPath(import.meta.url);
const requests = new AsyncLocalStorage();

if (!process.execArgv.some(argument => argument.includes("register.mjs"))) {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", register, self, ...process.argv.slice(2)], { stdio: "inherit" });
  child.on("exit", code => process.exit(code ?? 1));
} else if (process.argv.includes("--serve")) {
  await serve();
} else {
  await main();
}

function failTools(message) {
  console.error(message);
  console.error("PostgreSQL 16 bin directory: PG_BINDIR, or PG_BIN as that directory or its postgres binary.");
  console.error("PostgREST 16 binary: POSTGREST_BIN.");
  console.error("PG_SHAREDIR is the directory containing postgres.bki. initdb receives it with -L.");
  console.error("A relocated .../usr/lib/postgresql/16/bin uses sibling .../usr/share/postgresql/16.");
  console.error("Run with Node 24 from .nvmrc. Servers bind 127.0.0.1 and this process deletes only its temp directory and its own pids.");
  console.error("PG_BINDIR=/workspace/onetab-qa-tools/pg16-pgdg/usr/lib/postgresql/16/bin POSTGREST_BIN=/absolute/postgrest node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/payments/register.mjs ./tests/payments/isolated-harness.mjs");
  process.exit(2);
}

function captured(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function binDir() {
  const named = [process.env.PG_BINDIR, process.env.PG_BIN].filter(Boolean);
  const directories = named.map(value => {
    if (!existsSync(value)) return null;
    return statSync(value).isDirectory() ? value : dirname(value);
  });
  if (named.length > 0 && directories.some(value => value === null)) return null;
  if (directories.length === 2 && directories[0] !== directories[1]) failTools("PG_BINDIR and PG_BIN point at different directories.");
  return directories[0] ?? null;
}

function shareDir(directory) {
  if (process.env.PG_SHAREDIR) return process.env.PG_SHAREDIR;
  const parts = directory.split(sep);
  if (parts.at(-1) !== "bin" || parts.at(-3) !== "postgresql" || parts.at(-4) !== "lib") return null;
  const prefix = parts.slice(0, -4);
  if (directory.startsWith(sep)) prefix[0] = sep;
  return join(...prefix, "share", "postgresql", parts.at(-2));
}

function redact(text, secrets) {
  let value = text;
  for (const secret of secrets) if (secret) value = value.replaceAll(secret, "[redacted]");
  return value;
}

function freePort() {
  return new Promise(resolve => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function port() {
  for (;;) {
    const value = await freePort();
    if (value > 0 && value !== 5432) return value;
  }
}

function jwt(secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const body = `${header}.${payload}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function serve() {
  const { createPaymentHandlers } = await import("../../src/server/payments/http.ts");
  const { createPaymentRuntime } = await import("../../src/server/payments/runtime.ts");
  const { looksLikeAddress } = await import("../../src/client/contracts.ts");
  const port = Number(process.env.PAYMENTS_PORT);
  const origin = process.env.APP_ORIGIN;
  async function requireSession() {
    const request = requests.getStore();
    const token = request?.headers.get("cookie")?.match(/(?:^|;\s*)onetab_session=([^;]+)/)?.[1];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, code: "UNAUTHENTICATED" };
    const hash = createHash("sha256").update(Buffer.from(token, "base64url")).digest("hex");
    const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const key = process.env.SUPABASE_SECRET_KEY;
    const response = await fetch(`${url}/rest/v1/wallet_sessions?token_hash=eq.%5Cx${hash}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=wallet,expires_at`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!response.ok) return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
    const rows = await response.json();
    const wallet = Array.isArray(rows) && rows.length === 1 ? rows[0]?.wallet : null;
    return typeof wallet === "string" && looksLikeAddress(wallet)
      ? { ok: true, value: { wallet, expiresAt: String(rows[0].expires_at) } }
      : { ok: false, code: "UNAUTHENTICATED" };
  }
  const handlers = createPaymentHandlers({
    requireSession, originAllowed: request => request.headers.get("origin") === origin,
    service: () => createPaymentRuntime(),
  });
  const routes = [
    [/^\/api\/checkouts\/([^/]+)\/attempts$/, "prepare"],
    [/^\/api\/attempts\/([^/]+)\/signing-payload$/, "signingPayload"],
    [/^\/api\/attempts\/([^/]+)\/signatures$/, "addSignature"],
    [/^\/api\/attempts\/([^/]+)\/decline$/, "decline"],
    [/^\/api\/attempts\/([^/]+)\/submit$/, "submit"],
    [/^\/api\/attempts\/([^/]+)\/refresh$/, "refresh"],
  ];
  const server = createServer(async (incoming, outgoing) => {
    if (incoming.url === "/health") { outgoing.writeHead(200); outgoing.end("ok"); return; }
    const match = routes.map(([pattern, name]) => [incoming.url?.split("?")[0]?.match(pattern), name]).find(([found]) => found);
    if (!match || !origin) { outgoing.writeHead(404); outgoing.end(); return; }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    if (incoming.headers.origin) headers.set("origin", incoming.headers.origin);
    if (incoming.headers.cookie) headers.set("cookie", incoming.headers.cookie);
    if (incoming.headers["content-type"]) headers.set("content-type", incoming.headers["content-type"]);
    const request = new Request(`${origin}${incoming.url}`, { method: incoming.method, headers, body: incoming.method === "GET" || body.length === 0 ? undefined : body });
    const response = await requests.run(request, () => handlers[match[1]](request, match[0][1]));
    outgoing.writeHead(response.status, { "content-type": "application/json", "cache-control": "no-store" });
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(port, "127.0.0.1");
}

async function main() {
  if (!process.version.startsWith("v24.")) failTools(`Node ${process.version} at ${process.execPath} is not Node 24.`);
  const directory = binDir();
  const postgrestBin = process.env.POSTGREST_BIN;
  if (!directory || !postgrestBin || !existsSync(postgrestBin) || !statSync(postgrestBin).isFile()) failTools("PG_BINDIR/PG_BIN and POSTGREST_BIN are required.");
  const tools = ["postgres", "initdb", "pg_ctl", "psql", "createdb"].map(name => join(directory, name));
  if (tools.some(tool => !existsSync(tool))) failTools(`PostgreSQL 16 bin directory ${directory} is missing postgres, initdb, pg_ctl, psql, or createdb.`);
  const versions = {
    postgres: captured(tools[0], ["--version"]),
    initdb: captured(tools[1], ["--version"]),
    pgCtl: captured(tools[2], ["--version"]),
    postgrest: captured(postgrestBin, ["--version"]),
  };
  if (!versions.postgres.includes("PostgreSQL) 16.") || !versions.initdb.includes("PostgreSQL) 16.") || !versions.postgrest.includes("16.")) {
    failTools(`Need PostgreSQL 16 and PostgREST 16. Got ${JSON.stringify(versions)}.`);
  }
  const share = shareDir(directory);
  if (!share || !existsSync(join(share, "postgres.bki"))) failTools(`No postgres.bki for ${directory}. Set PG_SHAREDIR to the official share directory.`);
  const sha = captured("git", ["-C", root, "rev-parse", "HEAD"]);
  const dirty = captured("git", ["-C", root, "status", "--porcelain"]);
  console.log(JSON.stringify({ phase: "identity", sha, dirty: dirty.length > 0, execPath: process.execPath, node: process.version, ...versions, pgBinDir: directory, pgShareDir: share, postgrestBin }));
  const password = randomBytes(18).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const key = jwt(secret);
  const secrets = [password, secret, key];
  const dir = mkdtempSync(join(tmpdir(), "onetab-pay-"));
  const data = join(dir, "data");
  const sock = join(dir, "sock");
  const db = `pay${randomBytes(4).toString("hex")}`;
  const pids = [];
  const servers = [];
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const server of servers) { try { server.close(); } catch { /* already closed */ } }
    for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ } }
    if (existsSync(data)) spawnSync(tools[2], ["-D", data, "-m", "fast", "stop"], { timeout: 15000 });
    const pidFile = join(data, "postmaster.pid");
    if (existsSync(pidFile)) {
      const [pidLine, dataLine] = readFileSync(pidFile, "utf8").split("\n");
      const pid = Number(pidLine);
      if (dataLine === data && pid > 1) { try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ } }
    }
    rmSync(dir, { recursive: true, force: true });
  };
  process.on("SIGINT", () => { cleanup(); process.exit(1); });
  process.on("SIGTERM", () => { cleanup(); process.exit(1); });
  const show = text => console.error(redact(text, secrets).slice(-4000));
  try {
    if (data.startsWith("/var/lib/postgresql") || data.startsWith("/etc/postgresql")) throw new Error("refusing a system data directory");
    const initialized = spawnSync(tools[1], ["-D", data, "-L", share, "-U", "onetab", "--no-locale", "--encoding=UTF8", "--auth-local=trust", "--auth-host=scram-sha-256", "--no-sync"], { encoding: "utf8" });
    if (initialized.status !== 0) throw new Error(initialized.stderr || "initdb failed");
    mkdirSync(sock);
    const pgPort = String(await port());
    appendFileSync(join(data, "postgresql.conf"), `\nlisten_addresses = '127.0.0.1'\nport = ${pgPort}\nunix_socket_directories = '${sock}'\nunix_socket_permissions = '0700'\n`);
    const started = spawnSync(tools[2], ["-D", data, "-l", join(dir, "postgres.log"), "-w", "-t", "30", "start"], { encoding: "utf8" });
    if (started.status !== 0) throw new Error(`${started.stderr}\n${existsSync(join(dir, "postgres.log")) ? readFileSync(join(dir, "postgres.log"), "utf8") : ""}`);
    const psql = (database, statement) => {
      const result = spawnSync(tools[3], ["-h", sock, "-p", pgPort, "-U", "onetab", "-d", database, "-v", "ON_ERROR_STOP=1", "-t", "-A"], { input: statement, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || "psql failed");
      return result.stdout.trim();
    };
    const created = spawnSync(tools[3], ["-h", sock, "-p", pgPort, "-U", "onetab", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create database ${db}`], { encoding: "utf8" });
    if (created.status !== 0) throw new Error(created.stderr || created.stdout || "create database failed");
    psql(db, `create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator noinherit login password '${password}'; grant anon, authenticated, service_role to authenticator;`);
    for (const file of ["20261107000000_b1_schema.sql", "20261107010000_b2_auth.sql", "20261107020000_b3_rooms.sql", "20261108000000_b4_attempt_store.sql"]) {
      const applied = spawnSync(tools[3], ["-h", sock, "-p", pgPort, "-U", "onetab", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", join(root, "supabase/migrations", file)], { encoding: "utf8" });
      if (applied.status !== 0) throw new Error(`${file}\n${applied.stderr}`);
    }
    if (psql(db, "show port") !== pgPort) throw new Error("postgres did not keep the requested loopback port");
    const restPort = await port();
    const proxyPort = await port();
    const rpcPort = await port();
    const paymentsPort = await port();
    writeFileSync(join(dir, "postgrest.conf"), `db-uri = "postgresql://authenticator:${password}@127.0.0.1:${pgPort}/${db}"\ndb-schemas = "public"\ndb-anon-role = "anon"\ndb-config = false\ndb-channel-enabled = false\njwt-secret = "${secret}"\nserver-host = "127.0.0.1"\nserver-port = ${restPort}\nlog-level = "warn"\n`, { mode: 0o600 });
    const rest = spawn(postgrestBin, [join(dir, "postgrest.conf")], { stdio: ["ignore", "pipe", "pipe"] });
    pids.push(rest.pid);
    let restLog = "";
    rest.stderr.on("data", chunk => { restLog += chunk; });
    await wait(() => fetch(`http://127.0.0.1:${restPort}/`).then(() => true, () => false), "PostgREST did not listen", () => restLog);
    const proxy = createServer((incoming, outgoing) => {
      if (!incoming.url?.startsWith("/rest/v1/")) { outgoing.writeHead(404); outgoing.end(); return; }
      const upstream = createServerRequest(restPort, incoming);
      incoming.pipe(upstream);
      upstream.on("response", response => { outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing); });
    });
    servers.push(proxy);
    await listen(proxy, proxyPort);
    const { DEVNET_USDC } = await import("../../src/lib/payments/payment-core.ts");
    const { createCheckoutPaymentPlan, toBase64 } = await import("../../src/lib/payments/signing-payload.ts");
    const { DEVNET_GENESIS_HASH } = await import("../../src/server/payments/preflight.ts");
    const { getAddressDecoder, getBase58Decoder, getTransactionDecoder } = await import("@solana/kit");
    const { AccountState, TOKEN_PROGRAM_ADDRESS, getMintEncoder, getTokenEncoder } = await import("@solana-program/token");
    const organizer = await keyPair();
    const payer = await keyPair();
    const seller = await keyPair();
    const checkoutId = randomUUID();
    const room = roomFor(checkoutId, organizer.wallet, payer.wallet, seller.wallet, DEVNET_USDC);
    const plan = await createCheckoutPaymentPlan({ checkout: room.checkout, participants: room.participants, config: { network: "devnet", mint: DEVNET_USDC, tokenDecimals: 6, confirmationTarget: "finalized" } });
    const encoded = bytes => ({ value: { owner: TOKEN_PROGRAM_ADDRESS, executable: false, data: [toBase64(bytes), "base64"] } });
    const accounts = new Map([[plan.mint, encoded(getMintEncoder().encode({ mintAuthority: null, supply: 100n, decimals: 6, isInitialized: true, freezeAuthority: null }))]]);
    for (const account of [...plan.contributions.map(entry => ({ wallet: entry.wallet, token: entry.sourceTokenAccount })), { wallet: plan.sellerWallet, token: plan.sellerTokenAccount }]) {
      accounts.set(account.token, encoded(getTokenEncoder().encode({ mint: plan.mint, owner: account.wallet, amount: 100n, delegate: null, state: AccountState.Initialized, isNative: null, delegatedAmount: 0n, closeAuthority: null })));
    }
    const calls = [];
    const rpcNotes = [];
    const sent = [];
    let restarted = false;
    const note = (method, detail = {}) => {
      calls.push(method);
      rpcNotes.push({ phase: restarted ? "after-restart" : "before-restart", method, ...detail });
    };
    const sha256Base64 = value => createHash("sha256").update(Buffer.from(value, "base64")).digest("hex");
    const latestBlockhash = getAddressDecoder().decode(new Uint8Array(32).fill(7));
    const rpc = createServer(async (incoming, outgoing) => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      let result;
      let detail = {};
      if (body.method === "getGenesisHash") result = DEVNET_GENESIS_HASH;
      else if (body.method === "getBalance") result = { value: 15000 };
      else if (body.method === "getFeeForMessage") result = { value: 15000 };
      else if (body.method === "getLatestBlockhash") result = { value: { blockhash: latestBlockhash, lastValidBlockHeight: 100 } };
      else if (body.method === "getAccountInfo") result = accounts.get(String(body.params?.[0])) ?? { value: null };
      else if (body.method === "getEpochInfo") result = { absoluteSlot: 10, blockHeight: 10 };
      else if (body.method === "getBlockHeight") result = 90;
      else if (body.method === "getSignatureStatuses") {
        const status = { context: { slot: 1 }, value: [null] };
        if (status.value[0]?.confirmationStatus === "finalized") throw new Error("finalized status before replacement send");
        detail = { status: "absent" };
        result = status;
      } else if (body.method === "getTransaction") {
        note(body.method, { status: "finalized-read" });
        outgoing.writeHead(200, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "finalized read is outside this absence flow" } }));
        return;
      }
      else if (body.method === "sendTransaction") {
        const bytes = String(body.params?.[0]);
        sent.push(bytes);
        detail = { sha256: sha256Base64(bytes), byteLength: Buffer.from(bytes, "base64").length };
        const transaction = getTransactionDecoder().decode(Uint8Array.from(Buffer.from(bytes, "base64")));
        const signature = transaction.signatures[organizer.wallet];
        result = signature ? getBase58Decoder().decode(signature) : null;
      } else { outgoing.writeHead(200, { "content-type": "application/json" }); outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: body.method } })); return; }
      note(body.method, detail);
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    });
    servers.push(rpc);
    await listen(rpc, rpcPort);
    psql(db, `select public.create_checkout('${checkoutId}'::uuid, '${randomUUID()}'::uuid, 'Harness checkout'::text, '${organizer.wallet}'::text, '${seller.wallet}'::text, 10::numeric, 2::smallint, 'devnet'::text, '${DEVNET_USDC}'::text, 6::smallint); select public.join_checkout('${checkoutId}'::uuid, '${payer.wallet}'::text); select public.set_checkout_readiness('${checkoutId}'::uuid, '${organizer.wallet}'::text, true); select public.set_checkout_readiness('${checkoutId}'::uuid, '${payer.wallet}'::text, true);`);
    const organizerCookie = session(psql, db, organizer.wallet);
    const payerCookie = session(psql, db, payer.wallet);
    const paymentsEnv = {
      ...process.env, APP_ORIGIN: `http://127.0.0.1:${paymentsPort}`, PAYMENTS_PORT: String(paymentsPort),
      SUPABASE_URL: `http://127.0.0.1:${proxyPort}`, SUPABASE_SECRET_KEY: key, SOLANA_RPC_URL: `http://127.0.0.1:${rpcPort}`,
      SOLANA_CLUSTER: "devnet", USDC_MINT: DEVNET_USDC, USDC_DECIMALS: "6",
    };
    let paymentsLog = "";
    const startPayments = () => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", register, self, "--serve"], { env: paymentsEnv, stdio: ["ignore", "pipe", "pipe"] });
      pids.push(child.pid);
      child.stderr.on("data", chunk => { paymentsLog += chunk; });
      child.stdout.on("data", chunk => { paymentsLog += chunk; });
      return child;
    };
    let payments = startPayments();
    await wait(() => fetch(`http://127.0.0.1:${paymentsPort}/health`).then(response => response.ok, () => false), "Payments process did not listen", () => paymentsLog);
    const call = (cookie, pathname, body) => fetch(`http://127.0.0.1:${paymentsPort}${pathname}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin: paymentsEnv.APP_ORIGIN, cookie: `onetab_session=${cookie}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async response => ({ status: response.status, json: await response.json() }));
    const prepared = await Promise.all([call(organizerCookie, `/api/checkouts/${checkoutId}/attempts`, {}), call(organizerCookie, `/api/checkouts/${checkoutId}/attempts`, {})]);
    if (prepared.some(item => item.status !== 200) || new Set(prepared.map(item => item.json.data?.id)).size !== 1) throw new Error(`prepare ${JSON.stringify(prepared)} calls ${calls.join(",")}`);
    const attemptId = prepared[0].json.data.id;
    if (psql(db, `select count(*) from public.attempts where checkout_id='${checkoutId}'`) !== "1") throw new Error("prepare did not leave one attempt");
    if (calls.filter(method => method === "getLatestBlockhash").length !== 1) throw new Error(`blockhash reads ${calls.filter(method => method === "getLatestBlockhash").length}`);
    const payload = await call(organizerCookie, `/api/attempts/${attemptId}/signing-payload`);
    if (payload.status !== 200) throw new Error(`payload ${JSON.stringify(payload)}`);
    const signedBy = async account => ({ messageHash: payload.json.data.messageHash, signatureBase64: Buffer.from(await crypto.subtle.sign("Ed25519", account.keys.privateKey, Uint8Array.from(Buffer.from(payload.json.data.messageBase64, "base64")))).toString("base64") });
    const [organizerSignature, payerSignature] = await Promise.all([signedBy(organizer), signedBy(payer)]);
    const raced = await Promise.all([
      call(organizerCookie, `/api/attempts/${attemptId}/signatures`, organizerSignature),
      call(payerCookie, `/api/attempts/${attemptId}/signatures`, payerSignature),
      call(organizerCookie, `/api/attempts/${attemptId}/submit`, {}),
      call(payerCookie, `/api/attempts/${attemptId}/submit`, {}),
    ]);
    if (raced.some(item => item.status !== 200)) throw new Error(`signature or submit ${JSON.stringify(raced)}`);
    if (psql(db, `select count(*) from public.submissions where attempt_id='${attemptId}'`) !== "1") throw new Error("submission was not a single row");
    const stored = psql(db, `select replace(encode(message_bytes,'base64'), chr(10), '') || ' ' || replace(encode(transaction_bytes,'base64'), chr(10), '') from public.attempts where id='${attemptId}'`);
    const submitted = psql(db, `select replace(encode(transaction_bytes,'base64'), chr(10), '') from public.submissions where attempt_id='${attemptId}'`);
    const [storedMessage, storedTransaction] = stored.split(" ");
    if (storedMessage !== payload.json.data.messageBase64 || storedTransaction !== payload.json.data.transactionBase64) throw new Error("frozen SQL bytes differ from the signing payload");
    if (!sent.includes(submitted)) throw new Error(`submission bytes were not sent calls=${calls.join(",")} sent=${sent.length} storedSha=${sha256Base64(submitted)} sentSha=${sent[0] ? sha256Base64(sent[0]) : "none"}`);
    const referenceBefore = psql(db, `select transaction_reference from public.submissions where attempt_id='${attemptId}'`);
    const beforeRestart = calls.filter(method => method === "getLatestBlockhash").length;
    const firstPid = payments.pid;
    process.kill(firstPid, "SIGTERM");
    await new Promise(resolve => payments.on("exit", resolve));
    pids.splice(pids.indexOf(firstPid), 1);
    const sentBeforeRestart = sent.length;
    const callsBeforeRestart = calls.length;
    console.log(JSON.stringify({
      phase: "boundary", name: "before-restart", pid: firstPid, sendCount: sentBeforeRestart,
      submissionSha256: sha256Base64(submitted), attemptId,
    }));
    restarted = true;
    payments = startPayments();
    await wait(() => fetch(`http://127.0.0.1:${paymentsPort}/health`).then(response => response.ok, () => false), "Restarted payments process did not listen", () => paymentsLog);
    if (!(payments.pid > 1) || payments.pid === firstPid) throw new Error(`payments pid ${firstPid} did not change`);
    const resumed = await call(organizerCookie, `/api/attempts/${attemptId}/refresh`, {});
    const after = psql(db, `select replace(encode(message_bytes,'base64'), chr(10), '') || ' ' || replace(encode(transaction_bytes,'base64'), chr(10), '') from public.attempts where id='${attemptId}'`);
    const submittedAfter = psql(db, `select replace(encode(transaction_bytes,'base64'), chr(10), '') from public.submissions where attempt_id='${attemptId}'`);
    const referenceAfter = psql(db, `select transaction_reference from public.submissions where attempt_id='${attemptId}'`);
    const resent = sent.slice(sentBeforeRestart);
    const beforeSend = rpcNotes.slice(callsBeforeRestart, callsBeforeRestart + Math.max(0, rpcNotes.slice(callsBeforeRestart).findIndex(entry => entry.method === "sendTransaction")));
    const statusBeforeSend = beforeSend.filter(entry => entry.method === "getSignatureStatuses");
    const referenceOf = bytes => {
      const transaction = getTransactionDecoder().decode(Uint8Array.from(Buffer.from(bytes, "base64")));
      const signature = transaction.signatures[organizer.wallet];
      return signature ? getBase58Decoder().decode(signature) : "";
    };
    if (statusBeforeSend.length < 1 || statusBeforeSend.some(entry => entry.status !== "absent") || beforeSend.some(entry => entry.method === "getTransaction")) {
      throw new Error(`replacement status before send ${beforeSend.map(entry => `${entry.method}:${entry.status ?? ""}`).join(",")}`);
    }
    if (resumed.status !== 200 || resumed.json.data?.id !== attemptId || resumed.json.data?.transactionReference !== referenceBefore || after !== stored || submittedAfter !== submitted || referenceAfter !== referenceBefore) {
      throw new Error(`restart identity status=${resumed.status} state=${resumed.json.data?.state ?? ""} attempt=${resumed.json.data?.id === attemptId} bytes=${after === stored && submittedAfter === submitted} reference=${referenceAfter === referenceBefore}`);
    }
    if (resent.length < 1 || resent.some(bytes => bytes !== submittedAfter) || resent.some(bytes => referenceOf(bytes) !== referenceBefore)) {
      throw new Error(`post-restart send count ${resent.length} sha ${resent.map(sha256Base64).join(",") || "none"} stored ${sha256Base64(submittedAfter)}`);
    }
    if (calls.filter(method => method === "getLatestBlockhash").length !== beforeRestart) throw new Error("restart rebuilt the blockhash");
    console.log(JSON.stringify({
      phase: "boundary", name: "after-restart", previousPid: firstPid, pid: payments.pid,
      postRestartSendCount: resent.length, submissionSha256: sha256Base64(submittedAfter),
      postRestartSendSha256: resent.map(sha256Base64), attemptId,
      statusBeforeSend: statusBeforeSend.map(entry => entry.status),
    }));
    const declineCheckout = randomUUID();
    psql(db, `select public.create_checkout('${declineCheckout}'::uuid, '${randomUUID()}'::uuid, 'Decline checkout'::text, '${organizer.wallet}'::text, '${seller.wallet}'::text, 10::numeric, 2::smallint, 'devnet'::text, '${DEVNET_USDC}'::text, 6::smallint); select public.join_checkout('${declineCheckout}'::uuid, '${payer.wallet}'::text); select public.set_checkout_readiness('${declineCheckout}'::uuid, '${organizer.wallet}'::text, true); select public.set_checkout_readiness('${declineCheckout}'::uuid, '${payer.wallet}'::text, true);`);
    const declinedId = psql(db, `select public.reserve_attempt('${declineCheckout}'::uuid, '${organizer.wallet}'::text, null::uuid)->>'id'`);
    const blockhashBeforeDecline = calls.filter(method => method === "getLatestBlockhash").length;
    const declined = await call(organizerCookie, `/api/attempts/${declinedId}/decline`, {});
    if (declined.status !== 200 || declined.json.data?.state !== "failed" || declined.json.data?.canRetry !== true) throw new Error(`decline ${JSON.stringify(declined)}`);
    if (psql(db, `select state || ' ' || safely_resolved::text || ' ' || (message_bytes is null)::text from public.attempts where id='${declinedId}'`) !== "failed true true") throw new Error("pre-freeze decline did not close the unused attempt");
    if (calls.filter(method => method === "getLatestBlockhash").length !== blockhashBeforeDecline) throw new Error("unused decline read a blockhash");
    const replacement = await call(organizerCookie, `/api/checkouts/${declineCheckout}/attempts`, { retryOfAttemptId: declinedId });
    if (replacement.status !== 200 || replacement.json.data?.id === declinedId) throw new Error(`retry ${JSON.stringify(replacement)}`);
    const rejected = await call(organizerCookie, `/api/attempts/${replacement.json.data.id}/signatures`, { messageHash: "ab".repeat(32), signatureBase64: `${"A".repeat(86)}==` });
    if (rejected.status !== 400 || rejected.json.error?.code !== "MESSAGE_MISMATCH") throw new Error(`old signature ${JSON.stringify(rejected)}`);
    if (psql(db, `select count(*) from public.signatures where attempt_id='${replacement.json.data.id}'`) !== "0") throw new Error("rejected signature was stored");
    console.log(JSON.stringify({
      phase: "result", kind: "local-integration", chainProof: false, independentQa: false,
      sha, dirty: dirty.length > 0, execPath: process.execPath, node: process.version,
      postgres: versions.postgres, postgrest: versions.postgrest, pgBinDir: directory, pgShareDir: share,
      attempts: 1, submissions: 1, blockhashReadsBeforeRestart: beforeRestart, sendCount: sent.length,
      postRestartSendCount: resent.length, previousPid: firstPid, resumedPid: payments.pid,
      postRestartBytesEqual: resent.length > 0 && resent.every(bytes => bytes === submittedAfter),
      sameAttempt: resumed.json.data?.id === attemptId, sameTransactionReference: referenceAfter === referenceBefore,
      bytesStable: true, restartPidChanged: payments.pid !== firstPid, prefreezeClosed: true, oldSignatureRejected: true,
    }));
  } catch (error) {
    show(error instanceof Error ? `${error.message}\n${existsSync(join(dir, "postgres.log")) ? readFileSync(join(dir, "postgres.log"), "utf8") : ""}` : String(error));
    cleanup();
    process.exit(1);
  }
  cleanup();
  process.exit(0);
}

function roomFor(id, organizer, payer, seller, mint) {
  return { checkout: { id, title: "Harness checkout", organizerWallet: organizer, sellerWallet: seller, network: "devnet", mint, tokenDecimals: 6, totalUnits: "10", payerCount: 2, createdAt: "2026-11-08T00:00:00.000Z" },
    participants: [{ slot: 0, wallet: organizer, shareUnits: "5", ready: true }, { slot: 1, wallet: payer, shareUnits: "5", ready: true }] };
}

async function keyPair() {
  const { getAddressDecoder } = await import("@solana/kit");
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  return { keys, wallet: getAddressDecoder().decode(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey))) };
}

function session(psql, db, wallet) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(Buffer.from(token, "base64url")).digest("hex");
  psql(db, `insert into public.wallet_sessions(token_hash, wallet, expires_at) values (decode('${hash}', 'hex'), '${wallet}', now() + interval '2 hours');`);
  return token;
}

function createServerRequest(port, incoming) {
  return httpRequest({ host: "127.0.0.1", port, method: incoming.method, path: incoming.url.slice("/rest/v1".length), headers: { ...incoming.headers, host: `127.0.0.1:${port}` } });
}

function listen(server, port) {
  return new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
}

async function wait(ready, message, detail) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await ready()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${message}\n${detail()}`);
}
