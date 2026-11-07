# P4 local finalized-payment inspection evidence

This increment supplies reusable finalized-payment inspection for two or three payers. It advances [P4](https://github.com/nefalos-tech/OneTab/issues/4) while shared application contracts and storage remain pending.

## Trusted inputs and RPC evidence

`spikes/payment-proof/src/chain-inspection.ts` exports two pure synchronous functions. `parseSignatureStatus` parses the whole one-reference status response. `inspectFinalizedPayment` compares finalized transaction evidence with a trusted payment plan, pinned message, stored signed bytes, and stored reference.

The caller supplies a plan created by P2 and a message previously inspected against independently expected payment details. The caller also verifies signatures before storing the submission. P4 checks the shape and identity of those signed bytes. Signature cryptography remains the caller's prerequisite.

The inspector copies the stored message and transaction bytes. It requires canonical transaction serialization, the pinned legacy message, the exact payer signer set, a nonzero 64-byte signature for every signer, and the organizer in account zero. The organizer's actual signature must derive the stored reference. The fetched transaction must contain exactly the stored bytes in canonical base64.

RPC schemas stay private to the inspector. Status and metadata require an explicitly present, defined `err` field. A missing status or an earlier commitment stays pending, including an earlier execution error. Malformed status becomes unavailable. Null transactions, null metadata, malformed metadata, and identity disagreements stay unresolved.

## Finalized outcomes require agreement

Success requires finalized status and metadata that both report `err: null`. A definitive execution failure requires matching transaction identity, valid metadata, and non-null errors in both responses. The reported error details may differ because both responses still establish failure.

A null error in one response and a non-null error in the other produces `transaction_identity_or_metadata_mismatch`. This corrects the initial design's OR rule. The baseline P1 implementation declared these conflicting responses failed. The new regression failed against the exact baseline `rpc.ts` before the outcome-agreement change, then passed after the change. The existing agreeing finalized-error test still passes.

For successful execution, every payer source and the seller destination require exactly one pre-balance and post-balance record. The inspector checks the compiled account index, wallet owner, mint, decimals, and unsigned 64-bit amount. It rejects missing records, duplicates, ambiguous records for the same owner and mint, extra records, and an incorrect delta for any payer or the seller. Contribution order determines the evidence tuple even when compiled signer order differs.

SOL balance arrays must each cover every compiled account exactly. Every value and fee must be a nonnegative safe integer. Bigint comparisons require the organizer alone to lose the exact fee. Every other account must remain unchanged.

## P1 adapter parity and stricter malformed evidence

`rpc.ts` delegates evidence computation to the inspector. It retains network and genesis verification, conditional finalized transaction fetching, block-height checks, pending reasons, timestamps, explorer URLs, and the public two-payer receipt schema.

The baseline receipt assertion passed before extraction. It pins the complete public field set, seller total, ordered two-payer amounts, fee, reference, explorer URL, finalized commitment, slot, ISO timestamp, and exact RPC request parameters. It also passes after extraction.

Existing unresolved reasons retain their meanings. A null transaction yields `finalized_metadata_unavailable`. Identity mismatches and null metadata yield `transaction_identity_or_metadata_mismatch`. Token and SOL discrepancies yield their existing balance-evidence reasons. Malformed RPC structure returns `rpc_observation_unavailable`, matching the coordinator's prior exception fallback.

One baseline regression demonstrated a false receipt. Equal SOL arrays containing only the organizer's balance passed the old implementation. That fixture now produces `fee_balance_evidence_mismatch`. The before-change failure and after-change pass are recorded in the local task logs. Missing status `err` already caused the installed Zod version to throw. The adapter now returns the explicit unavailable observation directly.

## Local verification

The fixtures generate independent local Ed25519 keys and sign real P2 message bytes for both payer counts. Tests use the installed Solana codecs and Web Crypto. They exercise reference, wire, message, signer, version, commitment, missing-field, metadata, token-account, uint64, and SOL-evidence failures. Every payer and the seller receive separate pre-balance and post-balance mutations. The tests also cover conflicting finalized outcomes and errors whose details differ.

Run these commands from `spikes/payment-proof/` on Node 25.9.0.

```sh
npm run check
node --import tsx test/invite-navigation.mjs --playwright-module ../../node_modules/playwright/index.mjs
```

The complete isolated check passes lint, type checking, the Vite build, and all 80 Node tests. The existing browser command passes eight invitation cases and eight payment-core cases in headless Chromium 153.0.8010.12. The HTTP tests and browser fixtures require loopback access.

The task directory contains `p4-worker-baseline-check.log`, `p4-worker-red-regressions.log`, `p4-worker-red-conflicting.log`, `p4-worker-check.log`, and `p4-worker-browser.log`. The baseline check passed all 65 existing tests before changes. The red logs preserve the pre-fix failures. These logs are local run artifacts outside the repository.

## Combined cores and public chain verification

After combining P2, P3, and P4, the coordinator ran the same isolated checks on `b75c2ae7f7747bde2504b402c710a3014c66253b`. All 92 Node tests and 36 Chromium cases passed. The browser cases include eight invitation cases, eight P2 cases, and 20 P3 cases. The independent reviewer also passed 30 focused P4 tests with no unresolved findings.

The read-only verifier exercises all three cores against P1's original finalized Devnet payment.

```sh
node --import tsx evidence/verify-payment-cores.mjs
```

The coordinator ran it on clean revision `6863914fc2ed21ea386ce3aed6ceb97ac5db307b` with Node 25.9.0 at 2026-11-07 10:56:43 UTC. It rebuilt the pinned message with P2, verified both historical Ed25519 signatures and assembled the identical transaction with P3, and confirmed the finalized receipt with P4. Public transaction retrieval matched the recorded plan, message and signed-byte hashes, slot 519612865, both 2-USDC payer decreases, the 4-USDC seller increase, and the organizer's 10,000-lamport fee. The full output is in the task-local `p4-6863914-public-verification.json`.

This command uses only Devnet genesis, signature-status and transaction reads. It does not connect to a wallet or broadcast a transaction. The evidence is historical two-payer chain revalidation. Three-payer coverage remains synthetic.

## Integration limits

This evidence covers local synthetic signatures, codecs, metadata inspection, the existing P1 adapter, and read-only revalidation of P1's real two-payer payment. B1 integration, authenticated routes, atomic application persistence, submission leases, retry decisions, new browser-wallet approval, and hosted three-payer Devnet execution remain pending. P4's full card acceptance still requires those integration checks.

The inspector supplies no expiration, safe-retry, or replacement-payment decision. Existing P1 public chain evidence remains the source for its recorded Devnet experiment.
