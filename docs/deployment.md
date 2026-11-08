# Publish the Devnet app

B5 owns this page. The public app is not published. Nothing below is a claim that a hosted checkout, a remote migration, or a browser-bundle check on a public URL has run.

## Current targets

These accounts were read on 2026-11-08. None of them is an OneTab deployment.

| Account | What is there | OneTab use |
| --- | --- | --- |
| Vercel | Projects `memory-card`, `nextjs-dashboard`, `cv-application`, and `shopping-cart` on account `team_qf7TiC8umhBHOkt7ZSeT8CRJ`. No project is linked to `https://github.com/nefalos-tech/OneTab`. | Do not deploy onto these projects. |
| Railway | Project `clever-creativity` with services `@caravan/web` and `@caravan/worker`. | This is Caravan, not OneTab. |
| Supabase | Organization named Caravan. Its only project is `caravan_1.0`, id `emfpxatpuqdqscsaapcm`, Postgres 17. | Do not apply OneTab migrations here. |

GitHub has no deployment for `nefalos-tech/OneTab`, and the repository homepage is empty. No `.env`, `.env.local`, or `.env.production` file is in this checkout.

## Set the server environment

Copy [.env.example](../.env.example) into the host's server environment. Put the secret values in through the host's secret store. Do not commit them, print them, or give any of them a `NEXT_PUBLIC_` name.

| Name | Value for this demo |
| --- | --- |
| `APP_ORIGIN` | The exact `https` origin of the public app, with no path and no trailing slash. |
| `ONETAB_API_ORIGIN` | Leave empty. The server then reads checkouts from `APP_ORIGIN`. Set it only when the server cannot reach that public origin. |
| `SUPABASE_URL` | The new OneTab project's API URL. |
| `SUPABASE_SECRET_KEY` | That project's service-role key. Server only. |
| `SOLANA_CLUSTER` | `devnet` |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com`, or another Devnet endpoint. A key inside this URL stays server-only. |
| `USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| `USDC_DECIMALS` | `6` |
| `ONETAB_FIXTURES` | Leave unset. `1` would show sample rooms on the public app. |

`GET /api/config` returns `network`, `mint`, `tokenDecimals`, and `confirmationTarget`. It does not return the database key or the RPC URL. `SOLANA_CLUSTER=mainnet-beta` makes that route return 503. Leave the cluster on `devnet`.

The session cookie is `onetab_session`. The server sets it `httpOnly`, `SameSite=Lax`, and `Secure` when `APP_ORIGIN` uses `https`. Mutations accept a browser `Origin` only when it equals `APP_ORIGIN`.

The room page reads the room with short requests. `pollPlan` waits 2 seconds between reads and backs off to at most 30 seconds. A payer whose attempt still blocks a new attempt also posts refresh for that attempt. Confirmation does not depend on one request staying open. A process restart keeps the stored attempt because the attempt store is Postgres. That restart behavior is proven on a local database. It is not yet proven on a hosted redeploy.

Publishing does not establish signature-cache retention. `backendAssurance` stays `unverified`. A hosted URL does not make an expired blockhash safe to close.

## Apply the schema

Apply these files in order to a new OneTab database. Do not run a reset against a shared database.

1. `supabase/migrations/20261107000000_b1_schema.sql`
2. `supabase/migrations/20261107010000_b2_auth.sql`
3. `supabase/migrations/20261107020000_b3_rooms.sql`
4. `supabase/migrations/20261108000000_b4_attempt_store.sql`

The migrations enable row-level security and grant the privileged writes to `service_role`. Local checks of those grants are recorded in [tests/b1/README.md](../tests/b1/README.md) and [tests/b2/README.md](../tests/b2/README.md). Those checks used a disposable local database. They are not a result from `caravan_1.0` or from any hosted Supabase project.

## Publish after the owner names the targets

1. Create a new host project for `https://github.com/nefalos-tech/OneTab`. Use a host that runs Node.js 24.22.1. Do not reuse the Vercel projects or the Railway services named above.
2. Create a new Supabase project for OneTab. The only visible organization is named Caravan. Confirm that organization with the owner before creating a project in it. Do not use `caravan_1.0`.
3. Set the variables in the table above. Set `APP_ORIGIN` to the `https` URL the host assigns.
4. Apply the four migration files in order. Record the project id and the four versions on this page after they succeed.
5. From another computer, open `/` and `/api/config`. The config response should name Devnet, the mint above, 6 decimals, and `finalized`.
6. Repeat a create, join, and Ready flow, then one integrated payment, on that URL. Anonymous calls to the Data API must fail.
7. Redeploy once while an attempt is unresolved. The same attempt and submission bytes should still be there. The room should keep polling.

Until those steps have a recorded result, the public URL, the provider, and the smoke test stay unset.

## Check the client bundle

Before the first publish, build with a fake service key and search the browser assets:

```bash
node scripts/client-bundle-secrets.mjs
```

The script sets `SUPABASE_SECRET_KEY` to a fixed fake value, runs `next build`, and scans `.next/static`. It exits 1 if that value, the name `SUPABASE_SECRET_KEY`, or the fake database URL appears there. It also exits 1 when the server build does not contain the name `SUPABASE_SECRET_KEY`, because that means the scan can no longer tell a real client leak from a build that dropped the lookup. The script prints counts and client paths. It does not print the key. This is a local build check. It does not inspect a deployed host's downloaded assets.
