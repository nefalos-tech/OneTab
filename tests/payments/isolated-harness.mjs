import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  return value.replace(/[1-9A-HJ-NP-Za-km-z]{64,88}/g, "[redacted]");
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
  const migrations = reviewedMigrations();
  console.log(JSON.stringify({ phase: "identity", sha, dirty: dirty.length > 0, execPath: process.execPath, node: process.version, ...versions, pgBinDir: directory, pgShareDir: share, postgrestBin, migrations }));
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
    for (const file of migrations) {
      const applied = spawnSync(tools[3], ["-h", sock, "-p", pgPort, "-U", "onetab", "-d", db, "-v", "ON_ERROR_STOP=1", "-1", "-f", join(root, "supabase/migrations", file)], { encoding: "utf8" });
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
    const { getAddressDecoder, getBase58Decoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } = await import("@solana/kit");
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
    let rpcPhase = "before-restart";
    const scenario = { holdBeforeSend: false, holdAttempt: "", dropSend: false, finalized: null, finalizedReference: "", releaseHold: null };
    const note = (method, detail = {}) => {
      calls.push(method);
      rpcNotes.push({ phase: rpcPhase, method, ...detail });
    };
    const sha256Base64 = value => createHash("sha256").update(Buffer.from(value, "base64")).digest("hex");
    let blockhashNonce = 7;
    const nextBlockhash = () => {
      const bytes = new Uint8Array(32).fill(7);
      bytes[31] = blockhashNonce;
      blockhashNonce += 1;
      return getAddressDecoder().decode(bytes);
    };
    const finalizedTransaction = bytes => {
      const transaction = getTransactionDecoder().decode(Uint8Array.from(Buffer.from(bytes, "base64")));
      const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
      const rows = [
        ...plan.contributions.map(entry => ({ token: entry.sourceTokenAccount, wallet: entry.wallet, before: 100n, after: 100n - entry.units })),
        { token: plan.sellerTokenAccount, wallet: plan.sellerWallet, before: 200n, after: 200n + plan.totalUnits },
      ];
      const balances = stage => rows.map(account => {
        const accountIndex = message.staticAccounts.indexOf(account.token);
        if (accountIndex < 0) throw new Error("token account missing from the signed message");
        return { accountIndex, mint: plan.mint, owner: account.wallet, uiTokenAmount: { amount: String(account[stage]), decimals: plan.decimals } };
      });
      const fee = 5000 * plan.contributions.length;
      return { slot: 500, transaction: [bytes, "base64"], meta: {
        err: null, fee, preBalances: message.staticAccounts.map(() => 1000000),
        postBalances: message.staticAccounts.map((_, index) => index === 0 ? 1000000 - fee : 1000000),
        preTokenBalances: balances("before"), postTokenBalances: balances("after"),
      } };
    };
    const latestBlockhash = nextBlockhash;
    const rpc = createServer(async (incoming, outgoing) => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (scenario.holdBeforeSend && scenario.holdAttempt && psql(db, `select count(*) from public.submissions where attempt_id='${scenario.holdAttempt}'`) === "1") {
        incoming.on("error", () => {});
        outgoing.on("error", () => {});
        scenario.releaseHold?.();
        await new Promise(() => {});
      }
      let result;
      let detail = {};
      if (body.method === "getGenesisHash") result = DEVNET_GENESIS_HASH;
      else if (body.method === "getBalance") result = { value: 15000 };
      else if (body.method === "getFeeForMessage") result = { value: 15000 };
      else if (body.method === "getLatestBlockhash") result = { value: { blockhash: latestBlockhash(), lastValidBlockHeight: 100 } };
      else if (body.method === "getAccountInfo") result = accounts.get(String(body.params?.[0])) ?? { value: null };
      else if (body.method === "getEpochInfo") result = { absoluteSlot: 10, blockHeight: 10 };
      else if (body.method === "getBlockHeight") result = 90;
      else if (body.method === "getSignatureStatuses") {
        const requested = String(body.params?.[0]?.[0] ?? "");
        const visible = Boolean(scenario.finalized) && requested === scenario.finalizedReference;
        const status = visible
          ? { context: { slot: 520 }, value: [{ slot: 500, confirmationStatus: "finalized", err: null }] }
          : { context: { slot: 1 }, value: [null] };
        detail = { status: visible ? "finalized" : "absent" };
        result = status;
      } else if (body.method === "getTransaction") {
        const requested = String(body.params?.[0] ?? "");
        if (!scenario.finalized || requested !== scenario.finalizedReference) {
          note(body.method, { status: "finalized-read" });
          outgoing.writeHead(200, { "content-type": "application/json" });
          outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "finalized read is outside this absence flow" } }));
          return;
        }
        detail = { status: "finalized" };
        result = scenario.finalized;
      }
      else if (body.method === "sendTransaction") {
        const bytes = String(body.params?.[0]);
        sent.push(bytes);
        const transaction = getTransactionDecoder().decode(Uint8Array.from(Buffer.from(bytes, "base64")));
        const signature = transaction.signatures[organizer.wallet];
        const reference = signature ? getBase58Decoder().decode(signature) : "";
        if (scenario.dropSend) {
          scenario.dropSend = false;
          scenario.finalized = finalizedTransaction(bytes);
          scenario.finalizedReference = reference;
          note(body.method, { sha256: sha256Base64(bytes), byteLength: Buffer.from(bytes, "base64").length, response: "dropped" });
          outgoing.destroy();
          return;
        }
        detail = { sha256: sha256Base64(bytes), byteLength: Buffer.from(bytes, "base64").length };
        result = reference || null;
      } else { outgoing.writeHead(200, { "content-type": "application/json" }); outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: body.method } })); return; }
      note(body.method, detail);
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    });
    rpc.on("clientError", () => {});
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
    rpcPhase = "after-restart";
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
    const resumedPid = payments.pid;
    const openReadyCheckout = title => {
      const id = randomUUID();
      psql(db, `select public.create_checkout('${id}'::uuid, '${randomUUID()}'::uuid, '${title}'::text, '${organizer.wallet}'::text, '${seller.wallet}'::text, 10::numeric, 2::smallint, 'devnet'::text, '${DEVNET_USDC}'::text, 6::smallint); select public.join_checkout('${id}'::uuid, '${payer.wallet}'::text); select public.set_checkout_readiness('${id}'::uuid, '${organizer.wallet}'::text, true); select public.set_checkout_readiness('${id}'::uuid, '${payer.wallet}'::text, true);`);
      return id;
    };
    const attemptSignatures = async id => {
      const prepared = await call(organizerCookie, `/api/checkouts/${id}/attempts`, {});
      if (prepared.status !== 200 || !prepared.json.data?.id) throw new Error(`scenario prepare ${prepared.status}`);
      const payload = await call(organizerCookie, `/api/attempts/${prepared.json.data.id}/signing-payload`);
      if (payload.status !== 200) throw new Error(`scenario payload ${payload.status}`);
      const sign = async account => Buffer.from(await crypto.subtle.sign("Ed25519", account.keys.privateKey, Uint8Array.from(Buffer.from(payload.json.data.messageBase64, "base64")))).toString("base64");
      return { attemptId: prepared.json.data.id, messageHash: payload.json.data.messageHash, organizerSignature: await sign(organizer), payerSignature: await sign(payer) };
    };
    const submissionBytes = id => psql(db, `select replace(encode(transaction_bytes,'base64'), chr(10), '') from public.submissions where attempt_id='${id}'`);
    const submissionReference = id => psql(db, `select transaction_reference from public.submissions where attempt_id='${id}'`);
    const waitForLease = async (id, expected) => {
      const started = Date.now();
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const row = psql(db, `select state || ' ' || (submission_expires_at is null)::text || ' ' || coalesce((submission_expires_at <= clock_timestamp())::text, 'false') from public.attempts where id='${id}'`);
        const [state, cleared, expired] = row.split(" ");
        if (expected === "cleared" && state === "unresolved" && cleared === "true") return Date.now() - started;
        if (expected === "expired" && state === "submitting" && cleared === "false" && expired === "true") return Date.now() - started;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error(`lease did not become ${expected}`);
    };
    rpcPhase = "lost-response";
    const lostCheckout = openReadyCheckout("Lost response");
    const lost = await attemptSignatures(lostCheckout);
    const lostBlockhash = calls.filter(method => method === "getLatestBlockhash").length;
    const lostOrganizer = await call(organizerCookie, `/api/attempts/${lost.attemptId}/signatures`, { messageHash: lost.messageHash, signatureBase64: lost.organizerSignature });
    if (lostOrganizer.status !== 200) throw new Error(`lost organizer signature ${lostOrganizer.status}`);
    const sendsBeforeDrop = sent.length;
    scenario.dropSend = true;
    const lostSubmit = await call(payerCookie, `/api/attempts/${lost.attemptId}/signatures`, { messageHash: lost.messageHash, signatureBase64: lost.payerSignature });
    const lostStored = submissionBytes(lost.attemptId);
    const lostReference = submissionReference(lost.attemptId);
    const dropped = sent.slice(sendsBeforeDrop);
    if (lostSubmit.status !== 200 || lostSubmit.json.data?.state !== "unresolved" || lostSubmit.json.data?.error?.code !== "RPC_UNAVAILABLE" || dropped.length !== 1 || dropped[0] !== lostStored || referenceOf(dropped[0]) !== lostReference) {
      throw new Error(`dropped broadcast status=${lostSubmit.status} state=${lostSubmit.json.data?.state ?? ""} error=${lostSubmit.json.data?.error?.code ?? ""} sends=${dropped.length} sha=${dropped[0] ? sha256Base64(dropped[0]) : "none"} stored=${lostStored ? sha256Base64(lostStored) : "none"}`);
    }
    const blocked = await call(organizerCookie, `/api/checkouts/${lostCheckout}/attempts`, { retryOfAttemptId: lost.attemptId });
    if (blocked.status !== 409 || blocked.json.error?.code !== "RETRY_BLOCKED") throw new Error(`lost response replacement ${blocked.status} ${blocked.json.error?.code ?? ""}`);
    if (psql(db, `select count(*) from public.attempts where checkout_id='${lostCheckout}'`) !== "1") throw new Error("lost response created another attempt");
    const lostLeaseMs = await waitForLease(lost.attemptId, "cleared");
    console.log(JSON.stringify({
      phase: "boundary", name: "broadcast-dropped", pid: payments.pid, sendCountBefore: sendsBeforeDrop,
      droppedSendCount: dropped.length, submissionSha256: sha256Base64(lostStored), response: "dropped",
      leaseClaimable: "outcome-cleared", leaseWaitMs: lostLeaseMs, attemptId: lost.attemptId,
    }));
    const lostRefresh = await call(organizerCookie, `/api/attempts/${lost.attemptId}/refresh`, {});
    const lostReceipt = psql(db, `select r.confirmation_status || ' ' || (r.transaction_reference = s.transaction_reference)::text from public.receipts r join public.submissions s on s.attempt_id=r.attempt_id where r.attempt_id='${lost.attemptId}'`);
    const lostAfter = submissionBytes(lost.attemptId);
    const lostReferenceAfter = submissionReference(lost.attemptId);
    if (lostRefresh.status !== 200 || lostRefresh.json.data?.state !== "confirmed" || lostRefresh.json.data?.id !== lost.attemptId || lostRefresh.json.data?.transactionReference !== lostReference || lostRefresh.json.data?.receipt?.transactionReference !== lostReference || lostRefresh.json.data?.receipt?.confirmationStatus !== "finalized" || lostReceipt !== "finalized true" || lostAfter !== lostStored || lostReferenceAfter !== lostReference || sent.length - sendsBeforeDrop !== 1) {
      throw new Error(`same receipt state=${lostRefresh.json.data?.state ?? ""} sends=${sent.length - sendsBeforeDrop} receipt=${lostReceipt} bytes=${lostAfter === lostStored}`);
    }
    const lostAgain = await call(payerCookie, `/api/attempts/${lost.attemptId}/refresh`, {});
    if (lostAgain.status !== 200 || lostAgain.json.data?.receipt?.transactionReference !== lostReference || sent.length - sendsBeforeDrop !== 1) throw new Error("second refresh changed the receipt or sent again");
    if (calls.filter(method => method === "getLatestBlockhash").length !== lostBlockhash) throw new Error("lost response rebuilt the blockhash");
    const lostLaterSends = sent.length - sendsBeforeDrop - dropped.length;
    console.log(JSON.stringify({
      phase: "boundary", name: "same-receipt", pid: payments.pid, droppedSendCount: dropped.length, laterSendCount: lostLaterSends,
      submissionSha256: sha256Base64(lostAfter), sameAttempt: true, sameTransactionReference: true, receipt: "finalized", attemptId: lost.attemptId,
    }));
    rpcPhase = "before-first-send";
    const crashCheckout = openReadyCheckout("Persist before send");
    const crash = await attemptSignatures(crashCheckout);
    const crashBlockhash = calls.filter(method => method === "getLatestBlockhash").length;
    const crashOrganizer = await call(organizerCookie, `/api/attempts/${crash.attemptId}/signatures`, { messageHash: crash.messageHash, signatureBase64: crash.organizerSignature });
    if (crashOrganizer.status !== 200) throw new Error(`crash organizer signature ${crashOrganizer.status}`);
    const sendsBeforeCrash = sent.length;
    const callsBeforeCrash = calls.length;
    scenario.holdBeforeSend = true;
    scenario.holdAttempt = crash.attemptId;
    const heldNotice = new Promise(resolve => { scenario.releaseHold = resolve; });
    const completing = call(payerCookie, `/api/attempts/${crash.attemptId}/signatures`, { messageHash: crash.messageHash, signatureBase64: crash.payerSignature }).catch(() => ({ status: 0, json: {} }));
    const held = await Promise.race([
      heldNotice.then(() => "held"),
      completing.then(() => "returned"),
      new Promise(resolve => setTimeout(() => resolve("timeout"), 10000)),
    ]);
    if (held !== "held" || sent.length !== sendsBeforeCrash) throw new Error(`pre-send hold ${held} sends=${sent.length - sendsBeforeCrash}`);
    const crashStored = submissionBytes(crash.attemptId);
    const crashReference = submissionReference(crash.attemptId);
    const crashToken = psql(db, `select submission_token::text from public.attempts where id='${crash.attemptId}'`);
    const crashPid = payments.pid;
    if (!crashStored || !crashReference || crashToken.length < 32) throw new Error("submission identity was not persisted before the crash");
    console.log(JSON.stringify({
      phase: "boundary", name: "before-first-send", pid: crashPid, sendCount: 0,
      submissionSha256: sha256Base64(crashStored), attemptId: crash.attemptId,
    }));
    process.kill(crashPid, "SIGTERM");
    await new Promise(resolve => payments.on("exit", resolve));
    pids.splice(pids.indexOf(crashPid), 1);
    scenario.holdBeforeSend = false;
    scenario.holdAttempt = "";
    scenario.releaseHold = null;
    await completing;
    if (sent.length !== sendsBeforeCrash) throw new Error("send happened before the fresh process");
    const leaseWaitMs = await waitForLease(crash.attemptId, "expired");
    const tokenAfterWait = psql(db, `select submission_token::text from public.attempts where id='${crash.attemptId}'`);
    if (tokenAfterWait !== crashToken) throw new Error("submission lease token changed before the database clock expired it");
    rpcPhase = "after-lease";
    payments = startPayments();
    await wait(() => fetch(`http://127.0.0.1:${paymentsPort}/health`).then(response => response.ok, () => false), "Post-crash payments process did not listen", () => paymentsLog);
    if (!(payments.pid > 1) || payments.pid === crashPid) throw new Error(`post-crash pid ${crashPid} did not change`);
    const crashResume = await call(organizerCookie, `/api/attempts/${crash.attemptId}/refresh`, {});
    const crashResent = sent.slice(sendsBeforeCrash);
    const crashAfter = submissionBytes(crash.attemptId);
    const crashReferenceAfter = submissionReference(crash.attemptId);
    const crashAttempts = psql(db, `select count(*) from public.attempts where checkout_id='${crashCheckout}'`);
    const crashStatuses = rpcNotes.slice(callsBeforeCrash).filter(entry => entry.phase === "after-lease" && entry.method === "getSignatureStatuses");
    if (crashResume.status !== 200 || crashResume.json.data?.id !== crash.attemptId || crashResume.json.data?.transactionReference !== crashReference || crashAfter !== crashStored || crashReferenceAfter !== crashReference || crashAttempts !== "1" || crashResent.length !== 1 || crashResent[0] !== crashStored || referenceOf(crashResent[0]) !== crashReference || crashStatuses.length < 1 || crashStatuses.some(entry => entry.status !== "absent")) {
      throw new Error(`pre-send resume status=${crashResume.status} state=${crashResume.json.data?.state ?? ""} sends=${crashResent.length} sha=${crashResent[0] ? sha256Base64(crashResent[0]) : "none"} stored=${sha256Base64(crashStored)} attempts=${crashAttempts}`);
    }
    if (calls.filter(method => method === "getLatestBlockhash").length !== crashBlockhash) throw new Error("pre-send crash rebuilt the blockhash");
    console.log(JSON.stringify({
      phase: "boundary", name: "after-lease", previousPid: crashPid, pid: payments.pid,
      sendCountBefore: 0, postRestartSendCount: crashResent.length, submissionSha256: sha256Base64(crashAfter),
      postRestartSendSha256: crashResent.map(sha256Base64), leaseClaimable: "database-clock", leaseWaitMs,
      sameLeaseToken: true, sameAttempt: true, sameTransactionReference: true,
      statusBeforeSend: crashStatuses.map(entry => entry.status), attemptId: crash.attemptId,
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
    rpcPhase = "incomplete-submit";
    const incompleteCheckout = openReadyCheckout("Incomplete submit");
    const incomplete = await attemptSignatures(incompleteCheckout);
    const oneSignature = await call(organizerCookie, `/api/attempts/${incomplete.attemptId}/signatures`, { messageHash: incomplete.messageHash, signatureBase64: incomplete.organizerSignature });
    if (oneSignature.status !== 200 || oneSignature.json.data?.state !== "signing" || oneSignature.json.data?.signedWallets?.length !== 1) throw new Error(`one signature ${oneSignature.status} ${oneSignature.json.data?.state ?? ""}`);
    const sendsBeforeIncomplete = sent.length;
    const blockhashBeforeIncomplete = calls.filter(method => method === "getLatestBlockhash").length;
    const earlySubmit = await Promise.all([
      call(organizerCookie, `/api/attempts/${incomplete.attemptId}/submit`, {}),
      call(payerCookie, `/api/attempts/${incomplete.attemptId}/submit`, {}),
    ]);
    if (earlySubmit.some(item => item.status !== 200 || item.json.data?.state !== "signing" || item.json.data?.id !== incomplete.attemptId)) {
      throw new Error(`incomplete submit ${earlySubmit.map(item => `${item.status}:${item.json.data?.state ?? ""}`).join(" ")}`);
    }
    if (psql(db, `select count(*) from public.submissions where attempt_id='${incomplete.attemptId}'`) !== "0") throw new Error("incomplete submit stored a submission");
    if (psql(db, `select count(*) from public.signatures where attempt_id='${incomplete.attemptId}'`) !== "1") throw new Error("incomplete submit changed the signer row");
    if (sent.length !== sendsBeforeIncomplete || calls.filter(method => method === "getLatestBlockhash").length !== blockhashBeforeIncomplete) {
      throw new Error("incomplete submit broadcast or rebuilt the blockhash");
    }
    console.log(JSON.stringify({
      phase: "boundary", name: "incomplete-submit", pid: payments.pid, state: "signing",
      submissions: 0, signatures: 1, sendCount: sent.length - sendsBeforeIncomplete, newBlockhashReads: 0,
      attemptId: incomplete.attemptId,
    }));
    console.log(JSON.stringify({
      phase: "result", kind: "local-integration", chainProof: false, independentQa: false,
      sha, dirty: dirty.length > 0, execPath: process.execPath, node: process.version,
      postgres: versions.postgres, postgrest: versions.postgrest, pgBinDir: directory, pgShareDir: share,
      attempts: 1, submissions: 1, blockhashReadsBeforeRestart: beforeRestart, sendCount: sent.length,
      postRestartSendCount: resent.length, previousPid: firstPid, resumedPid,
      postRestartBytesEqual: resent.length > 0 && resent.every(bytes => bytes === submittedAfter),
      sameAttempt: resumed.json.data?.id === attemptId, sameTransactionReference: referenceAfter === referenceBefore,
      lostResponseDroppedSends: dropped.length, lostResponseLaterSends: lostLaterSends,
      sameReceipt: lostReceipt === "finalized true" && lostAfter === lostStored,
      persistBeforeSendCount: crashResent.length, persistBeforeSendShaEqual: crashResent.length === 1 && crashResent[0] === crashAfter,
      crashPreviousPid: crashPid, crashResumedPid: payments.pid, leaseWaitMs,
      bytesStable: true, restartPidChanged: resumedPid !== firstPid, prefreezeClosed: true, oldSignatureRejected: true,
      incompleteSubmitBlocked: sent.length === sendsBeforeIncomplete,
    }));
  } catch (error) {
    show(error instanceof Error ? `${error.message}\n${existsSync(join(dir, "postgres.log")) ? readFileSync(join(dir, "postgres.log"), "utf8") : ""}` : String(error));
    cleanup();
    process.exit(1);
  }
  cleanup();
  process.exit(0);
}

function reviewedMigrations() {
  const names = readdirSync(join(root, "supabase/migrations")).filter(name => name.endsWith(".sql")).sort();
  const harden = "20261108092756_harden_exposed_function_grants.sql";
  const closedSignature = "20261108125500_identical_signature_before_close.sql";
  const hardenAt = names.indexOf(harden);
  if (hardenAt < 0 || hardenAt !== names.lastIndexOf(harden) || hardenAt > names.indexOf(closedSignature)) {
    throw new Error("reviewed migrations must apply non-repeatable hardening once, before later files");
  }
  return names;
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
