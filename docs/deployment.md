# Publish the Devnet app

B5 owns this page. The public app is at [https://onetab-khaki.vercel.app](https://onetab-khaki.vercel.app). That publication does not accept a hosted checkout, a real wallet payment, or a redeploy of an unresolved attempt.

## Current targets

Checked on 2026-11-08. The OneTab database is project `dwjlpgntyefxlhcvppsa` at `https://dwjlpgntyefxlhcvppsa.supabase.co`, PostgreSQL 17.11, in `ap-southeast-1`. The five migration versions below are already applied there. Do not apply them again, and do not apply them to any other database.

The app host is the Nefalos Vercel project for `https://github.com/nefalos-tech/OneTab`. Production deployment `dpl_D4ZHztQ9PunYKXa9Szq2m3D4TSRW` was READY at 18:38:47 Bangkok on 2026-11-08. Lead recorded that deployment as the production target for exact `main` `bfc28eccbef508924d2e5e09edda2b59ea3802f4`. The public origin is `https://onetab-khaki.vercel.app`. The HTTP responses do not include that commit. No `.env`, `.env.local`, or `.env.production` file is in this checkout.

Local checks use Node.js 24.22.1 from `.nvmrc`. The repository `engines` field asks for `^24.22.1`. The Vercel project uses managed Node.js 24.x and does not pin patch 24.22.1. A pass on the local patch is not a claim about the hosted patch.

## Set the server environment

The production target stores seven variables, and only for production. One of them is the sensitive `SUPABASE_SECRET_KEY`. This page does not record values. Do not commit a secret, print one, or give one a `NEXT_PUBLIC_` name.

The names for this demo are below. `APP_ORIGIN` is `https://onetab-khaki.vercel.app`, with no path and no trailing slash. An unauthenticated call on that origin was rejected for a missing session. The same call with a different `Origin` was rejected as a forbidden origin.

| Name | Value for this demo |
| --- | --- |
| `APP_ORIGIN` | `https://onetab-khaki.vercel.app` |
| `ONETAB_API_ORIGIN` | Leave empty. The server then reads checkouts from `APP_ORIGIN`. Set it only when the server cannot reach that public origin. |
| `SUPABASE_URL` | `https://dwjlpgntyefxlhcvppsa.supabase.co` |
| `SUPABASE_SECRET_KEY` | That project's service-role key. Server only. |
| `SOLANA_CLUSTER` | `devnet` |
| `SOLANA_RPC_URL` | A Devnet endpoint. `https://api.devnet.solana.com` has no provider key. If the chosen endpoint puts a key in the URL, that key stays server-only. |
| `USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| `USDC_DECIMALS` | `6` |
| `ONETAB_FIXTURES` | Leave unset. `1` would show sample rooms on the public app. |

`GET /api/config` returns `network`, `mint`, `tokenDecimals`, and `confirmationTarget`. It does not return the database key or the RPC URL. An unauthenticated read of the public app returned Devnet, the mint above, 6 decimals, and `finalized`. `SOLANA_CLUSTER=mainnet-beta` makes that route return 503. Leave the cluster on `devnet`. This deployment did not change billing and did not use mainnet.

The session cookie is `onetab_session`. The server sets it `httpOnly`, `SameSite=Lax`, and `Secure` when `APP_ORIGIN` uses `https`. Mutations accept a browser `Origin` only when it equals `APP_ORIGIN`. No hosted session was created, so those cookie flags are not yet observed on the public URL.

The room page reads the room with short requests. `pollPlan` waits 2 seconds between reads and backs off to at most 30 seconds. A payer whose attempt still blocks a new attempt also posts refresh for that attempt. Confirmation does not depend on one request staying open. A process restart keeps the stored attempt because the attempt store is Postgres. That restart behavior is proven on a local database. It is not yet proven on a hosted redeploy.

Publishing does not establish signature-cache retention. `backendAssurance` stays `unverified`. A hosted URL does not make an expired blockhash safe to close.

## Recorded schema

These five files are already applied, in this order, on project `dwjlpgntyefxlhcvppsa`. Do not run them again. The fifth file is not safe to replay. A later schema change needs a new migration file. Do not reset this database.

1. `supabase/migrations/20261107000000_b1_schema.sql`
2. `supabase/migrations/20261107010000_b2_auth.sql`
3. `supabase/migrations/20261107020000_b3_rooms.sql`
4. `supabase/migrations/20261108000000_b4_attempt_store.sql`
5. `supabase/migrations/20261108092756_harden_exposed_function_grants.sql`

The hosted history versions are `20261107000000`, `20261107010000`, `20261107020000`, `20261108000000`, and `20261108092756`.

The first four files create the tables and the server RPCs. The fifth makes those seventeen OneTab routines security invoker. `service_role` can execute `private.attempt_snapshot` and use the `private` schema. It cannot create objects there. `anon` and `authenticated` stay denied. The four OneTab trigger functions stay invoker. Those two roles lose execute on them, and `service_role` keeps execute so its writes still fire the triggers.

The fifth file changes default privileges only for the role applying it. Hosted `postgres` is not a superuser and is not a member of `supabase_admin`, so the file does not change `supabase_admin` defaults. A function created later by `supabase_admin` can still grant execute to `anon`. Future table and sequence defaults for `postgres` in `public` can still grant `anon` and `authenticated`. For the applying role, the execute revoke is global and then repeated in `public` and `private`. A schema-only revoke leaves PostgreSQL's built-in public execute grant. If `public` or `private` contains any other security definer or trigger function, the file stops and changes none of them.

The hosted read found nine tables with row level security and no policies, and the OneTab routines as invoker. The Data API exposes `public` and `graphql_public`. It does not expose `private`. Do not add `private`.

`service_role` still bypasses row level security and still has direct table writes. Keep the service key on the server.

An application response of 401 or 403 is not a direct database mutation check. That check is still open.

Local grant checks are recorded in [tests/b1/README.md](../tests/b1/README.md) and [tests/b2/README.md](../tests/b2/README.md). `bash tests/b5/run-pg17.sh` applies every migration on disposable PostgreSQL 17.11 as non-superuser `postgres`, one transaction per file. That role is not a member of `supabase_admin`. The script then runs `tests/b5/exposure.sql` and the existing B1 through B4 SQL files as `service_role`. Those results are local. They are not hosted evidence, and they are not a reason to rerun the hosted files.

## What remains on the public app

The host, the seven production variables, the five migrations, and the unauthenticated `/` and `/api/config` reads are recorded above. Do not deploy this documentation change. Do not point the app at mainnet.

These checks are still open:

1. A real wallet creates a checkout, another wallet joins, every payer marks Ready, and one integrated Devnet payment completes on `https://onetab-khaki.vercel.app`.
2. An anonymous or forged call fails at the database, not only at the application route.
3. A real hosted session shows the `Secure`, `HttpOnly`, and `SameSite` cookie flags.
4. An unresolved attempt and its submission bytes survive a restart or redeploy, while the room keeps polling.

Until those checks have a recorded result, B5 stays open.

## Check the client bundle

To check a local build, use a fake service key and search the browser assets:

```bash
node scripts/client-bundle-secrets.mjs
```

Run that command with Node.js 24.22.1. The script sets `SUPABASE_SECRET_KEY` to a fixed fake value and `SOLANA_RPC_URL` to a fake provider key. It runs `next build`, then scans local build artifacts that Next can send to a browser. Those are `.next/static`, and under `.next/server/app` the `.html`, `.rsc`, `.body`, and `.meta` files, including `segment.rsc`. It also scans `.html` files under `.next/server/pages`. It does not scan server JavaScript. It exits 1 if one of those artifacts contains a fake value, the exact base64 or base64url of that value, the name `SUPABASE_SECRET_KEY`, or the fake database URL. It also exits 1 when the build has no static files, no scanned prerender artifacts, or no server file that contains the name `SUPABASE_SECRET_KEY`.

The encoding check is narrow. It looks for each fake value encoded on its own. It misses that value when it sits inside a larger encoded blob, and it misses hex, split pieces, and compression. This is not a data-loss-prevention scan.

The script prints counts and browser paths. It does not print the fake values. A passing run is evidence about local build artifacts. It does not read a running server's HTTP responses, and it does not download a hosted site. Separate hosted artifact scans reported no secret-shaped strings in the files they downloaded. Those scans do not cover every lazy chunk or every encoding.
