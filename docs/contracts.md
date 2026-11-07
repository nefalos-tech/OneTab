# Shared implementation contracts

This is the initial integration contract for the existing cards. B1 implements it in src/contracts/ and publishes matching fixtures. These endpoints and types do not exist yet. Change this document and the executable contracts together when integration requires a correction.

The [specification](../spec.md) owns product behavior. The [architecture](architecture.md) owns module boundaries. All routes below belong to the same Next.js application.

## Wire conventions

- JSON success responses use `{ "data": ... }`. Errors use `{ "error": { "code": "ROOM_FULL", "message": "This checkout is full." } }`.
- Checkout and attempt IDs are opaque UUID strings. Wallets, mint addresses, blockhashes and transaction references use their normal base58 text representation.
- Token amounts and lastValidBlockHeight use decimal strings. Amounts represent integer token units and must fit the token program's unsigned 64-bit range. No floating-point arithmetic determines transfers.
- Message bytes, serialized transactions and Ed25519 signatures use base64. messageHash is lowercase hex SHA-256 of the exact message bytes. A hash never replaces full decoded-payment validation.
- Timestamps use UTC ISO 8601. Participant slots start at zero, remain stable and determine remainder allocation.
- All room, session and attempt responses use Cache-Control: no-store. Browser requests use the same-origin session cookie. Secrets never appear in response errors.

## Public configuration

GET /api/config returns network, mint, tokenDecimals and confirmationTarget. The values come from validated server configuration. network is devnet and confirmationTarget is finalized. RPC URLs and database credentials are never returned.

The browser uses this response for labels and payment validation. Fixture mode provides an explicitly labeled test configuration without contacting the database or RPC. Production signing is disabled until valid configuration is present.

## RoomSnapshot

| Field | Meaning |
| --- | --- |
| checkout | id, title, organizerWallet, sellerWallet, network, mint, tokenDecimals, totalUnits, payerCount, createdAt |
| participants | Ordered records containing slot, wallet, shareUnits and ready |
| phase | open, ready, paying, paid or needs_attention, derived by the server from membership/readiness and the current attempt |
| attempt | null or the AttemptSummary below |

Derive phase in this order. A successful finalized receipt gives paid. Otherwise an attempt in declined, unresolved, failed or expired gives needs_attention. Any other existing attempt gives paying. Without an attempt, a full room with every payer ready gives ready, and all other rooms give open. needs_attention does not imply that retry is safe.

The public snapshot contains no session-specific flags. The frontend derives its membership from GET /api/auth/session. Endpoint authorization remains authoritative even if a button appears enabled.

AttemptSummary contains id, state, signedWallets, transactionReference or null, lastValidBlockHeight or null, error or null, canRetry and receipt or null. States are preparing, signing, submitting, unresolved, declined, confirmed, failed and expired. Their meanings come from [the spec](../spec.md#attempt-states-and-retries).

canRetry is a server decision. It is false until the prior authorization is safely resolved and the checkout is unpaid. A failed or declined label alone never enables a replacement. The receipt contains transactionReference, confirmationStatus, sellerWallet, totalUnits, ordered contributions, observedAt and the Devnet explorer URL.

## SigningPayload and WalletBridge

SigningPayload contains attemptId, checkoutId, transactionBase64, messageBase64, messageHash, blockhash, lastValidBlockHeight and payment. payment contains network, mint, tokenDecimals, sellerWallet, sellerTokenAccount, feePayerWallet and ordered contributions with slot, wallet, sourceTokenAccount and amountUnits.

transactionBase64 is a serialized signable transaction containing the fixed message and required signer slots. P1 proves the serialization and wallet-return behavior. The frontend must not edit the message or add instructions.

WalletBridge exposes these behaviors through B1's shared interface:

| Operation | Input and output |
| --- | --- |
| connect | Returns the selected wallet address and supported capabilities |
| disconnect | Clears the local connection and ends the server session |
| signAuthentication | Signs the exact challenge bytes and returns signatureBase64 |
| signPayment | Takes a payment the browser already checked against the screen and Payments' validator, requests sign-only approval as that payment's account, and returns only that account's signatureBase64. The caller uploads it with the payment's messageHash. It never sends or broadcasts |

If the wallet returns a serialized signed transaction, the bridge extracts only that wallet's signature and rejects changed message bytes. It never uploads an entire wallet-returned transaction as the server's authority. Rejecting or changing accounts clears the pending prompt and does not silently resubmit it.

## HTTP operations

Paths use :checkoutId and :attemptId as placeholders. The Next.js checkout directory uses [id] consistently across owners. Backend owns config, auth, checkout, join and readiness routes. Payments owns every attempt route.

| Method and path | Caller | Input | data on success |
| --- | --- | --- | --- |
| GET /api/config | Public | None | Public configuration |
| POST /api/auth/challenge | Public, rate limited | wallet | challengeId, messageBase64, expiresAt |
| POST /api/auth/verify | Public, rate limited | challengeId, signatureBase64 | wallet, expiresAt, with session cookie set |
| GET /api/auth/session | Public | Cookie if present | null or wallet and expiresAt |
| DELETE /api/auth/session | Session if present | None | null, with token invalidated and cookie cleared |
| POST /api/checkouts | Authenticated wallet | title, sellerWallet, totalUnits, payerCount, clientRequestId | RoomSnapshot |
| GET /api/checkouts/:checkoutId | Anyone with link | None | RoomSnapshot |
| POST /api/checkouts/:checkoutId/join | Authenticated wallet | None | RoomSnapshot |
| PUT /api/checkouts/:checkoutId/readiness | Member | ready boolean | RoomSnapshot |
| POST /api/checkouts/:checkoutId/attempts | Organizer | retryOfAttemptId, null for first attempt | AttemptSummary |
| GET /api/attempts/:attemptId/signing-payload | Member of that frozen attempt | None | SigningPayload |
| POST /api/attempts/:attemptId/signatures | Expected payer | messageHash, signatureBase64 | AttemptSummary |
| POST /api/attempts/:attemptId/decline | Expected payer | None | AttemptSummary |
| POST /api/attempts/:attemptId/submit | Member of that frozen attempt | None | AttemptSummary |
| POST /api/attempts/:attemptId/refresh | Member of that frozen attempt | None | AttemptSummary |

The server derives the acting wallet from the session. Clients never authorize a mutation by passing another wallet address. Seller wallets cannot claim payer slots. Checkout creation rejects a seller equal to the organizer.

Creating a checkout uses a client-generated UUID clientRequestId scoped to the authenticated organizer. An identical retry returns the same checkout. Reusing that key with different input returns a conflict. Creation and the organizer's slot commit together.

Rejoining returns the existing slot. Readiness updates are idempotent and blocked once an attempt has frozen the participants. A retry requires the exact latest retryOfAttemptId and canRetry=true. Duplicate preparation while an attempt is active returns that attempt, never another message.

Signature upload verifies the caller, expected signer, message and signature before storage. Identical uploads return the existing result. The final accepted signature triggers one bounded submit pass. Any frozen participant may call submit again to resume the same transaction. No missing signatures are synthesized.

Refresh performs one bounded progress pass for the existing attempt. It can recover preparation, submit complete signatures or reconcile stored submission identity. It never creates a replacement. F4/F5 call refresh while their authenticated member sees a blocking attempt, in addition to read-only snapshot polling. Details are in [request recovery](architecture.md#persistence-and-request-recovery).

Decline stops further collection if submission has not been claimed. It cannot revoke signatures. If submission already started, the response reports the current attempt and reconciliation continues. The room keeps a declined attempt blocked until the server can establish safe resolution.

Normal results use 200. New checkout or attempt creation may use 201. Unresolved network work returns the current AttemptSummary rather than an invented success or a generic retry instruction.

## Error codes

| HTTP status | Codes |
| --- | --- |
| 400 | INVALID_INPUT, INVALID_SIGNATURE, MESSAGE_MISMATCH, UNSUPPORTED_WALLET, INVALID_PAYMENT |
| 401 | UNAUTHENTICATED, CHALLENGE_EXPIRED, CHALLENGE_USED |
| 403 | FORBIDDEN, ORIGIN_MISMATCH |
| 404 | CHECKOUT_NOT_FOUND, ATTEMPT_NOT_FOUND |
| 409 | ROOM_FULL, ROOM_NOT_READY, CHECKOUT_PAID, ATTEMPT_NOT_SIGNABLE, SIGNATURES_INCOMPLETE, RETRY_BLOCKED, IDEMPOTENCY_CONFLICT |
| 422 | INSUFFICIENT_USDC, INSUFFICIENT_SOL, TOKEN_ACCOUNT_MISSING |
| 429 | RATE_LIMITED |
| 503 | CONFIGURATION_UNAVAILABLE, RPC_UNAVAILABLE |

An RPC error after a possible broadcast persists unresolved state. It does not free the checkout for another attempt. Frontend maps codes to useful messages and uses canRetry for payment replacement safety.

## AttemptStore

These are required operation semantics. B1 owns the TypeScript signatures and B4 implements the Postgres operations. A fake store supports P2 through P4 while Backend implements persistence.

| Operation | Atomic guarantee |
| --- | --- |
| reserveAttempt | Lock the checkout, check organizer/readiness/unpaid state, reject unsafe replacement, freeze participants, return the one current attempt |
| claimPreparation | Claim or recover a short lease for the same preparing attempt, returning a fencing token |
| freezeMessage | Write the message and lifetime once, conditional on the current preparation token and no existing message |
| putVerifiedSignature | Insert one verified signature per attempt/signer without losing concurrent signatures or accepting a closed collection |
| claimSubmission | Check all signatures, freeze signed bytes/reference once and claim a short lease with a fencing token |
| recordOutcome | Compare the current state/token, preserve definitive outcomes against stale responses, and commit the receipt and checkout-paid marker together |
| getAttempt | Return the immutable snapshot, message, signatures and submission data to authorized server code |

Decline, readiness changes and preparation use the same checkout/attempt locking rules. Every transition rechecks its preconditions inside the transaction. Network requests run outside database locks. Renewing a lease never changes a frozen message or transaction identity.

Preparing leases can be reclaimed only with a new fencing token. A late prior worker cannot publish its message. Submission recovery first reads the stored reference and reconciles it. If rebroadcast is appropriate, it uses the identical stored bytes. Definitive outcomes cannot regress to submitting or unresolved.

## Database constraints

| Record | Required database constraints |
| --- | --- |
| checkouts | Positive total, payer count 2 or 3, immutable payment fields, unique organizer/clientRequestId |
| participants | Unique checkout/wallet, unique checkout/slot, bounded slots, positive shares, foreign key to checkout |
| attempts | Foreign key to checkout, immutable frozen fields, one blocking attempt per checkout, stored lease tokens and expiry |
| signatures | Unique attempt/signer, signer belongs to frozen participants, foreign key to attempt |
| submissions | Unique attempt, unique transaction reference, immutable fully signed bytes |
| receipts | Unique attempt and transaction reference, finalized chain result and payment summary |
| auth_challenges | Expiration, single-use consumption and bound wallet/origin |
| wallet_sessions | Hashed random token, wallet, expiration and revocation |

The blocking-attempt constraint includes declined attempts until safe resolution. Store signatures as separate records instead of replacing a shared signature array. Cross-row invariants such as slot limits and readiness require transactional operations, not only application checks.

## Fixture handoff

B1 publishes complete configuration, RoomSnapshot, SigningPayload and error fixtures in src/fixtures/. Include open, full-but-not-ready, ready, signing, submitting, unresolved, declined, confirmed, failed and expired states. Include both canRetry=false and canRetry=true recovery examples.

F1 renders fixtures before database setup. F2 uses a fake WalletBridge until P1 supplies the supported wallet. Payment tests use a fake AttemptStore until B4 is ready. Fixture approval never enables a real broadcast and fixture receipts never count as chain evidence.
