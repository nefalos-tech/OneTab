# P1 payment proof evidence

P1 aims to prove that two distinct real browser-wallet approvals produce one finalized Devnet USDC payment to a separate seller. The isolated implementation is locally verified. Real wallet and payment acceptance is **not run**. P1 is incomplete.

## Source and scope

The experiment starts from `a8c1d5cb524589bc13350af09dd7c07e8b66fa8e` on `feat/P1-wallet-proof`. Implementation is confined to `spikes/payment-proof/` and this evidence file. No root application, shared B1 contract, production wallet bridge, authentication module, or remote database changed.

The [spike guide](../../spikes/payment-proof/README.md) contains reproducible setup and signing steps. The coordinator uses a plain loopback page and one private SQLite experiment. The current Chrome profile was selected for sequential distinct-payer prompts. Separate-profile invitations remain available. Neither arrangement has completed actual wallet approval in this evidence.

## Local verification on 2026-11-07

From `spikes/payment-proof`, `npm run check` passed ESLint, strict TypeScript, the Vite browser build, and 34 native Node behavior tests. Test keys are synthetic, ephemeral, and test-only. No test signs with a real payer wallet.

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

## Real acceptance still required

The coordinator observed the real Phantom extension registered on the local inspector, then observed a connection to public account `6bYQRpZ13aBZrYrgFtZEnePh5ADuY4KGdW6a2Hsmf8oU` after the user approved connection. The account advertised `solana:devnet` and `solana:signTransaction`. The page remained unprepared with approval and submission disabled. This proves discovery and connection only. The Chrome application version is `156.0.8078.80` from its installed application metadata.

The user supplied distinct second-payer and seller public addresses. At finalized Devnet slot `519575487`, the connected first account had zero lamports and no account for the fixed USDC mint. A free test-SOL RPC request returned HTTP `410`, reporting that its faucet is closed. Web-faucet funding and real transaction approval remain pending. No real payment was submitted.

| Check | Observed result |
| --- | --- |
| Installed wallet and extension version | Not recorded by this implementation worker. |
| Exact browser version and actual profile arrangement | Chrome `156.0.8078.80`, current profile selected by the user. Connected one real account. |
| Actual runtime sign-only capability and legacy serialization support | Real account advertises sign-only. Actual legacy signing and return serialization remain untested. |
| Two distinct funded payer accounts and a separate prepared seller account | Three public addresses available. Funding and prepared token accounts remain unverified. |
| First actual wallet prompt and verified approval | Not run. |
| First actual signature cannot complete payment | Local synthetic check passed. Real-wallet diagnostic not run. |
| Second actual wallet prompt and matching message hash | Not run. |
| One finalized transaction and Devnet explorer link | Not run. No reference exists. |
| Seller increase, both payer decreases, organizer fee | Not observed on chain. |
| Real result after process restart and browser reload | Not run. Local synthetic SQLite recovery passed. |

No WalletBridge or package combination is described as proven for application integration yet. Kit plus generated Token Program instructions and Wallet Standard are implemented candidates. The experiment never falls back to sign-and-send.

## Bounded design decisions

Model the Domain produced one frozen experiment, approvals keyed by payer slot, and one durable submission identity. Boundary Discipline placed full byte validation, wallet account continuity, and RPC parsing at their respective boundaries. Make Operations Idempotent made repeated uploads, submits, and invitation export preserve the same identity. Test Behavior, Not Implementation produced the concurrent HTTP and real SQLite process tests. Prove It Works kept real wallet acceptance separate from synthetic checks.

Disposable local invitation tokens are stored privately in the same SQLite transaction as the experiment. Authorization lookup uses their hashes. This spike-only adjustment allows interrupted private invitation export to recover without another canonical setup file. Public projections never include tokens.

SQLite uses DELETE journaling and FULL synchronous mode. The experiment deliberately allows one application send invocation. A crash after dispatch claim and before the send can leave an unsent experiment unresolved. P4's lease and rebroadcast design remains outside this spike.

API decisions were checked against the installed package declarations, [Kit 8.6.0 transaction documentation](https://github.com/anza-xyz/kit/blob/v8.6.0/docs/content/docs/advanced-guides/transactions.mdx), [Solana partial-signing guidance](https://solana.com/docs/core/transactions/partial-signing), [simulation documentation](https://solana.com/docs/rpc/http/simulatetransaction), [Node SQLite documentation](https://nodejs.org/docs/latest-v25.x/api/sqlite.html), and [Phantom's documented error codes](https://docs.phantom.com/solana/errors). A wallet-reported rejection code is not separate evidence of a human's action.
