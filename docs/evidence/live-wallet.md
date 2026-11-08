# Live wallet

This records what proves the live wallet path for [F2](../cards/F2.md) ([#8](https://github.com/nefalos-tech/OneTab/issues/8)) and the payment check for [F4](../cards/F4.md) ([#10](https://github.com/nefalos-tech/OneTab/issues/10)), on branch `feat/F2-live-wallet` from main `be767b7`. Everything below ran in a container with no browser extension and no person to click. The real-wallet rows are therefore NOT RUN, and the last section gives the steps to run them.

## Proven with fixtures and local runs

| Claim | Evidence | Kind |
| --- | --- | --- |
| The bridge prefers Phantom, accepts only the feature versions P1 proved plus `solana:signMessage` 1.1.0, and answers `no_wallet`, `wrong_network`, `cannot_sign`, `rejected` or `failed` with no prompt where the contract says so. It reads each registered wallet on its own, so a wallet whose fields throw or don't parse can't stop Phantom from connecting | `src/lib/wallet/standard.test.ts`, fake registry and fake wallets with real Ed25519 keys | Unit fixture |
| Sign-in signs a copy of the server's exact challenge, refuses a prefixed or changed message, a short signature, a non-Ed25519 type and a signature that fails the local check, and answers 88 characters of canonical base64. It verifies and encodes one copy of the signature, so an output that answers other bytes on a later read can't pass. A selected address whose public key changed after connect gets no prompt | `standard.test.ts`, and `e2e/live-wallet.spec.ts` comparing the signed bytes with the challenge the test backend issued | Unit fixture and local Chromium |
| Account changes reach the machine on a later task, once per address, a switch away and back as two, unregister as `null`, and nothing after disconnect. A wallet that unregisters during its connect prompt makes `connect` answer `failed`. A switch during any prompt voids its answer, a 4001 included | `standard.test.ts` | Unit fixture |
| `liveEnvironment()` builds during server rendering without creating the wallet registry | `src/lib/wallet/live.test.ts` | Unit fixture |
| Approve validates real bytes with Payments' `validateFrozenSigningPayload` against a fresh room, refuses every tampered byte, refuses a room that moved on or already holds this payer's approval, says `unsupported` without Ed25519 before Payments' code loads and `check_unavailable` when that code doesn't load, and loads it again on the next press. A `createdAt` with `+00:00` passes | `src/client/payment-check.test.ts`, Payments' fixture with generated keys | Unit fixture |
| Approve reads the payload, then the room, then uploads with a room read in its write. A failed room read and a moved room open no prompt. A room with a new attempt shows the moved-on notice while that attempt's Approve is on screen, and any other moved room leaves its status line to say what happened | `src/client/live-actions.test.ts` and `live-wallet.spec.ts` | Unit fixture and local Chromium |
| The bridge asks `solana:signTransaction` once, with a copy of the checked bytes, `chain: solana:devnet` and `preflightCommitment: confirmed`, and never calls a sign-and-send feature. Only the payment object the check made opens a prompt, so a copy with other bytes opens none | `standard.test.ts`, `payment-check.test.ts` and `live-wallet.spec.ts` | Unit fixture and local Chromium |
| Approve through live actions, with the real check, the session store and the bridge, sends an upload request whose body is exactly `{messageHash, signatureBase64}`, which Payments' `verifyPayerSignature` accepts | The chained test in `standard.test.ts`, which captures the request through a stubbed `fetch` | Unit fixture |
| In a browser, one approval uploads exactly `{messageHash, signatureBase64}`, a tampered byte opens no prompt, and a 4001 offers **Decline payment** without sending it, after which Approve uploads | `live-wallet.spec.ts`, fake Wallet Standard wallet on `app-ready`, test backend checking uploads with `verifyPayerSignature` | Local Chromium |
| ESLint keeps Wallet Standard and the bridge in src/lib/wallet. In browser code it bans sign-and-send by import from all three wallet-standard packages and by string key, kit's RPC, transport, send, airdrop and sign-and-send factories, every import from `@solana/rpc`, `@solana/rpc-*` and `@solana/signers`, and `import()` of all of them. It bans a value import of Payments' code and any import of src/client/test-support | `src/client/wallet-fence.test.ts` through ESLint's Node API | Unit fixture |
| No route loads Payments' code before a click, and no built file for the browser or the server holds test support | `npm run bundle:check` after `next build` | Local build |

## Commands and outcomes

| Command | Outcome |
| --- | --- |
| `npm run check` | Lint, typecheck and design check pass. Vitest: 33 files, 1784 tests passed |
| `npm run test:e2e` | `next build` passed, `bundle:check` passed, Playwright: 155 passed |

Each new behavior was also shown red. A script applied one change at a time to the code, ran the named tests, and restored the file. 51 changes each failed at least one test, and the tests passed again after every restore. They cover the bridge's staleness rules, the sign-in echo and local verify, payment signing, the check's narrowing, its tamper rows under the old placeholder check, and the lazy load and its retry. Before the new fences existed, 7 of the fence test's 12 cases failed, and removing the broadcast ban fails 2 more. A static import of Payments' `signing-payload` in payment-check.ts made `bundle:check` fail on every route.

In the fix round after review, these new tests failed against the code before their fix: six broken wallets beside Phantom and a page with only broken ones, a signature getter that answers other bytes, an unregister inside the connect answer, a tampered copy of a checked payment, four moved rooms, 23 fence cases and the test support fence. The e2e test for a room that moved to a new attempt failed against a build from before the fix. Dropping the prompt-time key check, moving the Ed25519 probe after Payments' load, or changing the upload body each fails the new tests. A build with an `import()` of test support in a component failed `bundle:check` on one browser chunk and one server chunk.

## First Load JS

`bundle:check` counts every chunk a route's client manifests name for its first load, `rootMainFiles` included. gzip is Node's default level.

| Route | Before (`be767b7`) | After | gzip before | gzip after |
| --- | --- | --- | --- | --- |
| `/`, `/checkouts/[id]`, `/checkouts/[id]/result` | 585.3 KiB | 611.1 KiB | 176.9 KiB | 185.9 KiB |
| `/samples`, not found | 539.6 KiB | 565.4 KiB | 163.3 KiB | 172.3 KiB |
| Global error | 446.5 KiB | 446.5 KiB | 131.9 KiB | 131.9 KiB |

Payments' code sits in three chunks that load on the first Approve. A static import would make a live room 760.6 KiB, 229.8 KiB gzip. Two builds without part of the change attribute the 25.3 KiB increase. Without the Wallet Standard bridge, a live room is 604.8 KiB. Without any Payments import it is 597.4 KiB, so the lazy import adds 13.2 KiB to the first load. The new shared chunk holds `@solana/kit` codec and address code that Payments uses, such as the offset and resize decoders and SHA-256 address derivation. That attribution comes from the chunk's contents and is inferred, not traced. The fix round after review moved a live room from 610.6 KiB to 611.1 KiB, and its gzip from 186.0 KiB to 185.9 KiB. That covers its code changes and the bridge's new runtime import of payment-check.ts, and the split between them wasn't measured.

## NOT RUN

| Check | Why it matters | Who runs it |
| --- | --- | --- |
| Phantom sign-in on desktop Chrome with Devnet | P1 never called `solana:signMessage`. Its version, the account's `features` and whether Phantom signs the six lines unchanged are unrecorded | Frontend or Payments, before P3 closes |
| A real 4001 from Phantom on the sign-in and payment prompts | Only fake wallets threw `{code: 4001}` | The same run |
| A Phantom approval that the payment's return check and the server both accept | Proven only with fake wallets and Payments' fixture bytes | Payments, P3 and P6 |
| Two and three payers in separate Chrome profiles | The e2e approvals use one payer per room | P6 |
| The hosted Devnet app | No deployment exists yet | F6 |

## Run the real-wallet check

Record each run as local or hosted, with the Phantom and Chrome versions.

1. Give each payer a Chrome profile with Phantom. In Phantom, open **Settings**, turn on **Testnet Mode**, and pick Solana Devnet. Fund each payer with Devnet USDC, and the organizer with Devnet SOL for fees.
2. For a local run, set these in .env.local: `APP_ORIGIN=http://localhost:3000`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SOLANA_CLUSTER=devnet`, `SOLANA_RPC_URL`, `USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` and `USDC_DECIMALS=6`. Run `npm run build`, then `npm run start`, and open `http://localhost:3000`. For a hosted run, open the deployed HTTPS origin, which must equal its `APP_ORIGIN`.
3. Unlock Phantom before pressing anything in OneTab. A locked Phantom holds the prompt, and OneTab waits until it answers.
4. Press **Connect wallet** and approve the connection. Phantom then shows a message. Check that it reads `OneTab sign-in`, then `Origin:` with the address bar's origin, `Wallet:` with your address, `Purpose: authenticate`, `Challenge:` and `Expires:`. Approve it. The header should show **Signed in as** and your short address.
5. If the wallet line says "This wallet can't sign in to OneTab", run this in the DevTools console and record what it prints. It asks every installed wallet to register with a logger and prints each feature's version.

   ```js
   window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register: (...wallets) => { for (const w of wallets) console.log(w.name, w.chains, Object.fromEntries(Object.entries(w.features).map(([k, f]) => [k, f.version])), w.accounts.map((a) => a.features)); return () => {}; } } }));
   ```

   If it says "Sign-in isn't available right now" and Phantom never showed the message, first check the Network tab or the server log for a failed `GET /api/auth/session` or `POST /api/auth/challenge`. A failure there is the server's configuration, not the wallet. If the challenge was issued, the account lacks `solana:signMessage` or this browser can't verify Ed25519: run the snippet above, record what it prints, then try again in a current desktop Chrome. If Phantom did show the message, check the server log first. If the server verified nothing, Phantom changed the message or the signature failed OneTab's own check.
6. Disconnect, press **Connect wallet** again, and reject the message in Phantom. The line should read "You didn't sign in. Nothing was signed or sent."
7. Create a checkout in the organizer's profile, join in the other profiles, and mark everyone ready. The organizer presses **Start payment**.
8. In one payer's profile, press **Approve in wallet** and reject in Phantom. The notice should say nothing was sent and offer **Decline payment**. Don't decline. Press **Approve in wallet** again, check that Phantom shows a Devnet transaction, and approve it. The spot should show approved.
9. Approve in every other profile. Payments' P6 and F6 checks take over from the submission onwards.

Fill in this table and keep the console output from step 5 if you needed it.

| Step | Local or hosted | Result | Phantom | Chrome | Date |
| --- | --- | --- | --- | --- | --- |
| 4. Sign-in signs the six lines | | NOT RUN | | | |
| 6. A refused sign-in shows its words | | NOT RUN | | | |
| 8. A refused approval offers Decline and sends nothing | | NOT RUN | | | |
| 8. An approval uploads and the spot shows approved | | NOT RUN | | | |
| 9. Every payer approves in its own profile | | NOT RUN | | | |
