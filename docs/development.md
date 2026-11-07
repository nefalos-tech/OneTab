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
| `npm run test:e2e` | Build the app, serve it twice with sample data on and off, and run the Playwright suite with axe accessibility checks |
| `npm run design:check` | Fail when the design system document and the code disagree |
| `npm run design:write` | Regenerate the generated tables in the design system document |
| `npm run check` | Run lint, typecheck, design:check and the unit tests, the same fast checks as CI |

`npm run test:e2e` uses Chromium through Playwright. On a new machine, install it once with `npx playwright install chromium`. The suite saves a screenshot of every sample state in `test-results/screens/`.

## Configure local development

The app needs no database, RPC or wallet to show its screens. `npm run dev` turns sample data on. Open http://localhost:3000/samples for a link to every sample state and viewer. Each sample has its own address, such as `/checkouts/sample-signing?as=spot-2`, and the create screen's sample mode is `/?sample`. A real checkout ID is a UUID, so it never shows sample data. A production build hides every sample address unless `ONETAB_FIXTURES=1` is set.

After Backend provides configuration validation, copy [.env.example](../.env.example) to .env.local and fill values through the team's private credential channel. Never commit .env.local.

| Variable | Owner | Purpose |
| --- | --- | --- |
| ONETAB_FIXTURES | F1 | `1` shows sample data, `0` hides it. When unset, sample data shows only under `npm run dev`. Never set it on the hosted app |
| APP_ORIGIN | B2 locally, B5 hosted | Exact allowed application origin for challenges and mutations |
| SUPABASE_URL | B1/B5 | Development project's URL |
| SUPABASE_SECRET_KEY | B1/B5 | Privileged server-only key for the selected Supabase project |
| SOLANA_CLUSTER | P1 | Must remain devnet in this MVP |
| SOLANA_RPC_URL | P1/B5 | Devnet RPC endpoint, including any private provider credentials |
| USDC_MINT | P1 | Verified Devnet USDC mint address |
| USDC_DECIMALS | P1 | Mint decimals, checked against the on-chain account |

All listed variables are server configuration. GET /api/config returns only the allowed public subset. No database secret or private RPC URL uses a NEXT_PUBLIC_ prefix. An application with missing or inconsistent payment configuration must disable real signing and submission.

B1 provides versioned migrations and proves them against a disposable local or dedicated development database. Use the selected Supabase CLI version's help for its migration commands. Never use a reset command against a shared remote database. B5 records the target project and applied migration versions in docs/deployment.md.

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

P1 owns docs/evidence/payment-proof.md. B5 owns docs/deployment.md with the deployed URL, provider, configuration names and smoke-test evidence. B6 owns docs/demo.md for rehearsal and docs/submission.md for the public video, AI-tool disclosure and saved submission confirmation. These files are card outputs and do not exist yet.

Use the hour 4, 8, 12, 16 and 18 checkpoints in [spec.md](../spec.md#delivery-checkpoints-and-unresolved-choices). The board owns progress. A proposed setup or a document checklist is not completion evidence.
