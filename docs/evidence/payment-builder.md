# P2 local payment builder evidence

This increment supplies one browser-safe payment core for two or three payers inside `spikes/payment-proof/`. It advances [P2](https://github.com/nefalos-tech/OneTab/issues/2). B1 integration and the three-wallet Devnet acceptance remain pending.

## Domain and byte validation

`src/payment-core.ts` owns an immutable ordered payer tuple, bigint shares, canonical message construction, and unsigned transaction inspection. The first remainder slots receive one extra unit. Every contribution is positive and the total fits uint64.

The constructor is the runtime plan boundary. Both core operations expect trusted in-process plans created through that constructor. The private symbol assists typed call sites. Adapters reconstruct plans from validated wire values.

The constructor snapshots the input and freezes the plan, contribution tuple, and contribution records. The builder and inspector copy byte inputs before asynchronous hashing. Callers treat returned byte views as readonly. Each inspection returns separate byte storage.

Construction fixes Devnet USDC, six decimals, the Token Program, organizer fee payment, legacy messages, a 400,000 compute-unit limit, and zero priority price. Inspection requires an independently trusted plan, blockhash, and message hash. It compares the entire message and unsigned transaction with canonical bytes, including every signature slot, account permission, instruction, and encoding.

`payment.ts` adapts the two-payer wire plan through `corePlanFromProofPlan`. Its schemas, invitation flow, approvals, submission, and receipt use two payers. The parity fixture checks plan field order, decimal strings, hashes, and serialized bytes. The shared core supplies the equal-share calculation and the only canonical message builder.

## Trust boundaries

The transfer message binds the seller token account. The seller wallet itself is absent from transfer bytes. Read-only account preparation verifies that the destination belongs to the expected seller. B1 must supply a trusted seller-to-destination mapping. P1 additionally compares a pinned `planHash` that covers its full display plan.

Solana message bytes include the blockhash and omit the last valid block height. Building with another valid height produces the same bytes. Core inspection takes no attempt ID or expiry claim. A future B1 adapter must compare those fields with the authenticated persisted attempt and checkout. The caller must obtain expected values independently of the received candidate.

P1 `inspectPayment` accepts the attempt ID and last valid height from the incoming envelope. Future B1 checks must bind both to trusted attempt metadata. `verifyApproval` and `assembleVerifiedApprovals` continue to require an already validated P1 frozen record. B1 must establish that record before signature verification or assembly.

## Read-only preflight

`DevnetRpc.prepare` accepts a core plan. P1 setup reconstructs that plan from its two-payer schema. Preparation checks the Devnet genesis, mint layout, decimals, initialized state, and Token Program ownership. It then checks every payer source and the seller destination for the expected mint, wallet owner, supported state, and absent delegation, native-token mode, and close authority. Each payer must hold its exact contribution, including the third payer.

`checkFee` accepts the fixed message plus its fee payer. It queries `getFeeForMessage` for those exact bytes and requires the organizer balance to cover that quote. A null quote fails. Receipt observation, signature simulation, signing, and submission use the two-payer P1 methods.

Scripted tests encode mint and token data with the installed SPL Token codecs. They reject missing accounts, malformed envelopes and bytes, wrong owners and state, a third-payer USDC shortage, wrong genesis, insufficient organizer SOL, malformed fee values, and an unavailable quote. The new scenarios override every RPC call and perform local read-only checks.

## Deterministic P1 parity

The known-answer fixture in `test/payment.test.ts` was captured before runtime edits from P1 commit `d1fb9d63a62e544f9272f568101d898ff84c309c`. It uses fixed synthetic addresses, a fixed UUID, 4,000,001 units, and block height 100. It uses only public synthetic test data.

The fixture pins the full plan, message bytes, unsigned transaction bytes, and both hashes. Its plan hash is `3ccf9aeda8b7671bce1f24e26c2f52e0a98fdf57f274069b06164644a2bd2ca1`. Its message hash is `ed2300a9401acbdb1dd3bfe4704dc9146a503c3a1e94f7da1cb036081e1cbff7`.

After extraction, exact equality with that captured fixture passes. An independent review found that the new split helper could throw from Zod `safeParse` on an overflowing total. A failing regression reproduced that behavior. The P1 refinement now checks the existing canonical amount schema before bigint arithmetic, and malformed totals or contributions return validation failures. The complete bytes are literal test data, so the expected answer is independent of the new builder.

## Local verification

The Node tests use the installed Solana Kit codecs and Web Crypto. They independently decode both payer counts and check all transfers, sources, destinations, mint, authority, signer permissions, compute policy, and integer amounts. Mutations include third-payer instructions and roles, recomputed malicious hashes, changed pins, altered signature slots, extra accounts, instructions, versions, and bytes. The tests cover every remainder, uint64 limits, duplicate roles, and mutation through input aliases.

Run these commands from `spikes/payment-proof/`.

```sh
npm run lint
npm run typecheck
node --import tsx --test test/payment-core.test.ts test/payment.test.ts test/rpc.test.ts
npm run check
node --import tsx test/invite-navigation.mjs --playwright-module ../../node_modules/playwright/index.mjs
```

On Node 25.9.0, `npm run check` passes lint, typecheck, the Vite browser build, and all 65 tests. The existing invitation regression passes all eight cases in headless Chromium 153.0.8010.12 with a synthetic Wallet Standard provider. The HTTP tests and browser fixtures use loopback.

These are local synthetic codec and cryptographic checks. Browser-wallet approval, chain execution, public deployment, B1 contracts, and persisted application attempts need separate evidence.

## Combined verification

The coordinator verified the core at `fdb75c2496f5445c64829a9c4d313b948d358b85`. The isolated checks passed lint, type checking, the Vite build and 65 Node tests. Chromium 153.0.8010.12 passed eight existing invitation cases and eight new bundled-core cases. The browser checks compare complete two-payer and three-payer bytes with Node and reject recomputed malicious messages. They load the bundle before testing rejection and prohibit external requests.

The existing browser command runs both groups after `npm run check`.

```sh
node --import tsx test/invite-navigation.mjs --playwright-module ../../node_modules/playwright/index.mjs
```

After the merged F2 scaffold arrived at main `ea45d824c7cbc771e5b80d1162299d2334354005`, the coordinator integrated it. The root checks passed lint, types, design checks and 733 tests. The production build and all 127 desktop browser cases passed at `59e215e2fd7f6c73e342e167459a31931e8d0660`. The subsequent ancestry-only merge at `e01cd0c8b66f6d454280dd6e0cd5c195ca06bbb2` has an identical Git tree. Payment source and tests did not change in either scaffold merge.

Independent review reproduced and caught an overflow exception in the P1 wire parser. A regression test failed before the fix, then passed after canonical amount validation guarded the numeric refinement. The reviewer independently passed 37 focused tests on the corrected artifact and reported no unresolved findings. The P1 evidence document and public chain artifacts remain unchanged.

This evidence establishes local construction, validation, read-only preflight logic and browser portability. It does not complete the shared application integration or establish a real three-wallet payment. No new transaction was signed or sent.
