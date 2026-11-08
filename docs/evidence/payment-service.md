# Payment application integration

P3 lets authenticated frozen payers contribute verified signatures to the current payment attempt. This implementation connects the promoted signature core to the B1 store interface, B2 session and origin guards, and B3 configuration and room reader. The production routes use the Postgres attempt store only when `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `SOLANA_RPC_URL` are present and valid. Otherwise they fail with `CONFIGURATION_UNAVAILABLE`. There is no memory store.

## Application interface

`createPaymentService` in `src/server/payments/service.ts` takes one dependency object containing `store`, `lifecycle`, `readRoom`, `config`, `rpc`, and `progress`. Its public operations take object arguments. `prepare`, `addSignature`, `decline`, `submit`, and `refresh` return `AttemptSummary`. `signingPayload` returns the frozen unsigned `SigningPayload` only in the current signing state.

Preparation reserves the attempt before claiming a preparation lease. The builder uses the reserved participant snapshot. The lease owner freezes the constructed payload before it can be returned. A lease miss rereads the same attempt. Refresh recovers preparation without reserving a replacement. A construction failure calls the separate fenced preparation-failure operation before returning a safe error.

Signature collection requires the session wallet in frozen membership and the attempt to be current. It checks the exact stored message hash, independently validates the frozen payment through P2, and verifies Ed25519 before insertion. Identical verified uploads return the stored result even after collection closes. New signatures after closure fail. The final accepted signature calls one injected progress pass. A failed pass leaves the accepted signatures stored. Replaying an identical upload returns the current attempt without invoking progress again. Submit or refresh resumes progress for that same attempt. Submission claims and network operations belong to P4.

`extractPaymentSignature` in `src/lib/payments/wallet-signature.ts` accepts `{ validated, wallet, transactionBytes }`. `validated` is P2's `ValidatedSigningPayload`. The adapter checks the wallet-returned transaction through the promoted core and returns the exact HTTP upload body `{ messageHash, signatureBase64 }`. The authenticated session supplies the signer on the server. F4's separate `WalletBridge.signPayment` result includes `signerWallet` from the account passed to this verifier, as required by B1. This helper performs no wallet connection, prompt, HTTP request, or broadcast.

## HTTP and runtime

`createPaymentHandlers` accepts injected session, origin, and service dependencies for local tests. The route modules select Node runtime and dynamic responses. Success and error responses use `Cache-Control: no-store`.

| Route | Operation |
| --- | --- |
| `POST /api/checkouts/:id/attempts` | Prepare with optional `retryOfAttemptId`. |
| `GET /api/attempts/:attemptId/signing-payload` | Read the frozen signable payload. |
| `POST /api/attempts/:attemptId/signatures` | Upload `messageHash` and `signatureBase64`. |
| `POST /api/attempts/:attemptId/decline` | Stop collection through the atomic lifecycle adapter. |
| `POST /api/attempts/:attemptId/submit` | Run one progress pass. |
| `POST /api/attempts/:attemptId/refresh` | Recover preparation or run one progress pass. |

All operations require the B2 wallet session. Mutations require B2's matching origin. Payload GET does not require an Origin header. Body fields cannot override the session wallet. Unknown body fields, malformed UUIDs, invalid hashes, and oversized encodings fail at the HTTP boundary.

`readPaymentRoom` unwraps the real B3 result union. It preserves service failures and maps only `CHECKOUT_NOT_FOUND` to null. It copies readonly participant, signed-wallet, and receipt-contribution arrays into the B1 shape. `createPaymentRuntime` accepts explicit store, lifecycle, and RPC ports for tests. With no ports, it reads the durable environment and supplies B3's reader and public configuration. It constructs P4 progress with that store, config, and RPC. The production handler calls this only after the session and origin guards. There is no production memory store or process-global adapter registration.

Public attempt responses project only B1 summary fields. They omit signature bytes, lease tokens, frozen transaction bytes, and signed submission bytes. Unknown observed error text becomes a fixed `RPC_UNAVAILABLE` message. `canRetry` requires a safely resolved failed or expired current attempt and an unpaid room. Reservation must enforce the same rule atomically.

## Required durable adapter behavior

The following is a Payments-local adapter contract. It does not claim changes to B1 or a B4 implementation.

`AttemptStore` implements the guarantees in `docs/contracts.md`. Reservation locks the checkout, rechecks organizer, readiness and payment state, freezes membership, and returns one current attempt. Duplicate preparation and duplicate explicit replacement requests return their existing attempt. Preparation fencing prevents a previous lease owner from freezing or failing the recovered attempt. `freezeMessage` writes the message once.

`putVerifiedSignature` checks current attempt, frozen membership and message identity atomically. It compares an already stored signature before rejecting closed collection. An identical signature returns the existing attempt, while a conflicting value fails with `IDEMPOTENCY_CONFLICT`. New signatures require signing state and never overwrite another payer's row. Its result reflects the atomic operation's stored state.

P3 requires this additional lifecycle interface from `src/server/payments/service.ts`.

```ts
interface PaymentLifecycle {
  declineAttempt(input: {
    attemptId: string;
    signerWallet: string;
  }): Promise<StoredAttempt>;
  failPreparation(input: {
    attemptId: string;
    leaseToken: string;
    error: ErrorCode;
  }): Promise<StoredAttempt>;
}
```

Decline atomically rechecks frozen membership and current attempt. It closes collection when submission has not won, preserves issued signatures, and leaves `safelyResolved=false`. If submission or a terminal outcome won the race, it returns that existing state. Decline does not revoke signatures.

Preparation failure requires the current, unexpired preparation fencing token, preparing state, and no frozen payload. It can mark the attempt failed and safely resolved only before a usable authorization is exposed. Stale workers cannot close a newly frozen or recovered attempt. No B1 `recordOutcome` token-domain assumption substitutes for this operation.

`boundAttemptStore` in `src/server/payments/store-boundary.ts` translates an exact B4 `Error` message that is a B1 `ErrorCode` into `new PaymentFailure(code)`. Database helpers do not import Payments. Any other adapter exception becomes `CONFIGURATION_UNAVAILABLE`. Arbitrary exception text is not a public error code.

The B1 insertion result has no `inserted` flag. Concurrent identical final-signature uploads can both observe completeness after atomic idempotent insertion. P4 must fence submission and network progress through its store claim. This is also required for concurrent submit and refresh requests. P3 does not claim exactly one network send from a request count.

## Local verification and limits

The root lint, route type generation, TypeScript, design check, and 1,039 tests passed with Node 24.22.1. The test command used at most two concurrent workers.

```sh
npm run lint
npm run typecheck
npm run design:check
npm test -- --maxWorkers=2
```

The focused Payments suite has 44 tests. It covers two and three synthetic payer keys, concurrent preparation, frozen membership, absent payload before freeze, stale preparation fencing, explicit replacement, preflight failures, concurrent uploads, changed bytes and signatures, verified duplicates after closure, decline races, public projection, HTTP guards, and fail-closed route composition.

The signature promotion separately passed 34 focused signature, payment-core, and P1 parity tests with Node 25.9.0, plus spike typecheck and build. The core algorithm and recorded proof artifacts are unchanged. Every spike import and browser bundle entry now uses `src/lib/payments/signature-core.ts`.

`TestAttemptStore` is a per-test mutable fake. It supports deterministic interleavings and actual synthetic Ed25519 signatures. These checks prove application behavior against the adapter contract, not Postgres locking, durable restart recovery, real wallet acceptance, RPC settlement, or hosted payment success. B4 persistence and lifecycle integration remain required. No live wallet, RPC send, remote database mutation, or deployment ran for this change.
