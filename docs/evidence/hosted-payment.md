# Verify the hosted three-payer payment

Prepare the [P6 evidence](../cards/P6.md) for one hosted checkout of 6 test USDC, paid by three distinct wallets at 2 test USDC each. The seller must be separate from every payer. The organizer pays the network fee in SOL.

P6 is incomplete. Its hosted acceptance remains **NOT RUN** and depends on [P5](../cards/P5.md), [F6](../cards/F6.md), and [B5](../cards/B5.md). No public app URL or deployed revision has been verified for P6. No P6 hosted wallet approval, three-payer payment, refreshed receipt comparison, or rejection rehearsal has run. This documentation task does not authorize deployment.

The refresh starts from main `8179b47`, which includes P1 and P2. The inspected P3 application revision is `d8ba143a2578edec4628de2952cfaff7c8a1fc39`. The combined P3 and P4 revision is `0d1124b6d6984d0f5a3c22c2d4da49ad9ba7654d`. P3 subsequently merged as `639a27600497f78c814fa60ad182581c5024a8ab`. The later P4 head `3ffde1173f1e676ed0394f3a2c5cd74c4cb4d1e8` has the identical Git tree as tested revision `0d1124b`. P4 then merged as `fe2d5abe4f6ff456bd127249b2fc996e8aff9135` after its final CI passed. These identify merged implementations and do not identify a hosted deployment.

The combined revision passed the coordinator's root check with 1,064 tests, spike check with 92 tests, production build with 139 app browser cases, and 58 payment-browser cases. The task-local `onetab-run-20261107/p3-p4-import-*.log` files record those runs. Root checks used Node `24.22.1`, and spike checks used Node `25.9.0`. The payment-browser run used Chromium `153.0.8010.12`. These are local fixture results, including synthetic two- and three-payer composition with a fake store and RPC. A separate `p4-built-route-evidence.json` records 17 passing guard checks against the local production build at `2026-11-07T17:03:00.267759Z`. Those checks reached origin, session, method, and configuration guards without a real database or wallet. None of these runs establishes P5 integrated acceptance or P6 hosted acceptance.

[B4](../cards/B4.md) has not supplied the durable application store and lifecycle adapter. At the inspected combined revision, production payment routes return `CONFIGURATION_UNAVAILABLE` without those ports. F4 and F5 are not in the merged baseline for this record. Their wallet-approval and recovery integration still require evidence before F6 can validate the complete desktop flow. See the pinned [P3 application contract](https://github.com/nefalos-tech/OneTab/blob/0d1124b6d6984d0f5a3c22c2d4da49ad9ba7654d/docs/evidence/payment-service.md) and [P4 settlement evidence](https://github.com/nefalos-tech/OneTab/blob/0d1124b6d6984d0f5a3c22c2d4da49ad9ba7654d/docs/evidence/payment-settlement.md).

Follow the [specification](../../spec.md#acceptance-criteria), [payment contracts](../contracts.md), and [development guide](../development.md). Keep the hosted-run forms below as NOT RUN until direct evidence supports an update. A local test, fixture receipt, or proposed URL does not satisfy P6.

## Check the prerequisites

Before the hosted run, obtain these handoffs from their owners.

- [P5](../cards/P5.md) supplies its completed failure evidence for the integrated payment revision.
- [B5](../cards/B5.md) supplies the existing public deployment, exact deployed revision, configuration identity, and deployment acceptance evidence.
- [F6](../cards/F6.md) supplies the desktop acceptance evidence and joins the coordinated run.
- [P1](../cards/P1.md) supplies the proven wallet, package versions, Devnet mint, and prepared token-account setup.

Stop if those handoffs do not describe the artifact under test. Record differences before proceeding. Deployment and infrastructure changes remain with their owners and require their authorization.

## Check the prepared profiles and public identities

The coordinator's preparation record reports three existing Chrome profiles. The user supplied a third payer's public address for one additional profile and confirmed that two profiles currently select the organizer's account. Select the second payer's account in the remaining profile, then verify each profile's public address before running P6. A shared wallet username does not establish a distinct payer. Keep profile names, email addresses, and browser account details out of the payment evidence.

[P1's historical proof](payment-proof.md) used two distinct Phantom accounts in one Chrome profile. It recorded Chrome `155.0.8059.41`, Phantom `26.38.1`, Devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, and six token decimals. These are the versions and identities from that run. Recheck each P6 profile before treating them as the current setup.

| Intended role | Public wallet and source | P6 preparation status |
| --- | --- | --- |
| Organizer and first payer | `6bYQRpZ13aBZrYrgFtZEnePh5ADuY4KGdW6a2Hsmf8oU`, recorded in P1 | Profile binding and hosted approval remain unverified. The public balance read is below. |
| Second payer | `7dmYC9Ca4DdFEfQ9D5B6pQPmsgnHMU3qM5eaRNgpv7VB`, recorded in P1 | The remaining profile still needs to select and verify this payer account instead of the organizer account. |
| Third payer | `FWbFcw1P4sAGa7BQP9nenzXPmcySA5WRFrSSjaPYuNdp`, supplied by the user | Distinct from the other three listed addresses. The public read found no token account for the configured mint. Account preparation and funding remain incomplete. |
| Separate seller | `3uTY8tDn8N2yLh13bg53SHAHYzp4ZG2ConFVztiNVdW1`, recorded in P1 | Reverify its receiving account and separation from all three selected payers. |

The coordinator's read-only Devnet snapshot is `onetab-run-20261107/wallet-balance-20261108.json`. Its actual UTC observation time is `2026-11-07T17:02:23.430640Z`. It records the Devnet genesis and the P1 mint. Both `getBalance` and `getTokenAccountsByOwner` used `finalized` commitment. Token amounts below use six-decimal integer units.

| Public role | Token amount and account | SOL lamports | Recorded slot |
| --- | --- | --- | --- |
| Organizer | `18000000` in `BvEVznZ4KqQmgmWPWZ3NDmfkcKEWQzobhtVKkTie7xKZ` | `499990000` | `519728656` |
| Second payer | `18000000` in `436apUGAkZ2aEqjFCRw46ywFXzhq2DHcScax9gpXgETW` | `0` | `519728660` |
| Third payer | No token account returned for the configured mint | `0` | `519728664` |
| Seller | `24000000` in `FKaacyjitxPgjQ8mKY5AStxeBRLu7qKRxDiUySQWsedv` | `0` | `519728669` |

The third payer needs a prepared account with at least `2000000` units for the planned share. These reads establish a preparation shortage. They do not establish profile ownership or the complete token-account checks required before signing. This finalized preparation snapshot is not a payment baseline. Take a fresh baseline after account preparation and funding.

P1's four-USDC transaction and its later read-only revalidation remain historical two-payer evidence. They do not satisfy the six-USDC hosted run below.

## Record the artifact and participants

Fill this form from the deployed artifact and the three test environments. Record exact values and evidence paths. Keep private RPC URLs and credentials out of the form.

| Identity to record | Observed value and evidence |
| --- | --- |
| Run ID, UTC start/end times, and operators | NOT RUN |
| Public app URL and actual application origin | NOT RUN |
| Source repository, full commit SHA, clean-tree status, and lockfile SHA-256 | NOT RUN |
| Hosting provider, deployment ID, and evidence mapping that deployment to the source SHA | NOT RUN |
| B5 environment label, non-secret database identity, and applied migration identifiers | NOT RUN |
| Public `/api/config` response with `network=devnet`, mint, `tokenDecimals`, and `confirmationTarget=finalized` | NOT RUN |
| RPC provider name and verified Devnet network identity, without endpoint credentials | NOT RUN |
| Exact deployed Node.js, npm, Next.js, React, wallet-integration, and Solana package versions | NOT RUN |
| P1, P5, F6, and B5 evidence references and their matching revisions | NOT RUN |

Use three separate desktop browser profiles or computers. Prepare all token accounts before taking the payment baseline. Record public wallet and token-account addresses only.

| Role | Profile/device label, OS, browser version, wallet name and version | Public wallet and token-account addresses |
| --- | --- | --- |
| Organizer, payer slot 0 | NOT RUN | NOT RUN |
| Payer slot 1 | NOT RUN | NOT RUN |
| Payer slot 2 | NOT RUN | NOT RUN |
| Separate seller, no approval required | NOT RUN | NOT RUN |

## Run one successful checkout

Use the supported wallet combination from P1. Treat the following outcomes as expectations until the evidence form records observations.

1. Open the public app in all three profiles. Confirm the Devnet test-asset labels and the expected mint. Verify that all four wallets are distinct.
2. Confirm each payer has at least 2 test USDC in the prepared source account. Confirm the organizer has enough Devnet SOL for the fee.
3. Capture the four token balances and the organizer's SOL balance after setup. Record account addresses, UTC times, slots, and commitment. Avoid unrelated wallet activity during the run.
4. Authenticate the organizer and create a checkout for 6 test USDC with three payers and the separate seller. Review the seller and all three 2-USDC shares.
5. Open the same room link in the other two profiles. Authenticate their distinct wallets and join. Capture the checkout ID and the ordered participant addresses.
6. Mark each payer Ready. Start the attempt as the organizer. Record its attempt ID and fixed message hash. Confirm that Ready has not authorized a payment.
7. Approve the sign-only payment request once in each wallet. Check the displayed seller, contribution, network, and fee payer before approval. Capture approval progress without recording signatures or session data.
8. Observe submission of one transaction. If the result is unresolved, retain that attempt and transaction reference while reconciliation continues. Do not start a replacement.
9. Inspect the transaction on Devnet. Require `finalized` status and no execution error. Verify three transfers of 2 test USDC to the seller, the expected mint and accounts, and the organizer as fee payer.
10. Capture transaction balance metadata and the post-payment balances. Compare them with the baseline in the form below. Account for the recorded SOL fee separately.
11. Refresh the room in each of the three profiles. Capture each restored receipt and compare the checkout, attempt, transaction, seller, total, contributions, and finalization result.

Record the successful-run evidence here.

| Check | Observed result and evidence |
| --- | --- |
| Public room URL, checkout ID, attempt ID, and message hash | NOT RUN |
| Three distinct authenticated payers, separate seller, and individual approvals | NOT RUN |
| One transaction reference and public Devnet explorer link | NOT RUN |
| Chain status `finalized`, execution error absent, observation time, and slot | NOT RUN |
| Decoded mint, three source accounts, seller destination, and transfer amounts | NOT RUN |
| Organizer fee-payer address and actual fee in lamports | NOT RUN |
| Profile 0 refreshed receipt and capture path | NOT RUN |
| Profile 1 refreshed receipt and capture path | NOT RUN |
| Profile 2 refreshed receipt and capture path | NOT RUN |
| Comparison of all three receipts with the chain result | NOT RUN |

Let `U = 10^tokenDecimals` from the verified mint. Record balances as integer units. For six decimals, the expected total is 6000000 units and each share is 2000000 units. Do not assume the decimals before verification.

| Account | Before | After | Expected delta | Observed delta and public evidence |
| --- | --- | --- | --- | --- |
| Organizer USDC | NOT RUN | NOT RUN | `-2 * U` | NOT RUN |
| Payer 1 USDC | NOT RUN | NOT RUN | `-2 * U` | NOT RUN |
| Payer 2 USDC | NOT RUN | NOT RUN | `-2 * U` | NOT RUN |
| Seller USDC | NOT RUN | NOT RUN | `+6 * U` | NOT RUN |
| Organizer SOL, in lamports | NOT RUN | NOT RUN | Negative of the recorded transaction fee | NOT RUN |

Attach public account explorer links and the transaction's pre/post balance evidence. Use transaction metadata to isolate this payment if other account activity occurred. Explain any discrepancy before claiming success.

## Rehearse one wallet rejection

Use a separate fresh checkout after the successful run. This rehearsal covers one clear failure. P5 owns the broader failure matrix.

1. Create the same three-payer split and mark everyone Ready. Record the new checkout and attempt IDs.
2. Reject one wallet's payment prompt before any payer approves the payment. Leave the other payment prompts unapproved.
3. Capture the resulting state on all three profiles. Verify that the app does not show a successful receipt or describe signatures as revoked.
4. Record `canRetry` and the existing attempt's reconciliation state. Do not request a replacement while `canRetry=false` or the prior authorization remains unresolved.
5. Compare all payer and seller token balances, plus the organizer's SOL balance, before and after the rejection. Record whether any transaction was broadcast and its chain outcome if present.

| Rehearsal evidence | Observed result and evidence |
| --- | --- |
| Checkout, attempt, rejecting profile, UTC time, and prompt capture | NOT RUN |
| Three displayed states, receipt absence, `canRetry`, and reconciliation outcome | NOT RUN |
| Before/after balances, fee effect, and transaction reference or observed absence | NOT RUN |
| Rehearsal result and remaining limitations | NOT RUN |

Describe an observed wallet rejection as a wallet rejection. Do not call it blockchain rollback. If a transaction appears, reconcile that transaction before drawing a conclusion.

## Hand the evidence to B6

Give [B6](../cards/B6.md) the completed form, public app and transaction links, balance evidence, three refreshed receipt captures, rejection evidence, exact versions, and remaining limitations. Include the source SHA and deployment ID so the recording uses the verified artifact.

After the successful run passes, explain the observed flow in the demo. Each wallet authorizes its own contribution to the same transaction. That transaction contains three transfers directly to the seller. The organizer pays the SOL fee separately. Ready only coordinates the room. A failed transaction can still charge a network fee, and this payment receipt does not prove purchase delivery.

Review every attachment before handoff. Exclude private keys, seed phrases, session cookies, authentication signatures, reusable payment signatures, fully signed transaction bytes, privileged database credentials, and private RPC URLs. Public addresses and the submitted transaction reference are sufficient for the payment evidence.

| Handoff check | Observed result and evidence |
| --- | --- |
| Evidence bundle reviewed for secrets | NOT RUN |
| B6 recipient, handoff time, and evidence bundle location | NOT RUN |
| Outstanding limitations and unresolved discrepancies | NOT RUN |
| P6 hosted acceptance result | NOT RUN |

Keep P6 incomplete until its hosted acceptance evidence exists. This checklist does not authorize deployment, recording publication, or submission.
