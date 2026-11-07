# P1 payment proof evidence

P1 aims to prove that two distinct real browser-wallet approvals produce one finalized Devnet USDC payment to a separate seller. The isolated implementation is locally verified. Real wallet approval was attempted and failed the immutable-message check. Two-payer payment acceptance remains **incomplete**. P1 is incomplete.

## Source and scope

The experiment starts from `a8c1d5cb524589bc13350af09dd7c07e8b66fa8e` on `feat/P1-wallet-proof`. Implementation is confined to `spikes/payment-proof/` and this evidence file. No root application, shared B1 contract, production wallet bridge, authentication module, or remote database changed.

The [spike guide](../../spikes/payment-proof/README.md) contains reproducible setup and signing steps. The coordinator uses a plain loopback page and one private SQLite experiment. The current Chrome profile was selected for sequential distinct-payer prompts. Separate-profile invitations remain available. The current profile produced one actual sign-only prompt, whose changed return bytes were rejected. No two-payer acceptance is claimed.

## Local verification on 2026-11-07

From `spikes/payment-proof`, `npm run check` passed ESLint, strict TypeScript, the Vite browser build, and 43 native Node behavior tests after the disconnect and frozen-fee fixes. Test keys are synthetic, ephemeral, and test-only. No test signs with a real payer wallet.

The passing tests cover the following behaviors.

- Literal checked-transfer amounts and signer permissions match the expected two-payer plan. Integer values include the unsigned 64-bit maximum and deterministic remainder allocation.
- Self-consistent malicious wire messages fail full semantic comparison. Changes cover payment accounts, program, fee payer, permissions, instruction order and count, amounts, decimals, authorities, and blockhash.
- Missing, invalid, unexpected, wrong-payer, and stale signatures cannot complete payment. The first signature cannot trigger a send.
- Wallet rejection, neutral provider failure, and account-switch events remain distinct. Switching away and back invalidates an in-flight result.
- Duplicate and concurrent approvals preserve both signatures on separate actual SQLite connections. Concurrent HTTP submits invoke one application send.
- File-backed SQLite close and reopen preserves the frozen message, approvals, and transaction identity. Reopening refuses corrupted private message, signature, or submission data before sending.
- Actual child processes receive `SIGKILL` before submission commit, after commit, after dispatch claim, and after mocked broadcast acceptance. Reopening preserves the permitted state and never creates another identity.
- A child process killed after experiment commit and before invitation export can re-export the same private role tokens and message from SQLite.
- A dropped send response reconciles the original reference. Only finalized matching transaction metadata, payer and seller token deltas, and fee evidence produces a receipt. Unknown or expired observations remain unresolved.
- Loopback HTTP role and origin checks reject unauthorized mutations. Public responses and the browser bundle exclude known private authorization markers.

The browser build completed with 158 transformed modules. Its JavaScript bundle contains neither `node:sqlite` nor `SOLANA_RPC_URL`, as checked by the HTTP test. The inspected source contains no private wallet keys.

## Exact local dependencies

`npm ls --depth=0` reported the following pinned direct packages. The isolated `package-lock.json` records transitive resolution.

| Package | Version |
| --- | --- |
| `@solana/kit` | `8.6.0` |
| `@solana-program/token` | `0.18.0` |
| `@solana/wallet-standard-features` | `1.5.0` |
| `@wallet-standard/app` | `1.1.1` |
| `@wallet-standard/base` | `1.1.1` |
| `@wallet-standard/features` | `1.1.1` |
| `zod` | `4.6.7` |
| `@types/node` | `25.9.9` |
| `eslint` | `10.14.0` |
| `tsx` | `4.23.15` |
| `typescript` | `6.0.3` |
| `typescript-eslint` | `8.72.1` |
| `vite` | `8.3.6` |

The host runtime is Node `25.9.0` on macOS `27.0`, arm64. TypeScript `7.0.2` was rejected by npm because `typescript-eslint@8.72.1` requires TypeScript below `6.1.0`. The selected `6.0.3` satisfies that peer range. No peer check was bypassed. A fresh comment and suppression review found an unnecessary `skipLibCheck` setting. The coordinator removed it and reran lint, typecheck including dependency declarations, build, and all 34 tests successfully.

`npm audit --omit=dev --json` reported zero vulnerabilities. The full audit reported nine moderate entries caused by the `minimatch` advisory [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) in local ESLint and TypeScript-ESLint tooling. No forced dependency upgrade was applied.

## Read-only Devnet observations

The corrected network guard queried the public Devnet RPC and returned height `506721240`. A later read-only probe returned height `506724220`. Both checked the complete Devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

The later probe built an incomplete transaction with synthetic ephemeral test-only keys, fetched a fresh confirmed blockhash, and called simulation with `sigVerify=true` and `replaceRecentBlockhash=false`. The initial classifier returned `inconclusive`. A sanitized direct probe then observed `result.value.err="SignatureFailure"`, rather than top-level RPC code `-32003`.

A failing regression reproduced that missing classification. After accepting exactly `SignatureFailure` as explicit signature refusal, a new live read-only probe returned `signature_refused` at height `506724953`. This establishes synthetic incomplete-signature simulation refusal. It establishes no real wallet prompt or payment. No application send operation ran.

The mint is fixed to `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, listed for Solana Devnet in [Circle's USDC address reference](https://developers.circle.com/stablecoins/usdc-contract-addresses). Preparation independently checks the live mint's Token Program owner, initialized layout, and six decimals.

## Real wallet verification in progress

The current user-selected profile runs Chrome `155.0.8059.41`, read from the browser's full version list. Installed Chrome application metadata reports the available update `156.0.8078.80`; that is not the running-profile version. The installed Phantom extension is `26.38.1`. Testnet Mode uses Solana Devnet, and automatic confirmation remains off. Wallet Standard and sign-only feature versions are `1.0.0`; the extension advertises legacy transaction support.

The user created all three accounts inside Phantom. No keys or recovery phrases entered the experiment. At finalized slot `519586900`, observed at `2026-11-07T07:36:59.751Z`, each ordinary fixed-mint Token Program account held `20000000` units. The organizer held `500000000` lamports. These are faucet-funded setup balances, not OneTab payment evidence.

| Role | Public wallet | Test-USDC account |
| --- | --- | --- |
| Organizer and payer zero | `6bYQRpZ13aBZrYrgFtZEnePh5ADuY4KGdW6a2Hsmf8oU` | `BvEVznZ4KqQmgmWPWZ3NDmfkcKEWQzobhtVKkTie7xKZ` |
| Payer one | `7dmYC9Ca4DdFEfQ9D5B6pQPmsgnHMU3qM5eaRNgpv7VB` | `436apUGAkZ2aEqjFCRw46ywFXzhq2DHcScax9gpXgETW` |
| Seller | `3uTY8tDn8N2yLh13bg53SHAHYzp4ZG2ConFVztiNVdW1` | `FKaacyjitxPgjQ8mKY5AStxeBRLu7qKRxDiUySQWsedv` |

The explicit disconnect control was tested against Phantom. Disconnecting, switching the selected extension account, and reconnecting displayed each expected distinct payer. Seven regressions cover disconnection, optional-feature absence/failure, and invalidation of pending connect/sign results. An independent reviewer found no blocking correctness issue.

The first immutable experiment `4aa59854-1def-472c-88ef-92f27d9260ff` expired before a wallet prompt. Its message hash is `5871ec13d39b80b093979492db6f49ae280c25c093ca9e1e81ee5f18968af539`, with last valid block height `506740846`. It remains unresolved with zero approvals, zero submissions, and no transaction reference. Its database was preserved.

A separate experiment `24ccd9ae-952a-43a4-8b51-18828edb2046` reached an actual organizer sign-only prompt. Phantom displayed a two-token contribution and estimated fee `0.00009 SOL`. After confirmation, the exact-message validator reported `Wallet changed transaction`. Zero approvals and zero submissions were stored. Its message hash is `807515aed317be1d1730fe40c6a254220f5b5d4b4f0856cefa761773c8e09088`. No second-payer prompt or application broadcast followed.

[Phantom documents automatic priority-fee insertion](https://docs.phantom.com/developer-powertools/solana-priority-fees) for unsigned messages without compute-budget instructions, including sign-only requests. The observed mutation is consistent with that behavior. Returned signed bytes were not logged. The fix now freezes `SetComputeUnitLimit(400000)` and `SetComputeUnitPrice(0)` before the two checked transfers. This retains the previous default compute allowance and adds no priority fee for the bounded Devnet proof. The actual message fee is still quoted during preflight. Exact-message and signature validation remain unchanged.

Literal-decoding regressions assert the fixed policy, two transfers, exact amounts and signer privileges. Self-consistent modified, removed, added and reordered budget instructions fail validation. Independent review also checked deterministic regeneration and the 476-byte wire size. No package was added. Actual Phantom compatibility with this fix remains pending.

A same-document invitation navigation defect was also reproduced in real Chrome. The fix scrubs the fragment, invalidates old wallet results and requests, and reloads with one invitation per document. A disposable Chromium `156.0.8078.4` run covers eight synthetic browser cases, including invalid invitations and pending old signatures or rejections. This is separate from real-wallet evidence. See the explicit browser-regression command in the spike guide.

Combined spike revision `0596997b52fa9c95628b676a2aa3b4ec566447ce` passed lint, full typecheck, build and all 43 Node tests. It includes the newly merged frontend scaffold at `7295b96415377461196cd69ffdd2bef475a42955`. Root-application checks use that scaffold's own runtime and commands; their results are not implied by the spike checks. CI and deployed acceptance are not claimed here.

| Acceptance check | Current evidence |
| --- | --- |
| Two distinct funded payers and separate seller | Verified setup balances and exact addresses above. |
| Two separate real sign-only prompts with identical message hashes | First attempted prompt returned changed bytes and was rejected. Corrected-policy proof pending. |
| First actual signature cannot complete payment | Synthetic checks passed. Real-wallet diagnostic pending. |
| One finalized seller transaction and explorer link | Pending. No OneTab broadcast recorded. |
| Seller increase, payer decreases and organizer fee | Pending. |
| Real receipt after process restart and browser reload | Pending. Synthetic persistence checks passed. |

No WalletBridge or package combination is described as proven for application integration yet. The experiment never falls back to sign-and-send. Each experiment has its own preserved database and identity. No approval is reused across experiments.

## Bounded design decisions

Model the Domain produced one frozen experiment, approvals keyed by payer slot, and one durable submission identity. Boundary Discipline placed full byte validation, wallet account continuity, and RPC parsing at their respective boundaries. Make Operations Idempotent made repeated uploads, submits, and invitation export preserve the same identity. Test Behavior, Not Implementation produced the concurrent HTTP and real SQLite process tests. Prove It Works kept real wallet acceptance separate from synthetic checks.

Disposable local invitation tokens are stored privately in the same SQLite transaction as the experiment. Authorization lookup uses their hashes. This spike-only adjustment allows interrupted private invitation export to recover without another canonical setup file. Public projections never include tokens.

SQLite uses DELETE journaling and FULL synchronous mode. The experiment deliberately allows one application send invocation. A crash after dispatch claim and before the send can leave an unsent experiment unresolved. P4's lease and rebroadcast design remains outside this spike.

API decisions were checked against the installed package declarations, [Kit 8.6.0 transaction documentation](https://github.com/anza-xyz/kit/blob/v8.6.0/docs/content/docs/advanced-guides/transactions.mdx), [Solana partial-signing guidance](https://solana.com/docs/core/transactions/partial-signing), [simulation documentation](https://solana.com/docs/rpc/http/simulatetransaction), [Node SQLite documentation](https://nodejs.org/docs/latest-v25.x/api/sqlite.html), and [Phantom's documented error codes](https://docs.phantom.com/solana/errors). A wallet-reported rejection code is not separate evidence of a human's action.
