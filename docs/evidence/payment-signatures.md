# Payment signature computations

This partial [P3](https://github.com/nefalos-tech/OneTab/issues/3) implementation provides browser-safe Ed25519 verification and deterministic two- or three-payer transaction assembly. It starts from P2 commit `17f09917ceef4d029b4aad04ecbb1d56d146e1c6`.

## Trust boundary

`signature-core.ts` accepts a `SignatureTarget` containing the P2 `PaymentPlan` and fixed `MessageCandidate`. Callers first run full P2 inspection against independently expected payment details. The signature module checks canonical transaction bytes, message agreement, legacy format, the organizer's first signer position, the exact expected signer set, and unsigned input slots.

`verifyPayerSignature` checks one expected wallet's nonzero 64-byte Ed25519 signature over the fixed message. `verifyWalletSignature` also requires canonical sign-only wallet output with the same message and no other populated signature slot.

`assembleSignedPayment` snapshots the target and entire signature collection before awaiting WebCrypto. It verifies every supplied signature on every invocation. Ordinary `PayerSignature` values carry bytes and a wallet address. They carry no verification brand or cached verification state.

`assembleTrustedSignatures` is synchronous and checks signature membership, shape, uniqueness, and completeness. Its caller supplies signatures already cryptographically verified against the fixed message. P1's existing SQLite transaction uses this path for immutable stored approval rows. The existing durable-submission check independently inspects and re-verifies stored data before dispatch or observation.

The explicit `incompleteDiagnostic` option permits missing signatures and retains their zero placeholders. It rejects malformed supplied signatures. Its reference is `null` until the organizer signature exists. The P1 adapter preserves its existing empty-string diagnostic reference.

Every operation copies caller-owned bytes before its first await. Returned arrays are fresh allocations. A caller can mutate returned arrays, so subsequent checked assembly verifies their current bytes again.

## P1 parity

Before adapter edits, deterministic synthetic Ed25519 test keys produced a captured signed transaction, reference, hash, and incomplete diagnostic. The committed `payment.test.ts` known-answer fixture compares the complete signed and diagnostic bytes with that baseline in both upload orders. The fixed synthetic seed bytes are public test material created for this regression.

- The fixed message hash is `0669f3477e1fc973442f0df43cbfd647d90bd7b1fd2ab257d8a6da4e4bfc3461`.
- The fully signed transaction hash is `d812e54e532ea8836d2182d149227637780478b34e61e1edc1b248c49f5e94e4`.
- The organizer-derived synthetic reference is `33Xojbf2raPCjgBV9un3Kj6kh2KhS3Py3Fw6fyrka7vxs61m9r1fbwf3YdVqaMPayNRfuJ9PjuDbQHb7HNXmKoqV`.

The two-slot `FrozenPayment`, `Approval`, and `Submission` types and exported adapter functions retain their existing wire shapes. The adapters delegate cryptography and assembly to the generic signature module and snapshot their mutable wire envelopes before awaiting.

The pre-extraction implementation failed two regression cases when a caller changed its payment message during asynchronous verification. The extracted adapter passes both cases. The new assembly boundary also snapshots transaction fields and every member of the approval collection before verification begins.

## Local verification

Run these commands from `spikes/payment-proof` with Node 25.9.0 and the repository's installed dependencies.

```sh
npm run check
node --import tsx test/invite-navigation.mjs --playwright-module ../../node_modules/playwright/index.mjs
```

The spike check passes lint, TypeScript, the production Vite build, and 77 tests. Existing SQLite concurrent-upload, crash-recovery, HTTP authorization, wallet, P2 construction, and RPC checks remain included.

The Chromium 153.0.8010.12 run passes eight invitation-navigation cases, eight P2 browser cases, and twenty P3 browser cases. The P3 test bundles the actual signature module with Vite. Chromium generates ephemeral Ed25519 keys, signs through native WebCrypto, verifies and assembles two- and three-payer transactions, and matches Node's assembled bytes and reference. The local browser server blocks and records external requests, and the run records zero external requests.

The focused signature cases cover all six three-payer upload orders, compiled signer order differing from contribution order, missing and duplicate signatures, unexpected wallets, zero and malformed signatures, wrong keys, old messages, changed wallet messages, other populated slots, noncanonical bytes, mutation during awaits, independent returned buffers, and synchronous incomplete diagnostics. A deliberately unverified nonzero-signature fixture demonstrates the trusted assembler's structural boundary and is rejected by checked assembly.

Three temporary negative controls removed cryptographic verification, input copying, or wallet-keyed placement. Each caused its focused regression test to fail. The implementation was restored after each control.

## Remaining integration

B1's executable contracts are still required for application integration. P3 authentication, attempt reservation, signability, durable idempotency, and concurrent application uploads depend on B2 through B4. This work supplies the independent signature computations. P1's local two-payer experiment continues to use its existing coordinator and SQLite store.

These results are local synthetic and browser computation evidence. The three-payer hosted checkout and real-wallet application acceptance remain open.
