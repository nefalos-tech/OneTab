# Implement a OneTab card

Use this guide to start work without reconstructing decisions from chat. The application stack is Next.js App Router, React, TypeScript and Supabase Postgres. Use npm and the shared package-lock.json. The repository currently contains the handoff documents; F1 creates the application scaffold.

## Start your lane

1. Read [spec.md](../spec.md), [architecture.md](architecture.md), [contracts.md](contracts.md) and your [card](implementation-map.md).
2. If you use an agent, have it read [AGENTS.md](../AGENTS.md) and load pstack before implementation.
3. Follow the [Git workflow](../AGENTS.md#git-workflow). Start a short-lived card branch from updated main and preserve other contributors' changes.
4. Implement within the [file ownership map](architecture.md#module-and-file-ownership). Ask the owner to change a shared file rather than creating a competing version.
5. Record the card's completion evidence and open a PR linked to its issue. Review, squash-merge and clean up the branch under the Git workflow. Follow the team's owner gates for merge and deployment.

## Start all three lanes together

| Owner | First work | First handoff |
| --- | --- | --- |
| @Quantomz | F1 builds the single Next.js App Router and TypeScript scaffold, then the three fixture screens | Root manifest, lockfile, proven run commands and screen shells |
| @SophiaChua | B1 translates contracts.md into types, schemas and fixtures before completing the database schema | Minimal shared contracts and example responses during the first 30 minutes |
| @kyusuku | P1 uses an isolated experiment to prove two real browser wallets can sign one payment | Supported wallet, browser, exact package versions, serialization and a confirmed transaction |

Frontend can render static fixtures before Backend finishes the routes. Payments can use a fake AttemptStore before B4 finishes. Backend can implement storage and sessions without waiting for a completed payment. The first 30-minute agreement checks this written contract and resolves only concrete incompatibilities.

If an owner is away, leave the branch, current card, evidence and next blocking step in the issue. Hand over the named files before another person edits them. Equal lane estimates do not mean every card can wait until all owners return.

## Scaffold the application once, in F1

Only Frontend creates the root application. Use a maintained Node.js LTS release supported by the selected Next.js version. Record the exact Node version in .nvmrc and package.json engines, and commit the generated lockfile.

Use create-next-app with TypeScript, App Router, a src directory, ESLint, Tailwind CSS and npm. Check the selected version's --help before invocation. The documented options include --ts, --app, --src-dir, --eslint, --tailwind and --use-npm. See the [official CLI reference](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

Generate into a new temporary directory, then copy the reviewed scaffold into this repository. The existing documentation can conflict with create-next-app's nonempty-directory check. Preserve this repository's README, AGENTS.md, CLAUDE.md, spec.md, docs/, license and ignore rules. Do not copy another .git directory or replace the pstack instructions with generated ones.

Create the src/app/ screen paths in the architecture map. Keep wallet access in client components. Create browser-safe contract and validator imports without importing server code. Use Node.js runtime for server payment routes until another runtime is explicitly proven.

F1 created the scaffold with create-next-app 16.4.5: Next.js 16.4.5, React 19.3.0, TypeScript 5.9 with `strict`, ESLint 9 and Tailwind CSS 4.3. Tailwind runs through the `@tailwindcss/turbopack` loader in `next.config.ts`, so there is no PostCSS config. `next.config.ts` sets `agentRules: false`, which stops `next dev` from writing its own block into AGENTS.md. Node is pinned to 24.22.1 in `.nvmrc`, and `package.json` engines accept `^24.22.1`.

## Run the scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the development server on port 3000, with sample data on |
| `npm run build` | Compile the production app |
| `npm run start` | Serve that production build, with sample data off unless `ONETAB_FIXTURES=1` |
| `npm run lint` | Run ESLint, including the import boundaries between screens, sample data and server code |
| `npm run typecheck` | Generate the route types, then check TypeScript without emitting files |
| `npm test` | Run the Vitest unit tests |
| `npm run test:e2e` | Build the app, run `bundle:check`, start a fake API, serve the app twice with sample data on and off, and run the Playwright suite with axe accessibility checks |
| `npm run bundle:check` | After `next build`, print each route's First Load JS and fail when a chunk a route loads before a click holds Payments' code, or when any built file holds test support |
| `npm run design:check` | Fail when the design system document and the code disagree |
| `npm run design:write` | Regenerate the generated tables in the design system document |
| `npm run check` | Run lint, typecheck, design:check and the unit tests, the same fast checks as CI |

`npm run test:e2e` uses Chromium through Playwright. On a new machine, install it once with `npx playwright install chromium`. The suite saves a screenshot of every sample state in `test-results/screens/`.

The server reads live checkouts itself, so `page.route` can't fake them. Instead, `e2e/fake-api.mjs` stands in for Backend's public read routes, and each app server reads it through `ONETAB_API_ORIGIN`. The samples server reads an empty fake on port 3198, which has no configuration and no checkouts. The gated server reads one on port 3199 with live rooms, an outage and a route that isn't deployed. The specs import the fake's rooms and IDs, so each value lives in one place. The suite needs ports 3100, 3101, 3198 and 3199 free.

Live pages also poll their room from the browser. The shared fixture in `e2e/browser-api.ts` answers those reads from the same fake, through an uncounted path, so the server's read count stays one per page load. It fails a test on any other browser request to `/api` and on any request that isn't a GET, unless the test's own backend answers it. Use its `browserApi.newPage()` for a second or third browser. A scripted room, from `scriptedRoom()`, follows `PAY_SCRIPT`. It starts at getting ready and moves one step each time the test posts to `nextStep(id)`, through ready, preparing, one and two approvals, and sending. Posting to `goToStep(id, name)` moves it straight to a named step, and results.spec.ts names every step it uses. The approvals arrive out of spot order, last spot first, so a screen that marks the first spots approved fails. Later steps follow the payment the way the server records it: sending with a transaction reference, unresolved, sending again when a refresh re-claims the send, and paid with a receipt. A failing room, from `failingRoom()`, follows `FAIL_SCRIPT`. It goes from ready to preparing to a failure before sending that the organizer may replace, then to the replacement's preparing attempt. Posting to `failBrowserReads(id, true)` makes the browser's reads of that room answer 503 until `failBrowserReads(id, false)`. The server's own reads and the steps go on, so a reload during an outage still loads. Posting to `holdServerReads(id, true)` holds the server render's reads of that room until `holdServerReads(id, false)`, so a page that reads it shows its loading skeleton while the browser's reads go on. results.spec.ts can also hold the first room read sent from one page with its own `page.route`, so the room can change owner before that read answers. Once the test releases it, that read and every other request go on to the shared guard through `route.fallback()`. A test that ends an outage dispatches `online` on the page, so the poller reads at once instead of waiting out its backoff, and expects the connection line to clear well inside that backoff. live.spec.ts also bounds how often a page reads its room, and hides the page through `document.visibilityState` to check that polling stops and resumes. results.spec.ts holds F5's evidence: a reference alone is never a receipt, a reload shows the same attempt, an outage keeps the same transaction on screen and says so, a failure and its replacement move viewers between the screens, a viewer moved to the result goes back when the room changes owner again before the result's first read answers, and a viewer who leaves while a move's page loads is neither moved nor focused when Back returns there.

live-wallet.spec.ts signs in and approves through a fake wallet. `installFakeWallet` in `e2e/fake-wallet.ts` registers a Wallet Standard wallet named Phantom in every page of a context, on `wallet-standard:app-ready` as P1 did. Its keys stay in Node, and the page asks Node to sign through an exposed function. A test can make the next prompt of a kind throw a 4001, switch the account, or register a capable decoy first. The wallet records every call, and a call to its sign-and-send feature shows up there. A context without it is the no-wallet path. `liveBackend` in `e2e/live-backend.ts` builds a room with `keyedPayment` from src/client/test-support/keyed-payment.ts, Payments' fixture with generated keys, and fresh IDs, and installs it in the fake API with a PUT to `installRoom(id)`, so the server render and the browser's reads show it. Its `server()` answers one browser's auth and attempt routes through `browserApi.answer(context, backend)`. It issues B2's six-line challenge, verifies Ed25519 over the issued bytes, keeps that browser's session, serves the signing payload, and checks each upload with Payments' `verifyPayerSignature`. A test can change the payload with `tamper`, or call `moveOnAtPayload` to install a changed room as the page reads the payload, so Approve's room read finds a room that moved on. The guard still fails a test on any request that neither the backend nor a room read answers.

## Configure local development

The app needs no database, RPC or wallet to show its screens. `npm run dev` turns sample data on. Open http://localhost:3000/samples for a link to every sample state and viewer. Each sample has its own address, such as `/checkouts/sample-signing?as=spot-2`, and the create screen's sample mode is `/?sample`. A real checkout ID is a UUID, so it never shows sample data. A production build hides every sample address unless `ONETAB_FIXTURES=1` is set.

To load a live checkout or the live create form, the server needs an origin to read the API from. Set `APP_ORIGIN=http://localhost:3000` in .env.local. Without an origin, every live checkout shows the error page, and the server log says which variable to set. Until Backend's routes exist, the e2e fake API serves live rooms instead. Start it with `node -e "import('./e2e/fake-api.mjs').then((api) => api.serve())"`, set `ONETAB_API_ORIGIN=http://localhost:3199`, and open `/checkouts/0b8f3c1e-7d2a-4c55-9f10-2a6b8e4d1c01`.

After Backend provides configuration validation, copy [.env.example](../.env.example) to .env.local and fill values through the team's private credential channel. Never commit .env.local.

| Variable | Owner | Purpose |
| --- | --- | --- |
| ONETAB_FIXTURES | F1 | `1` shows sample data, `0` hides it. When unset, sample data shows only under `npm run dev`. Never set it on the hosted app |
| APP_ORIGIN | B2 locally, B5 hosted | Exact allowed application origin for challenges and mutations |
| ONETAB_API_ORIGIN | F3 locally, B5 hosted | Origin the server reads checkouts and configuration from when it renders a page. Defaults to APP_ORIGIN. Set it when the server can't reach its own public origin, or to point the e2e servers at the fake API |
| SUPABASE_URL | B1/B5 | Development project's URL |
| SUPABASE_SECRET_KEY | B1/B5 | Privileged server-only key for the selected Supabase project |
| SOLANA_CLUSTER | P1 | Must remain devnet in this MVP |
| SOLANA_RPC_URL | P1/B5 | Devnet RPC endpoint, including any private provider credentials |
| USDC_MINT | P1 | Verified Devnet USDC mint address |
| USDC_DECIMALS | P1 | Mint decimals, checked against the on-chain account |

All listed variables are server configuration. GET /api/config returns only the allowed public subset. No database secret or private RPC URL uses a NEXT_PUBLIC_ prefix. An application with missing or inconsistent payment configuration must disable real signing and submission.

B1 provides versioned migrations and proves them against a disposable local or dedicated development database. Use the selected Supabase CLI version's help for its migration commands. Never use a reset command against a shared remote database. B5 records the target project and applied migration versions in docs/deployment.md.

## Check with a real wallet

The e2e suite proves the wallet path with a fake wallet. A real run needs Phantom on desktop Chrome, a person to click, and a configured server. [docs/evidence/live-wallet.md](evidence/live-wallet.md) has the exact steps and the table to fill in.

1. In Phantom, turn on Testnet Mode, so it shows Solana Devnet. Unlock Phantom before you press any button in OneTab, because a locked Phantom holds the prompt and OneTab waits until it answers.
2. Open the app on `http://localhost` or over HTTPS. Both are secure contexts, so WebCrypto Ed25519 exists. A plain-HTTP LAN address is not, and Approve then says the browser can't check payments.
3. Set `APP_ORIGIN` to the exact origin in the address bar, plus `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Sign-in answers unavailable without them. Approvals also need `SOLANA_RPC_URL` and the Devnet USDC settings above, or the payment routes answer `CONFIGURATION_UNAVAILABLE`.
4. Give each payer its own Chrome profile with its own Phantom. To change payer in one profile, disconnect in OneTab, switch in Phantom, then connect again.

## Prepare the payment experiment in P1

1. Use separate browser profiles or devices for the payer wallets. Keep the seller separate from every payer.
2. Fund payer token accounts with Devnet test USDC. Give the organizer enough Devnet SOL for fees.
3. Prepare the seller's receiving token account and verify the mint and account owners.
4. Prove sign-only behavior with two browser wallets and submit one transaction containing both transfers.
5. Save public transaction evidence and exact setup in docs/evidence/payment-proof.md. Keep keys and seed phrases out of the repository and logs.
6. Give Frontend the working package versions and WalletBridge behavior. Frontend integrates those dependencies into the single root lockfile.

Keep experiment dependencies under spikes/payment-proof/ until integration. Do not introduce its own lockfile into the root. If no compatible wallet combination works, report the failing step on P1 before claiming that the payment path is implemented.

## Change the UI design

[The design system](design-system.md) is the UI contract. To change a color, size, component, state, word or interaction:

1. Make the change in code. Tokens live only in the `@theme` block of `src/app/globals.css`, each with a one-line role comment above it. States, button labels, wallet messages and fixed words live only in `src/client/catalog.ts`.
2. Run `npm run design:write`. It regenerates the token, contrast, state, word and wallet tables in `docs/design-system.md`.
3. Update the hand-written sections of `docs/design-system.md` that the change affects, such as rules, layouts, components and the glossary. To add a contrast pair, add a row to the contrast table with its foreground, background, minimum and use, then run `npm run design:write` again.
4. If the reason behind a rule changed, update [design decisions](design-decisions.md).
5. Add a row to the design system's change log with the date, the change, the reason and the PR.
6. Run `npm run check`, then `npm run test:e2e`. Look at the screenshots in `test-results/` for every state the change touches.

To compare new accent or status colors before choosing one, run `node scripts/palette-candidates.mjs "#RRGGBB"`. It prints contrast and color-blindness distances against the current tokens.

## Verify and hand off each card

Use the card's Done when list and the [spec acceptance criteria](../spec.md#acceptance-criteria). Record the scenario, observed outcome and relevant command or public transaction reference. Distinguish fixtures, local integration, hosted Devnet and submission confirmation.

| Work | Minimum evidence |
| --- | --- |
| Screens | Fixture states render, build/type checks pass, and relevant desktop controls work |
| Sessions and rooms | Replay and role checks fail correctly, concurrent joins cannot overfill, refresh restores state |
| AttemptStore | Concurrent signatures survive, duplicate preparation reuses the attempt, crashed leases recover the same identity |
| Payments | Real browser signatures, validation failures, persisted submission identity and observed chain outcomes |
| Deployment | Public URL works on separate profiles/computers and privileged credentials are absent from browser assets |

P1 owns docs/evidence/payment-proof.md. B5 owns [docs/deployment.md](deployment.md). That page names the public origin `https://onetab-khaki.vercel.app`, the Nefalos host, and the applied migration versions. Hosted wallet, database-mutation, cookie, and redeploy checks are still open. B6 owns docs/demo.md for rehearsal and docs/submission.md for the public video, AI-tool disclosure and saved submission confirmation. Those two files do not exist yet.

Use the hour 4, 8, 12, 16 and 18 checkpoints in [spec.md](../spec.md#delivery-checkpoints-and-unresolved-choices). The board owns progress. A proposed setup or a document checklist is not completion evidence.
