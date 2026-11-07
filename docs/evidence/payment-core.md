# P2 application payment integration

P2 makes the server and browser agree on the complete payment each participant authorizes. The application now imports one canonical payment algorithm. The recorded P1 proof keeps its two-payer envelope while using that same algorithm and preflight.

## Public payment boundary

`src/lib/payments/payment-core.ts` is the unchanged algorithm moved from the spike. The old and new files have SHA-256 `0453fcdfbcc3e2f4466005f190adf99075f3b004f33278893f9985ab02bb6b8f`. It preserves legacy message bytes, explicit compute limits, zero compute price, and two or three exact slot-ordered transfers.

`validateSigningPayload({ payload, room, config })` requires an independently read current paying room with a signing attempt. It checks the checkout ID, current attempt ID, recorded lifetime, frozen ready membership, organizer, configured Devnet USDC mint, six decimals, and finalized target. It derives classic-token associated accounts for every payer and the seller. It compares every supplied payment field and the complete unsigned transaction against that independently derived plan.

`validateFrozenSigningPayload` performs the same payment validation against an explicit trusted checkout, frozen participants, attempt ID, lifetime, and config. Server collection, submission, and recovery can reuse it without fabricating a signing room. The caller owns lifecycle authorization. Validation alone does not reserve an attempt, establish current chain height, or prove safe retry.

Both validators copy their inputs before asynchronous account derivation or hashing. Decimal units are canonical unsigned 64-bit strings. Base64 and lowercase SHA-256 values must be canonical. Encoded payment strings are bounded before decoding, and decoded bytes cannot exceed Kit's 1,232-byte legacy transaction limit. Returned message bytes are owned copies. Consumers must keep those bytes private from mutation.

`createCheckoutPaymentPlan` supplies the same account policy to the server builder. The general payment core continues to accept explicit accounts so the original experiment remains reproducible.

## Server construction

`buildSigningPayload` accepts an immutable checkout, frozen participants, reserved attempt ID, config, and injected RPC. It verifies the Devnet genesis, actual classic-token program owners, mint layout and decimals, every token account's mint and wallet owner, initialized state, unsupported authority flags, and payer funds. It obtains a confirmed blockhash, builds exact message bytes, then checks the organizer's SOL balance against the RPC fee quote for those exact bytes. It creates no accounts and broadcasts nothing.

The caller must reserve and lease the attempt before building, then atomically freeze this result before exposing it. Those lifecycle operations belong to P3 and B4. `src/server/payments/preflight.ts` owns preflight for both this builder and the existing spike RPC. The two-payer proof envelope remains in the spike.

## Local verification

The root checks used Node 24.22.1 and the exact root dependency patch subsequently approved by the user for inclusion. Root lint, route type generation, TypeScript, design checks, and all 992 unit tests passed. The new P2 suites contain 46 tests. The coordinator also passed the production build and all 139 application browser tests.

The spike used host Node 25.9.0. Its lint, TypeScript, Vite build, and all 65 tests passed. The existing P1 known-answer byte fixture still passed. The three associated account vectors in `spikes/payment-proof/evidence/devnet-20261107.json` matched the application derivation.

Chromium 153.0.8010.12 executed the actual Vite bundles. All eight invitation regressions and 30 payment or B1-validator scenarios passed. The browser checks include both payer counts, full byte parity with Node, foreign but internally consistent accounts, changed seller, stale attempt and height, submitting state, bad config, malformed or oversized encoding, reordered slots, and mutation across asynchronous work. The browser runner blocked external requests and observed none.

Run these commands from the root and spike directories respectively.

```sh
PATH=/Users/kyusuku/Hackathons/onetab-run-20261107/.tools/node24/node-v24.22.1-darwin-arm64/bin:$PATH npm run check
npm run check
node --import tsx test/invite-navigation.mjs --playwright-module ../../node_modules/playwright/index.mjs
```

Loopback tests required the host's sandbox escalation because a standalone local listener returned `EPERM` inside the sandbox. The escalated checks used synthetic fixtures and local servers. No new live-wallet or Devnet payment experiment ran. The recorded Devnet evidence and private experiment databases were untouched.

## Integration dependency

Frontend owns the root manifest and lockfile. The user approved including the tested two-file dependency patch in P2. It pins `@solana/kit@8.6.0`, `@solana-program/token@0.18.0`, and `zod@4.6.7` without changing any existing package version. No root ESLint or TypeScript configuration change was needed.

The spike switches its own TypeScript resolution to ESNext with Bundler resolution so it can import the canonical files outside its local ESM package. Its source execution still uses `tsx`, and Vite still produces the browser build.

P2 adds no auth, rooms, contracts, migrations, routes, frontend integration, signature collection, settlement, merge, or deployment. F4 must call the browser validator before a wallet prompt. P3 must enforce session and lifecycle rules when reusing the frozen validator.
