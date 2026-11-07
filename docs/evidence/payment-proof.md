# P1 payment proof evidence

Two distinct Phantom payer accounts approved the same frozen message in separate real sign-only prompts on 2026-11-07. One Devnet transaction paid four test USDC to a separate seller and finalized at slot `519612865`. The [public evidence](../../spikes/payment-proof/evidence/devnet-20261107.json) and [receipt screenshot](../../spikes/payment-proof/evidence/receipt-20261107.png) record the result.

[P1](../cards/P1.md) has its real-wallet compatibility proof and is review-ready. The board's Done status still requires merge. This local spike does not establish hosted application acceptance, three-payer behavior, or acceptance of P2 through P6.

## Tested source and environment

The tested P1 revision is `9fb3cbaf17e9b0d07a5d33d1dc63c4b213747f72`. The combined verification revision is `b74d3ed3ff2e245122883518dd065f34efa3d48f`. All 31 files in the P1 publication manifest matched between those revisions before this evidence update. That set includes the isolated spike and the owner-approved shared configuration patch.

The [spike guide](../../spikes/payment-proof/README.md) records the setup and signing procedure. The coordinator served a loopback page and persisted each experiment in private SQLite. The tested arrangement used two distinct payer accounts in the same user-selected Chrome profile, with a separate seller account. Separate-profile execution remains untested by this run.

| Component | Tested value |
| --- | --- |
| Running browser | Chrome `155.0.8059.41` |
| Wallet extension | Phantom `26.38.1` |
| Wallet Standard and sign-only feature versions | `1.0.0`, with legacy transaction support |
| Network | Solana Devnet, with Phantom Testnet Mode enabled |
| Mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Token program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token decimals | `6` |
| Spike runtime | Node `25.9.0`, macOS `27.0`, arm64 |
| Root application runtime | Node `24.22.1` |

Automatic wallet confirmation remained off. The user created the accounts inside Phantom. No private keys or recovery phrases entered the experiment. Preparation checked the complete Devnet genesis, live mint layout, token-account owners and states, balances, and the message fee estimate.

## Finalized payment

Experiment six is `ab3b0755-53f7-4a32-b714-2f7f6ac9ec5c`. Its transaction is [finalized on Solana Devnet](https://explorer.solana.com/tx/55uWRbS4rUHdxLTr87h3S9JJdMoHDRAjj8gxh8b6FFQCo8idbTU8ypFt23jJhR9dmVjtvupY68ytso5AJFJDn2Ve?cluster=devnet).

| Role | Public wallet | Test-USDC account |
| --- | --- | --- |
| Organizer and payer zero | `6bYQRpZ13aBZrYrgFtZEnePh5ADuY4KGdW6a2Hsmf8oU` | `BvEVznZ4KqQmgmWPWZ3NDmfkcKEWQzobhtVKkTie7xKZ` |
| Payer one | `7dmYC9Ca4DdFEfQ9D5B6pQPmsgnHMU3qM5eaRNgpv7VB` | `436apUGAkZ2aEqjFCRw46ywFXzhq2DHcScax9gpXgETW` |
| Seller | `3uTY8tDn8N2yLh13bg53SHAHYzp4ZG2ConFVztiNVdW1` | `FKaacyjitxPgjQ8mKY5AStxeBRLu7qKRxDiUySQWsedv` |

Both wallet returns passed exact-message and Ed25519 signature verification against message hash `e3acd08148f63fe3889c454b996a65d6084ae7cafb2d66efebf8f8daaf429c83`. The last valid block height was `506762398`.

| Observation | UTC time on 2026-11-07 | Result |
| --- | --- | --- |
| First real Phantom prompt | `09:20:27.114` | Account 1 displayed a two-token decrease and a `0.00001 SOL` network fee. |
| Payer zero signature accepted | `09:20:27.749` | One approval stored. Submit remained disabled. |
| First-signature diagnostic | `09:20:28.412` | RPC simulation explicitly refused the incomplete transaction's signature set. No broadcast occurred. |
| Second real Phantom prompt | `09:20:32.370` | The distinct payer 2 account displayed a two-token decrease and a `0.00001 SOL` network fee. |
| Payer one signature accepted | `09:20:33.044` | Both approvals matched the same frozen message. |
| Finalized receipt observed | `09:20:58.212` | Slot `519612865`, with no execution error. |
| Receipt after server restart and browser reload | `09:21:33.686` | The same finalized receipt returned and submit remained disabled. |
| Independent public RPC check | `09:22:19.245` | Finalized status, exact signed wire identity, token deltas, and organizer fee matched. |

Phantom labeled the token `Unknown` in both prompts. Mint identity comes from the validated payment and chain data, not the prompt's asset label. The two separate confirmation prompts and approval states are preserved in the public evidence.

| Balance | Before | After | Change |
| --- | --- | --- | --- |
| Payer zero test USDC | `20` | `18` | `-2` |
| Payer one test USDC | `20` | `18` | `-2` |
| Seller test USDC | `20` | `24` | `+4` |
| Organizer lamports | `500000000` | `499990000` | `-10000` |

The durable record contained two approvals, one submission, and one claimed dispatch before restart. The independently fetched signed wire matched its stored SHA-256 hash, `e50344171cc051df1470fc37278f3f8deaca04f03bbe0377e7988a2d1aea9ad4`. This signed-transaction hash differs from the message hash because it covers the serialized transaction with both signatures.

The persisted-signature audit at `09:26:37.614 UTC` independently verified both 64-byte Ed25519 signatures and the full frozen message. Reassembly matched the durable submission byte for byte, with the same signed hash and transaction reference as the finalized chain record. The public evidence includes the audit result without publishing raw signatures.

The read-only [Devnet verification script](../../spikes/payment-proof/evidence/verify-devnet.mjs) repeats the genesis, finalized-status, signed-wire hash, historical balance, and fee comparisons against the published evidence. It requires the public RPC to retain this historical transaction. Later pruning or RPC unavailability prevents a fresh verification and does not change the recorded result. The repository-root command is:

```sh
node spikes/payment-proof/evidence/verify-devnet.mjs
```

## Earlier experiments

Each experiment retains its own database and identity. No approval was reused across experiments.

| Experiment | Observed outcome |
| --- | --- |
| 1 | The unsigned message expired before a prompt. Zero approvals and zero submissions. |
| 2 | An actual Phantom sign-only return changed the message and failed validation. Zero accepted approvals and zero submissions. This preceded the frozen compute-budget fix. |
| 3 | The wallet was locked and the message expired. Zero approvals and zero submissions. |
| 4 | The first signature passed validation, but the message expired before completion. Zero submissions. |
| 5 | The first signature passed validation, but the message expired before completion. Zero submissions. |
| 6 | Both signatures passed validation and one seller payment finalized. |

The second experiment exposed the need to freeze the compute-budget instructions before approval. The successful message includes `SetComputeUnitLimit(400000)` and `SetComputeUnitPrice(0)` before the two checked transfers. This policy preserves a known message for both payers and adds no priority fee. It is the tested Devnet policy, not a production fee recommendation. Changed return bytes still fail validation.

## F2 and B1 handoff

The implementation in [wallet.ts](../../spikes/payment-proof/src/wallet.ts) and [payment.ts](../../spikes/payment-proof/src/payment.ts) proves the following signing behavior for the tested Phantom and Chrome versions. B1's executable shared `WalletBridge` interface remains missing. F2 still owns the application bridge, and authentication remains outside this spike.

The mapping to the agreed [SigningPayload and WalletBridge contract](../contracts.md#signingpayload-and-walletbridge) is explicit.

| Shared contract | Proven spike behavior or mapping |
| --- | --- |
| `WalletBridge.connect` | `WalletSession.connect` validates the selected account's public key and subscribes to account-change events. `inventory` reports the selected address and sign-only capabilities. |
| `WalletBridge.disconnect` | `WalletSession.disconnect` clears local state and requests optional `standard:disconnect`. Ending the server session remains application work. |
| `WalletBridge.signPayment` | `WalletSession.sign` validates the frozen payment, requests `solana:signTransaction`, verifies the returned transaction, and returns one approval. F2 maps the validated acting slot to `signerWallet` and returns it with `messageHash` and `signatureBase64`. |
| `WalletBridge.signAuthentication` | No implementation or authentication-signature proof in P1. B1 and F2 retain this work. |
| `SigningPayload.attemptId` | Corresponds to the spike's frozen experiment `id`. The spike has no `checkoutId`. |
| `SigningPayload.payment` | Corresponds to `plan`. Rename `decimals` to `tokenDecimals`, `feePayer` to `feePayerWallet`, and contribution `units` to `amountUnits`. Preserve the ordered slots, wallets, and token accounts. |
| `transactionBase64` | Canonical base64 of the serialized signable legacy transaction, including the fixed message and empty required signer slots. Each payer receives this original unsigned transaction. |
| `messageBase64` | Canonical base64 of the exact compiled transaction message bytes. These are the bytes each Ed25519 signature covers. |
| `messageHash` | Lowercase hexadecimal SHA-256 of those exact message bytes, not of JSON, base64 text, or the complete serialized transaction. |
| `blockhash`, `lastValidBlockHeight` | The fixed message lifetime. The block height is a decimal string. Neither field changes after the first approval. |
| `signatureBase64` | Canonical base64 of only the acting payer's nonzero, 64-byte Ed25519 signature. |

The spike's `planHash`, fixed `tokenProgram`, and `total` support its own validation. They are not additions to B1's agreed payload. Application integration must validate the payment against the immutable room, including the total and every contribution.

The agreed application signature endpoint accepts `messageHash` and `signatureBase64`. Under that contract, the server derives the acting wallet from the authenticated session. The bridge's returned `signerWallet` is not server authorization.

The signing call passes the decoded `transactionBase64` bytes, the expected wallet account, `chain: 'solana:devnet'`, and `preflightCommitment: 'confirmed'`. It requires Wallet Standard connect, account-change events, and legacy sign-only support. It never calls `signAndSendTransaction` or another sign-and-send API.

Before the prompt, the validator compares the complete message with deterministic construction of the expected plan. That comparison covers the known compute-budget policy, blockhash, fee payer, signer set, programs, accounts, amounts, decimals, and instruction order. A matching hash alone cannot authorize a payment.

After the prompt, the bridge decodes the returned signed transaction and requires unchanged message bytes and canonical transaction encoding. It rejects any nonzero signature in another payer's slot. It extracts only the acting payer's signature and verifies it against that payer's public key and the exact message bytes. The server merges independently verified signatures into its original transaction. The wallet-returned transaction never becomes the server's authority.

An account change or disconnect invalidates an in-flight result, including a switch away and back. Wallet error code `4001` is a reported rejection. Other provider errors remain failures without an asserted user decline. Neither outcome silently retries or uploads an approval.

## Exact spike dependencies

The tested [package manifest](../../spikes/payment-proof/package.json) pins these direct dependencies. The isolated lockfile records transitive resolution. Frontend owns integration into the root manifest and lockfile.

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

TypeScript `6.0.3` satisfies the TypeScript-ESLint peer range. No peer check was bypassed. The recorded production-dependency audit reported zero vulnerabilities. The full audit reported nine moderate entries in local ESLint and TypeScript-ESLint tooling through `minimatch`. No forced dependency upgrade was applied.

## Local and CI verification

The following checks passed for the tested source. The [CI job for P1 revision `9fb3cba`](https://github.com/nefalos-tech/OneTab/actions/runs/42358408041/job/128361412130) also passed. The documentation and public artifacts added after that revision do not change the tested runtime code.

| Scope | Command | Observed result |
| --- | --- | --- |
| Root application, Node `24.22.1` | `npm run check` | Lint, typecheck, design check, and 676 tests passed. |
| Root application, Node `24.22.1` | `npm run test:e2e` | Production build and 113 browser cases passed. |
| Isolated spike, Node `25.9.0` | `npm run check` | Lint, full typecheck, Vite build, and 43 native Node tests passed. |
| Isolated spike | The [invitation-navigation command](../../spikes/payment-proof/README.md#check-invitation-navigation-in-a-disposable-browser) | Eight synthetic browser cases passed. |

Spike tests cover full-message tampering, missing and invalid signatures, account changes, duplicate and concurrent approvals, concurrent submit requests, and private-data exclusion. Real SQLite connections and killed child processes verify persistence around commit and dispatch boundaries. Lost-response tests reconcile the same stored transaction identity. These automated tests use synthetic ephemeral keys and mocked network outcomes where needed. They are separate from the real-wallet and chain observations above.

## Remaining scope boundaries

The spike uses private local invitation capabilities rather than production wallet authentication. SQLite uses DELETE journaling and FULL synchronous mode. It allows one application send invocation. A crash after dispatch claim but before send can leave an unsent experiment unresolved. P4's lease and rebroadcast behavior is outside this proof.

This evidence establishes the two-payer P1 payment with the recorded package, browser, and wallet versions. The root checks establish local scaffold and fixture behavior. Neither establishes B1's shared implementation, Postgres recovery, hosted checkout behavior, or the remaining cards' acceptance criteria. No merge or deployment is part of this evidence update.
