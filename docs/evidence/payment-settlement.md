# P4 application settlement

The goal is to preserve one signed payment identity across concurrent requests, lost responses, and process restarts. This increment connects P4 to the published B1 `AttemptStore` interface. [P4 issue #4](https://github.com/nefalos-tech/OneTab/issues/4) remains subject to real B4 and hosted acceptance.

## Application contract

`src/server/payments/settlement.ts` exports `createPaymentProgress(deps)`. It returns `(attemptId: string) => Promise<StoredAttempt>` for P3's submit, refresh, and final-signature paths.

Dependencies are `store: AttemptStore`, `readCheckout: (checkoutId: string) => Promise<Checkout | null>`, `config: PublicConfig`, and `rpc: PaymentRpc`. Optional dependencies are `now: () => Date` and `backendAssurance`. Assurance defaults to `unverified`.

Each pass validates the frozen payload against trusted checkout data and the stored participant snapshot. It cryptographically re-verifies all complete signatures, assembles the exact signed bytes, and derives the organizer's transaction reference. Recovery requires both bytes and reference to match the persisted submission. `claimSubmission` must atomically persist that identity and claim the lease before any RPC call. A competing request rereads storage when it cannot claim.

The lease holder observes the existing reference before considering a send. It can send the same bytes once per pass while the processed block height remains within the original lifetime. It rechecks the lease after that height read. A returned RPC reference must equal the derived reference. Send errors and timeouts remain unresolved. No path creates a replacement message or refreshes the blockhash.

Finalized success requires matching status and transaction slots, exact canonical signed bytes, agreement about execution success, every exact payer and seller token delta, and complete SOL fee evidence. The B1 receipt preserves participant slot order and includes the Devnet explorer URL and observation time. B4 must atomically record confirmation and mark the checkout paid. A finalized execution error can close authorization but does not imply refunded network fees.

## Bounded expiry policy

The observation adapter retains absent, processed, confirmed, finalized, unknown-commitment, and unavailable cases. It does not use the spike's collapsed `pending` value for expiry.

For a known, validated submission, reads are ordered as follows.

1. F reads `getEpochInfo` at finalized commitment and retains its absolute slot and block height.
2. S reads one signature from the recent cache with `searchTransactionHistory: false`.
3. For missing S after lifetime L, P reads the processed slot with S's context as `minContextSlot`.

Safe expiry requires explicit `coherent_backend_and_retention_established` assurance, `L >= 150`, `F.blockHeight > L`, `S.context.slot >= F.absoluteSlot`, and `P >= S.context.slot`. It also requires `F.blockHeight + P - F.absoluteSlot - (L - 150) < 300`. The final read bounds cache advancement after S captured its context. A shared URL alone does not establish backend coherence or retention.

These constants encode the reviewed recent-cache policy. The [clock constants](https://raw.githubusercontent.com/anza-xyz/solana-sdk/master/clock/src/lib.rs), [bank lifetime calculation](https://raw.githubusercontent.com/anza-xyz/agave/v3.1.8/runtime/src/bank.rs), [cache retention](https://raw.githubusercontent.com/anza-xyz/agave/v3.1.8/runtime/src/status_cache.rs), and [RPC lookup order](https://raw.githubusercontent.com/anza-xyz/agave/v3.1.8/rpc/src/rpc.rs) support that policy. Validator changes require revalidation. Production composition leaves assurance unverified unless its backend contract establishes these properties.

When the bound cannot establish absence, one history lookup may recover positive finalized evidence. Historical null, missing metadata, unavailable archives, nonfinal status, and inconsistent observations remain unresolved. A positive finalized result can resolve at any age. All transaction reads support the existing legacy format with `maxSupportedTransactionVersion: 0`.

## Verification and limits

The local tests generate real synthetic Ed25519 signatures. Each test owns its fake `AttemptStore` and RPC. The stateful test store implements only the published submission contract. It is not a production storage fallback.

The suite covers persisted-before-send order, concurrent lease claims, recovery after persistence before first send, lost responses followed by the same receipt, stale leases, changed bytes and signatures, wrong cluster, sanitized errors, and finalized metadata failures. Expiry tests cover equal lifetime height, strict greater height, cache age 299 versus 300, skipped-slot bounds, cache advancement during lookup, context regression, unverified affinity, and unavailable history. A finalized expired height cannot be undone by a later lower processed height.

Commands run on the application Node 24.22.1 toolchain are `npm run typecheck`, scoped ESLint, and `vitest run src/lib/payments src/server/payments`. Spike verification uses its Node 25.9.0 toolchain. Its lint, typecheck, build, and 91 non-loopback tests passed. The HTTP loopback test initially could not start its server in the sandbox. Its isolated rerun with local port access passed.

No live RPC, wallet, database, or hosted application call was made for this increment. A new progress instance over one fake store demonstrates orchestration recovery, not durable database survival. Real B4 fencing and atomic paid-state behavior remain integration requirements.

Incomplete signatures cannot claim submission. A declined or unresolved authorization without submission bytes has no agreed B1 reconciliation lease. Progress returns its stored blocking state without inventing a transition, reference, or address-history scan. This limitation includes missing organizer signatures after lifetime expiry. Safe expiry does not itself authorize or create another attempt.

Model the Domain shaped the separate observation and decision types. Make Operations Idempotent shaped exact persisted identity recovery. The throughput checkpoint kept frozen validation ahead of network work, assigned these P4 files to one writer, left P3 composition with its owner, and used B1 fencing only for the shared attempt invariant.
