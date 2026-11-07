# Verify payment failures and recovery

P5 is incomplete. Every runtime scenario below is **NOT RUN**, including local tests, integrated checks, and live Devnet checks. This checklist prepares [P5](../cards/P5.md). It is not payment evidence.

The inspected baseline is `a8c1d5cb524589bc13350af09dd7c07e8b66fa8e`, dated 2026-11-07. It has no `src/`, root `package.json`, or root `package-lock.json`. The implementations required from [P4](../cards/P4.md), [F5](../cards/F5.md), and [B4](../cards/B4.md) are absent. Their card documents describe planned work. No application test, build, or runtime command is available at this baseline.

Follow the [spec acceptance criteria](../../spec.md#acceptance-criteria), [shared contracts](../contracts.md), [recovery rules](../architecture.md#persistence-and-request-recovery), and [development setup](../development.md). Record changed prerequisites against the exact revision used for execution.

## Prepare the test environment

1. Obtain the integrated P4 submission flow, B4 Postgres store, F5 recovery UI, executable B1 contracts, authenticated sessions, and application scripts. Record the tested commit and any uncommitted diff.
2. Use disposable Devnet test funds, two distinct payer wallets in separate browser profiles, and a seller distinct from both payers. Repeat signer-count checks with three payers when supported.
3. Verify the Devnet network, mint, decimals, token-account owners, and prepared receiving accounts. Record the package lockfile hash, resolved dependencies, runtime, browser, and extension versions. Use a wallet combination actually proved by P1.
4. Start the actual application and database with their published commands. Record the commands and target environment. A fake store cannot establish durable recovery or database concurrency.
5. Authenticate each payer, create a checkout, join its slots, and mark every payer ready. Use a fresh checkout for independent cases. Keep funds idle except for explicit funding changes in a scenario.
6. Add controlled pause, race, and response-loss hooks only to a test environment. Record where each hook acts and remove it before ordinary use. Keep payment validation and production signing rules intact.

Use `confirmed` for blockhash and preflight commitment. Only `finalized` with `err=null` permits a success receipt.

## Record proof for every scenario

Record the scenario ID, UTC time, setup, exact command or browser actions, expected outcome, observed outcome, and artifact paths. Keep the status `NOT RUN` until execution produces observations. Use `PASS`, `FAIL`, or `BLOCKED` only with the observed reason and evidence.

Capture these common records before the action and after reconciliation:

- The checkout ID, attempt ID, frozen participant slots, message hash, blockhash, and `lastValidBlockHeight`.
- The HTTP status and error code, persisted attempt state, `signedWallets`, `canRetry`, submission reference, and receipt. Compare the same fields in every payer's browser after refresh.
- Each payer's and the seller's token-account address and integer-unit balance. Record the organizer's SOL balance in lamports and the observation slots or timestamps.
- For a landed transaction, its reference, Devnet explorer link, confirmation status, execution error, instruction results, token balance changes, and actual `meta.fee`. Explain the organizer's SOL delta separately from USDC contributions.
- For a rejected or unsubmitted case, submission traces and balance observations for the stated interval. Report the fee as unobserved when no landed metadata exists. Do not infer a zero fee or safe retry from a local error or missing status.
- For recovery cases, the durable submission record and a digest of the signed bytes before and after recovery. Prove byte equality privately. Do not publish reusable signed transactions, raw authentication signatures, session tokens, private keys, seed phrases, or privileged credentials.

Tag every observation with its evidence class. `fixture` uses synthetic data or fake adapters. `local` runs actual modules on the recorded checkout. `real database` uses the real Postgres operations. `real browser wallet` includes actual extension prompts. `Devnet` uses live RPC observations. `hosted Devnet` additionally uses the public deployed app. Combine tags when a scenario crosses those boundaries.

Simulation and preflight rejection are `Devnet` observations only when the real RPC produced them. Neither proves a landed transaction or rollback. Optional scenario 14 defines the separate proof required only if the team claims demonstrated on-chain rollback.

## Run local checks separately

All rows are **NOT RUN**. Use actual test entry points once they exist. Record their commands and outputs separately from the integrated scenarios.

| Setup | Action | Observable expected outcome and required proof | Evidence class |
| --- | --- | --- | --- |
| A fixed two-payer and three-payer message with synthetic keys. | Omit a signature. Upload invalid, unexpected, stale, and changed-message signatures. | Only valid signatures for the exact attempt, message, and expected signer enter collection. Save assertions for each variant. | `local` and `fixture` for synthetic inputs. |
| Valid payment payload fixtures. | Change seller, amount, mint, program, fee payer, signer set, account permissions, or instructions one at a time. | Validation rejects every mutation before a wallet prompt. Save each mutation and result. | `local` and `fixture`. |
| Fake wallet, account data, block height, and AttemptStore. | Reject approval, remove funds, expire a message, race preparation and signature writes, and request retry. | State transitions preserve signatures and block unsafe replacement. Save assertions, including fresh signatures after safe expiry. | `local` and `fixture`. No real database claim. |
| Fake RPC with controlled pause and response loss. | Repeat submit, restart the coordinator, and drop a send response. | Every send uses the stored bytes and reference. Unknown outcomes remain unresolved. Save the call trace and state assertions. | `local` and `fixture`. No chain or durable recovery claim. |

## Run the integrated scenarios

Every scenario remains **NOT RUN**. The proof below supplements the common records. Endpoint names come from the [HTTP contract](../contracts.md#http-operations); they are not implemented at the inspected baseline.

### 1. Missing signature

- Setup. Prepare a ready checkout and collect only one payer's real sign-only approval.
- Action. Call `POST /api/attempts/:attemptId/submit`. Separately simulate the incomplete transaction through the real RPC with signature verification enabled and no blockhash replacement.
- Expect. Submit returns `SIGNATURES_INCOMPLETE`. No submission claim, broadcast, or success receipt follows. RPC simulation rejects the incomplete signer set.
- Proof. Save the signature count, HTTP response, database state, RPC simulation rejection, and common balance records. Use `real browser wallet`, `real database`, and `Devnet`. Label the simulation as rejection, not a landed failure.

### 2. Invalid or unexpected signature

- Setup. Keep an attempt open for signing and retain one valid signature for comparison.
- Action. Call the signature endpoint with malformed bytes, a wrong-key signature, and a signature for different message bytes. Try an unexpected wallet's authenticated session separately.
- Expect. Authentication, signer, or signature checks reject each request with the applicable documented error. No invalid signature enters storage or completes submission. An identical valid upload remains idempotent.
- Proof. Save each rejected request variant without secrets, its error, and the unchanged signer rows. Use `real database` and `real browser wallet` for the valid control.

### 3. Stale signature upload

- Setup. Safely resolve an old attempt, then explicitly create a new attempt for the unpaid checkout. Retain an old signature privately.
- Action. Upload the old signature to the closed attempt. Upload its old `messageHash` and signature to the new attempt.
- Expect. The old attempt refuses collection. The new attempt rejects the message mismatch. No signature carries forward. Every payer must approve the new message.
- Proof. Save both attempt IDs and hashes, rejection responses, signer rows, and fresh approval records. Use `real database` and `real browser wallet`.

### 4. Message tampering

- Setup. Capture a valid signing payload in the controlled test environment.
- Action. Mutate seller, amount, mint, program, fee payer, signer set, account permissions, and extra instructions individually. Test a wallet-returned transaction with changed message bytes separately.
- Expect. Browser validation rejects altered payment contents before approval. The wallet bridge rejects changed returned bytes. Server verification accepts no changed-message signature.
- Proof. Save the mutation, browser result, prompt count, upload response where applicable, and signer rows for every variant. Use `local` for validation tests and `real browser wallet` plus `real database` for integrated observations.

### 5. Wallet rejection

- Setup. Collect one payer's signature and open another payer's approval prompt.
- Action. Reject that prompt. Attempt another signature upload and request a replacement. Repeat decline after submission has already been claimed in a separate run.
- Expect. Before submission, decline stops collection and produces no success receipt. The UI never describes issued signatures as revoked or the payment as immediately canceled. `canRetry=false` blocks replacement while authorization remains usable. After submission, decline reports the existing attempt and reconciliation continues.
- Proof. Save the real rejected prompt, state transitions, refused upload or retry, and refreshed UI. Use `real browser wallet`, `real database`, and `Devnet` when a submission exists.

### 6. Insufficient USDC

- Setup. Give one payer less than their exact share before preparation. Keep the other accounts and organizer's fee funds valid.
- Action. Prepare the attempt. For a separate preflight case, sign while funded and pause just before RPC send. Reduce one payer's balance with a separately recorded spend. Resume with preflight enabled.
- Expect. The app explains the deficient payer's USDC shortage. Local account validation returns `INSUFFICIENT_USDC`. Neither case reports successful partial seller payment. A preflight error does not release still-usable authorization.
- Proof. Save integer balances, the deficient share, error, and persisted state. Identify which case stopped at validation and which reached preflight. Account for the deliberate spend separately. Use `real database` and `Devnet`, plus `real browser wallet` for the preflight case. Use scenario 14 for any rollback claim.

### 7. Insufficient fee SOL

- Setup. Keep token accounts prepared and USDC balances adequate. Give the organizer less SOL than the fee estimate for the message.
- Action. Prepare the attempt. Compare with a control in which the organizer has enough SOL and another payer has none.
- Expect. The organizer shortage returns `INSUFFICIENT_SOL` with a useful next action. Another payer's SOL balance does not prevent signing when the organizer pays the fee and accounts already exist.
- Proof. Save the fee estimate, organizer lamports, error, control result, and any actual landed fee. Use `Devnet`, `real database`, and `real browser wallet` for the control. Do not claim zero fees from the error alone.

### 8. Expired message and fresh retry

- Setup. Record an attempt's fixed message and lifetime. Delay completion until the observed block height exceeds `lastValidBlockHeight`.
- Action. Refresh and reconcile the old transaction, including chain history when a reference exists. Try retry before resolution. After the server establishes safe non-settlement, explicitly request retry using the latest `retryOfAttemptId`.
- Expect. Elapsed wall time or a missing status alone never enables retry. Inconclusive evidence remains unresolved with `canRetry=false`. Safe expiry permits a new attempt, blockhash, and message with no old signatures. Every payer approves again.
- Proof. Save height and history observations, retry responses, old and new IDs and hashes, signer rows, and fresh prompts. Use `Devnet`, `real database`, and `real browser wallet`.

### 9. Double prepare

- Setup. Use a full ready checkout with no active attempt and an authenticated organizer.
- Action. Release concurrent `POST /api/checkouts/:checkoutId/attempts` requests through independent handlers. Repeat after the message is published.
- Expect. Requests return one active attempt with one frozen participant set and message. Duplicate preparation never creates a replacement. A late preparation worker cannot overwrite the published message.
- Proof. Save request timing, responses, database rows, and message hashes. Use `real database`. An in-memory lock or fake store is insufficient.

### 10. Concurrent signature uploads

- Setup. Obtain valid approvals from distinct payers for the same frozen message.
- Action. Release their signature uploads concurrently through independent authenticated requests. Repeat the identical uploads.
- Expect. Every valid signer row survives. Duplicates are harmless. Completion creates only one immutable submission identity.
- Proof. Save upload responses, signer rows, submission record, and private byte-equality checks. Use `real browser wallet` and `real database`. Add `Devnet` for any broadcast and result.

### 11. Double submit

- Setup. Collect all valid signatures. Pause the automatic submit path to race it with explicit submit requests.
- Action. Release concurrent submits and repeat after submission-lease recovery.
- Expect. Signed bytes and their derivable reference are durable before the first RPC send. Every send uses that identity. Multiple identical broadcasts are allowed. A successful control has one finalized payment, exact payer debits, and one seller credit for the total.
- Proof. Save persistence-before-send ordering, lease results, byte digests, RPC references, and finalized transaction metadata. Use `real database`, `real browser wallet`, and `Devnet`. Do not require exactly one RPC call.

### 12. Refresh during submission and server restart

- Setup. Pause after durable submission preparation but before send. Separately pause after send but before outcome persistence.
- Action. Restart the server. Reload every payer's browser and resume authenticated refresh. Also verify restoration during signing, after one stored signature.
- Expect. The same participants, signatures, attempt, message, bytes, and reference survive. Recovery checks the stored reference before any appropriate identical resend. No replacement appears. A reference alone never renders success.
- Proof. Save database snapshots across process loss, process restart records, reopened browser states, and RPC observations. Use `real database`, `real browser wallet`, and `Devnet`. A restart of an in-memory fake does not satisfy this case.

### 13. Lost RPC response

- Setup. Prepare a valid fully signed payment and persist its reference before send. Place a response-loss hook after forwarding the real RPC request.
- Action. Drop the response, then refresh from another authenticated payer. Restore connectivity and continue reconciliation.
- Expect. A timeout preserves the existing identity and blocks replacement. If the payment settled, the app recovers its finalized, error-free receipt. An unknown result remains unresolved. Any resend uses identical stored bytes while valid.
- Proof. Save forwarding and dropped-response records, the pre-send reference, subsequent status observations, and final balances and fee. Use `real database`, `real browser wallet`, and `Devnet`. A fake timeout alone cannot prove recovery after real broadcast.

### 14. Optional landed failed transfer and rollback

Run this scenario only to support a demonstrated on-chain rollback claim. P5 permits accurate preflight-only evidence without this experiment.

- Setup. Use a separate disposable Devnet checkout. Obtain approvals while all transfers are valid. Make a later payer unable to fund their transfer with a separately recorded spend, leaving the first transfer valid and fee SOL available.
- Action. Send the original signed transaction through a test-only runner with preflight disabled. Keep production preflight enabled. Wait for a finalized transaction with an execution error at the later transfer.
- Expect. Only a landed execution failure can support this claim. Transaction metadata shows no purchase token movement for any payer or the seller, despite the earlier valid transfer. Record the charged network fee separately. No success receipt appears.
- Proof. Save the original message hash, preparation and funding-spend references, failing transaction reference, instruction error, transaction token balances before and after execution, account observations, and `meta.fee`. Use `real browser wallet` and `Devnet`. Add `real database` for app outcome reconciliation. Exclude the deliberate funding spend from the failed purchase's deltas. If only simulation or preflight rejects, label that result and leave rollback **NOT PROVED**.

### 15. Replacement safety and stale outcomes

- Setup. Retain a usable declined authorization, an uncertain post-send result, and a preflight rejection in separate checkouts.
- Action. Request replacement for each checkout through the API and UI. Switch accounts during a pending prompt. Expire a session and reauthenticate the same payer. After definitive resolution, deliver a delayed earlier RPC result.
- Expect. Unsafe replacement returns `RETRY_BLOCKED` and the UI uses server `canRetry`. Account changes clear prior identity and the pending prompt without uploading under another wallet. Reauthentication resumes the same attempt. Stale results cannot regress a definitive outcome. A paid checkout refuses another attempt with `CHECKOUT_PAID`.
- Proof. Save request responses, state history, prompt handling, refreshed screens, and immutable identities. Use `real database`, `real browser wallet`, and `Devnet` for chain-dependent states.

## Assess P5 completion

Leave P5 incomplete until each required scenario has observed results and linked proof against the integrated revision. Explain token balances and any fee for every case. Show that failed or rejected purchases never produce a successful partial seller payment, and that recovery preserves transaction identity.

Scenario 14 is optional when the team makes no demonstrated rollback claim. Its absence does not block P5 completion if the required cases pass and the report accurately labels preflight-only evidence.

Keep unresolved observations unresolved. Record whether each claim comes from local execution, preflight, a landed failure, or a finalized success. A checklist, fixture, or screenshot without the underlying observation cannot close P5.
