# OneTab specification

OneTab lets two or three people authorize and pay for one shared purchase with USDC on Solana. Each payer approves a contribution from their own wallet. One transaction contains every contribution transfer to the seller.

This document defines the agreed 24-hour hackathon MVP. It describes the target behavior, not a completed or production-ready payment system. Wallet compatibility and exact Solana package versions remain unverified until [P1](https://github.com/nefalos-tech/OneTab/issues/1) passes with real browser wallets.

The [Kanban board](https://github.com/orgs/nefalos-tech/projects/10) owns task status, estimates and scheduling. This file owns product behavior and invariants. [Architecture](docs/architecture.md) defines the stack and module boundaries. [Contracts](docs/contracts.md) defines the initial integration agreement. [Development](docs/development.md) and the [card index](docs/implementation-map.md) explain how to start. [AGENTS.md](AGENTS.md) owns the agent workflow. Shared TypeScript contracts become the executable interface reference when B1 implements them.

## MVP boundaries

| Area | Agreed behavior |
| --- | --- |
| Platform | Desktop browser app at a public URL |
| Stack | Next.js App Router, React, TypeScript and Supabase Postgres |
| Network and asset | Solana Devnet and the verified Devnet USDC mint, labeled as test assets |
| Wallet support | One desktop wallet integration proven in P1 before broader compatibility claims |
| Participants | Two or three distinct payer wallets, including the organizer |
| Split | Equal contributions, with deterministic remainder allocation in integer token units |
| Seller | A separate test wallet with a prepared receiving token account |
| Network fee | Paid in SOL by the organizer, separately from their USDC contribution |
| Custody | Contributions move directly from payer token accounts to the seller token account |
| Execution | Existing Solana token-transfer instructions in one transaction, with no custom program |
| Coordination | Server routes, persisted state and polling |

Mobile wallets, card and bank payments, in-app funding, swaps, custom splits, expense history, refunds, merchant integrations and purchase protection are outside this MVP. Demo wallets and token accounts are prepared before checkout.

## Roles and screens

The organizer creates the checkout, occupies the first payer slot and starts a payment attempt once everyone is ready. Each participant controls only their own readiness and wallet approval. The seller receives the payment and does not need to join the room or sign.

### Create checkout

The organizer enters a title, seller wallet, positive USDC total and participant count. A review step shows the network, seller, total and exact individual shares. The organizer connects and authenticates a wallet at the review step, before creating. If that wallet is the seller, the review returns to the form ([F3](docs/cards/F3.md)).

Creating the checkout fixes the seller, total and participant count. Corrections require a new checkout. The app returns a shareable room link.

### Shared checkout room

Anyone holding the link may view the room and authenticate a distinct wallet to claim an open slot. The organizer already counts as a payer. A wallet cannot occupy two slots, and concurrent joins cannot overfill the room. Rejoining with the same wallet returns its existing slot. Joining closes when the room is full.

The room shows the seller, total, all payer wallets, individual shares and shared progress. The current payer's contribution is prominent. Ready is a coordination action and does not authorize spending.

Once the room is full and everyone is ready, the organizer starts an attempt. Its participant snapshot is frozen. Each browser validates the entire proposed payment before requesting a sign-only wallet approval. Ready and Signed have separate visual states. An account switch clears the prior identity and pending prompt locally.

### Payment result

All participants observe the same attempt and result. The result distinguishes submitting, unresolved, confirmed, failed, declined and expired states.

A confirmed receipt shows the seller, total, every contribution, the transaction reference and a Devnet explorer link. Success requires an observed confirmation result without an execution error. A returned transaction reference alone is insufficient.

Refreshing or reopening the link restores the persisted room and attempt. An unresolved result continues checking the existing transaction and does not offer an unsafe replacement payment.

## Payment flow

1. The server verifies the authenticated organizer, complete participant set and readiness. The database reserves one active attempt atomically.
2. Payment code validates the configured network and mint, token-account ownership, seller destination, allowed programs, signer set, fee payer and exact amounts. Missing accounts or funds produce an actionable error.
3. The server builds one USDC transfer per payer, selects a fresh blockhash and records its last valid block height. It stores the exact message bytes, message hash and payment summary before returning a signing payload.
4. Every browser compares the decoded transaction with the expected room and contribution details. Each wallet signs the same message without broadcasting an individual payment.
5. The server verifies each signature against the expected payer and stored message. It merges signatures by signer slot. Identical uploads are idempotent, and concurrent uploads preserve all valid signatures.
6. After every required signature is valid, the server claims submission atomically. It stores the fully signed transaction bytes and derivable transaction reference before sending anything to the RPC.
7. The server submits and reconciles that transaction. Polling and persisted state let another request resume confirmation after a timeout, refresh or server restart.

Changing the blockhash, fee payer, instructions, accounts or amounts changes the signed message. A replacement message always requires fresh approvals from every payer.

## Attempt states and retries

The names below define behavior. [contracts.md](docs/contracts.md) defines their wire representation. B1 publishes the executable shared contracts before the lanes integrate.

| State | Meaning and allowed progress |
| --- | --- |
| Preparing | An attempt is reserved while validation and message construction run. It advances to Signing after the fixed message is stored. A construction failure with no usable authorization can close the attempt. |
| Signing | The fixed message is available and verified signatures are collected. Complete signatures permit submission. Rejecting in the wallet sends nothing. A payer who declines stops collection ([F4](docs/cards/F4.md)). Expiration requires reconciliation. |
| Submitting | The submission claim and signed bytes are persisted. The server sends or checks that exact transaction. |
| Unresolved | The network outcome is unknown. Reconciliation continues for the same transaction. A replacement is blocked. |
| Declined | A payer declined and collection stopped ([F4](docs/cards/F4.md)). This does not revoke signatures or prove the message can no longer settle. The attempt remains blocking until safely resolved. |
| Confirmed | The transaction reached the required confirmation level without an execution error. This checkout is paid and cannot create another payment attempt. |
| Failed | A definitive failure is established. A local validation or preflight error alone cannot release a still-usable signed message. |
| Expired | The block-height limit was exceeded and chain-status reconciliation established that the attempt did not settle. A fresh attempt needs fresh signatures. |

The normal room flow is Open, Ready, Signing, Submitting and Confirmed. Room readiness and payment-attempt state are distinct.

Only one active or unresolved attempt may exist per checkout. Declined attempts remain part of this restriction while their authorization could still be usable. If the outcome cannot be established, the state remains Unresolved.

Retry is explicit. It is allowed only after the previous attempt is safely resolved and the checkout is unpaid. It creates a fresh attempt ID and message, with no signatures carried forward. A countdown can explain the wait, but block height determines expiration.

## Data and shared contracts

Amounts use integer units of the configured mint. JSON carries those integers as decimal strings, never floating-point currency values. Binary data uses base64. Participants receive stable slot numbers. The first remainder slots receive one extra unit, so shares always sum exactly to the total. Input validation rejects totals that would leave a payer with a zero share.

| Record | Required information |
| --- | --- |
| Checkout | ID, title, organizer wallet, seller wallet, network, mint, total units, payer count and payment result |
| Participant | Checkout ID, stable slot, wallet, share units and readiness |
| Payment attempt | ID, checkout ID, frozen participants, exact message and hash, blockhash, last valid block height, state and observed error |
| Collected signature | Attempt ID, expected signer and verified signature |
| Submission | Attempt ID, fully signed bytes, transaction reference and submission claim |
| Receipt | Attempt ID, transaction reference, observed confirmation level, execution result and payment summary |
| Authentication | One-time expiring challenge and short-lived server-validated wallet session |

The agreed interface boundaries are:

| Contract | Responsibility |
| --- | --- |
| RoomSnapshot | Immutable checkout details, ordered participants, shares, readiness and current attempt summary |
| SigningPayload | Attempt ID, serialized transaction, exact message bytes and hash, payment summary and lifetime |
| WalletBridge | Connect a wallet, sign an authentication challenge and sign a transaction without broadcasting |
| AttemptStore | Reserve an attempt, freeze its message, persist verified signatures, claim submission and record outcomes |

Backend owns the shared definitions and example responses. Payments supplies the transaction fields and validator. Frontend builds against fixtures until real routes are ready. Payment orchestration depends on AttemptStore. Database helpers do not import payment orchestration.

The API operations are public configuration, create/read checkout, issue/verify authentication challenge, read/end session, join, mark readiness, prepare attempt, retrieve signing payload, upload signature, decline, submit and refresh payment status. [contracts.md](docs/contracts.md) fixes their initial paths, response fields and error codes. B1 implements that agreement and coordinates any required corrections. These routes do not exist yet.

## Authentication and trust boundaries

Wallet connection alone is not authentication. A one-time challenge binds the wallet, intended origin/domain, purpose and expiration. Successful verification creates a short-lived server-validated session. Replay, wrong-wallet, wrong-origin and expired challenges fail.

State-changing routes enforce the wallet session and relevant role. Only the organizer prepares an attempt. Only a payer updates their readiness or supplies their expected signature. Cookie-based sessions include appropriate same-origin/CSRF protection. A client-supplied address is never sufficient authorization.

Supabase grants and row-level security prevent unauthorized direct access. Privileged database credentials remain on the server. Wallet private keys and seed phrases never enter the backend, database, source control or evidence files.

Signing does not reserve a balance. Atomic execution prevents a successful partial group transfer, but does not guarantee checkout success. Failed execution can still charge a network fee. A receipt proves the observed payment, not delivery of a purchase or refund protection.

Checkout uniqueness is enforced by the application for this MVP. A memo or checkout ID is not an on-chain duplicate-order rule. Already-issued signatures cannot be revoked by an app Cancel action.

## Parallel ownership

| Owner | Responsibility | Proposed file boundaries |
| --- | --- | --- |
| @kyusuku | Message construction, payment validation, signatures, submission and reconciliation | Payment modules, payment routes and payment evidence |
| @Quantomz | Screens, wallet UI, polling UX and desktop acceptance | App pages/layout, components, wallet bridge, root manifest and lockfile |
| @SophiaChua | Contracts, wallet sessions, rooms, attempt persistence, hosting and demo | Contracts/fixtures, auth/room routes, AttemptStore, migrations and deployment/demo docs |

These paths are prospective until scaffolding exists. Backend owns shared-contract edits and coordinates changes with both consumers. Frontend owns dependency-file changes and adds the versions proven by Payments. Each contributor works on a separate branch and stays within the card's scope.

All three lanes start after a short contract agreement. [P1](https://github.com/nefalos-tech/OneTab/issues/1) proves wallet signing in an isolated experiment. [F1](https://github.com/nefalos-tech/OneTab/issues/7) builds fixture screens. [B1](https://github.com/nefalos-tech/OneTab/issues/13) publishes contracts and schema. Each lane has six cards and 16 estimated work hours. These are planning budgets, not guarantees.

## Acceptance criteria

| Scenario | Required evidence |
| --- | --- |
| Two-payer feasibility | Two separate browser-wallet approvals produce one confirmed seller transaction. Record the wallet, browser and pinned package versions. |
| Three-payer demo | Three wallets contribute 2 test USDC each in one 6-USDC purchase. The separate seller receives the expected total. |
| Message tampering | Modified seller, amounts, mint, fee payer, programs or signer set fail validation before approval or signature acceptance. |
| Signature integrity | Missing, invalid, unexpected or stale signatures cannot complete payment. Concurrent valid uploads are preserved. |
| Join concurrency | Concurrent claims cannot overfill a room or give one wallet multiple slots. |
| Rejected prompt | No successful purchase is reported. Issued signatures are not described as revoked. |
| Insufficient funds | The app explains the USDC or SOL shortage. No successful partial seller payment is reported. |
| Expiration | The old attempt is reconciled, and a replacement requires every payer to approve a new message. |
| Duplicate requests | Repeated prepare/submit requests reuse the existing attempt and transaction identity. |
| Lost response | A timeout after broadcast resolves by checking the same transaction and never starts another payment automatically. |
| Restart and refresh | Persisted state restores participants, signatures, submission identity and the shared result. |
| Public deployment | The desktop flow works on separate profiles or computers at the public URL. Privileged database keys are absent from the browser bundle. |
| Final submission | The public repository, app URL, demo video and required MLH form fields are present, with submission confirmation saved. |

A preflight rejection proves validation, not blockchain rollback. A rollback claim requires a controlled integration test with a failing transfer and observed balances. The demo uses only behavior that the evidence supports.

## Delivery checkpoints and unresolved choices

The targets are a two-wallet proof by hour 4, integrated sessions/rooms by hour 8, a hosted two-payer checkout by hour 12 and three-payer/failure checks by hour 16. Feature scope freezes by hour 18. The final six hours cover fixes, hosted verification, rehearsal and submission.

P1 resolves wallet compatibility, library versions, the Devnet RPC and mint/account setup. B1 implements the documented contracts and coordinates corrections found during integration. F1 pins the application toolchain. B5 resolves the hosting provider and deployed session configuration. Their owners record these choices in the code and update the relevant documents when behavior changes.

Whether the public room names why a payment stopped is still open. Today the room masks every stop code, so only the organizer's own page can name an underfunded wallet, and only until it reloads. Projecting the real code, F5's handoff H1 in [the F5 card](docs/cards/F5.md), would show every viewer the cause and its next step. It would also tell anyone with the link that a payer was underfunded, though not which one. The choice is deferred until after demo day or the next development decision, and the team agrees on it before Backend ships it.

The demonstration shows one complete group checkout and one accurately described failure. MLH's standard digital-event rules call for a public video of at most two minutes, the event name at its start, public source code and AI-tool disclosure. The signed-in submission form must still be checked for event-specific fields.

The official schedule lists initial submission on November 8, 2026 at 22:00 and final submission at 23:45 in Asia/Bangkok. The main event page lists a later cutoff. The team plans to the earlier schedule and checks for organizer updates.

## References

- [OneTab board](https://github.com/orgs/nefalos-tech/projects/10)
- [Solana partial signing](https://solana.com/docs/core/transactions/partial-signing)
- [Solana confirmation and expiration](https://solana.com/developers/cookbook/transactions/confirmation)
- [Solana transactions and fees](https://solana.com/docs/core/transactions)
- [Solana frontend guidance](https://solana.com/docs/frontend)
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Official hackathon schedule](https://events.mlh.com/events/15200-solana-hackathon)
- [MLH submission page](https://www.mlh.com/events/solana-hackathon)
- [MLH standard rules](https://github.com/MLH/mlh-policies/blob/main/standard-hackathon-rules.md)
