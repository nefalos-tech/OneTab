# P2 local payment builder evidence

This increment supplies one browser-safe payment core for two or three payers inside `spikes/payment-proof/`. It advances [P2](https://github.com/nefalos-tech/OneTab/issues/2). B1 integration and the three-wallet Devnet acceptance remain pending.

## Domain and byte validation

`src/payment-core.ts` owns an immutable ordered payer tuple, bigint shares, canonical message construction, and unsigned transaction inspection. The first remainder slots receive one extra unit. Every contribution is positive and the total fits uint64.

The constructor snapshots the input and freezes the plan, contribution tuple, and contribution records. The builder and inspector copy byte inputs before asynchronous hashing. Callers treat returned byte views as readonly. Each inspection returns separate byte storage.

Construction fixes Devnet USDC, six decimals, the Token Program, organizer fee payment, legacy messages, a 400,000 compute-unit limit, and zero priority price. Inspection requires an independently trusted plan, blockhash, and message hash. It compares the entire message and unsigned transaction with canonical bytes, including every signature slot, account permission, instruction, and encoding.

`payment.ts` adapts the existing two-payer wire plan through `corePlanFromProofPlan`. Its plan field order, decimal strings, schemas, invitation flow, approvals, submission, and receipt remain the P1 interface. The shared core supplies the equal-share calculation and the only canonical message builder.

## Trust boundaries

The transfer message binds the seller token account. The seller wallet itself is absent from transfer bytes. Read-only account preparation verifies that the destination belongs to the expected seller. B1 must supply a trusted seller-to-destination mapping. P1 additionally compares a pinned `planHash` that covers its full display plan.

Solana message bytes include the blockhash and omit the last valid block height. Building with another valid height produces the same bytes. Core inspection takes no attempt ID or expiry claim. A future B1 adapter must compare those fields with the authenticated persisted attempt and checkout. The caller must obtain expected values independently of the received candidate.

P1 `inspectPayment` retains its existing outer contract. It does not add an independently pinned attempt ID or last valid height. `verifyApproval` and `assembleVerifiedApprovals` continue to require an already validated P1 frozen record. B1 must establish that record before signature verification or assembly.

## Deterministic P1 parity

The known-answer fixture in `test/payment.test.ts` was captured before runtime edits from P1 commit `d1fb9d63a62e544f9272f568101d898ff84c309c`. It uses fixed synthetic addresses, a fixed UUID, 4,000,001 units, and block height 100. It contains no private keys or signatures.

The fixture pins the full plan, message bytes, unsigned transaction bytes, and both hashes. Its plan hash is `3ccf9aeda8b7671bce1f24e26c2f52e0a98fdf57f274069b06164644a2bd2ca1`. Its message hash is `ed2300a9401acbdb1dd3bfe4704dc9146a503c3a1e94f7da1cb036081e1cbff7`.

After extraction, exact equality with that captured fixture passes. The complete bytes are literal test data, so the expected answer is independent of the new builder.

## Local verification

The Node tests use the installed Solana Kit codecs and Web Crypto. They independently decode both payer counts and check all transfers, sources, destinations, mint, authority, signer permissions, compute policy, and integer amounts. Mutations include third-payer instructions and roles, recomputed malicious hashes, changed pins, altered signature slots, extra accounts, instructions, versions, and bytes. The tests cover every remainder, uint64 limits, duplicate roles, and mutation through input aliases.

Run these commands from `spikes/payment-proof/`.

```sh
npm run lint
npm run typecheck
node --import tsx --test test/payment-core.test.ts test/payment.test.ts
```

These are local synthetic codec and cryptographic checks. Browser-wallet approval, chain execution, public deployment, B1 contracts, and persisted application attempts need separate evidence.
