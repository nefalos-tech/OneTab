# Implementation cards

The [board](https://github.com/orgs/nefalos-tech/projects/10) owns status, scheduling and discussion. The files below preserve the implementation briefs in the repository. Update both copies when scope changes. The [architecture](architecture.md), [contracts](contracts.md) and [development guide](development.md) supply the common decisions.

Each lane has six cards and 16 estimated hours. Estimates are planning budgets. Start P1, F1 and B1 together. Read each card's implementation prerequisites separately from its final integration dependencies.

| Card | Owner | Repository brief | Live issue |
| --- | --- | --- | --- |
| P1 | @kyusuku | [Prove two browser wallets can pay one seller in one transaction](cards/P1.md) | [#1](https://github.com/nefalos-tech/OneTab/issues/1) |
| P2 | @kyusuku | [Build and validate the fixed USDC payment message](cards/P2.md) | [#2](https://github.com/nefalos-tech/OneTab/issues/2) |
| P3 | @kyusuku | [Prepare attempts and collect verified signatures](cards/P3.md) | [#3](https://github.com/nefalos-tech/OneTab/issues/3) |
| P4 | @kyusuku | [Submit once and reconcile the same transaction after a timeout](cards/P4.md) | [#4](https://github.com/nefalos-tech/OneTab/issues/4) |
| P5 | @kyusuku | [Prove signature, expiry and failure behavior](cards/P5.md) | [#5](https://github.com/nefalos-tech/OneTab/issues/5) |
| P6 | @kyusuku | [Verify the hosted three-payer payment and hand off demo evidence](cards/P6.md) | [#6](https://github.com/nefalos-tech/OneTab/issues/6) |
| F1 | @Quantomz | [Create the app shell and three screens against fixtures](cards/F1.md) | [#7](https://github.com/nefalos-tech/OneTab/issues/7) |
| F2 | @Quantomz | [Connect the supported wallet and establish a wallet session](cards/F2.md) | [#8](https://github.com/nefalos-tech/OneTab/issues/8) |
| F3 | @Quantomz | [Build checkout creation, sharing and open-slot joining](cards/F3.md) | [#9](https://github.com/nefalos-tech/OneTab/issues/9) |
| F4 | @Quantomz | [Show readiness and request sign-only payment approvals](cards/F4.md) | [#10](https://github.com/nefalos-tech/OneTab/issues/10) |
| F5 | @Quantomz | [Build the receipt and honest payment-recovery states](cards/F5.md) | [#11](https://github.com/nefalos-tech/OneTab/issues/11) |
| F6 | @Quantomz | [Test the hosted desktop flow and polish the demo](cards/F6.md) | [#12](https://github.com/nefalos-tech/OneTab/issues/12) |
| B1 | @SophiaChua | [Publish shared contracts, fixtures and the database schema](cards/B1.md) | [#13](https://github.com/nefalos-tech/OneTab/issues/13) |
| B2 | @SophiaChua | [Implement wallet-backed authentication and protected mutations](cards/B2.md) | [#14](https://github.com/nefalos-tech/OneTab/issues/14) |
| B3 | @SophiaChua | [Implement immutable checkouts, slot claiming and readiness](cards/B3.md) | [#15](https://github.com/nefalos-tech/OneTab/issues/15) |
| B4 | @SophiaChua | [Implement the atomic payment-attempt store](cards/B4.md) | [#16](https://github.com/nefalos-tech/OneTab/issues/16) |
| B5 | @SophiaChua | [Deploy the Devnet app and verify database access](cards/B5.md) | [#17](https://github.com/nefalos-tech/OneTab/issues/17) |
| B6 | @SophiaChua | [Record the working demo and complete the hackathon submission](cards/B6.md) | [#18](https://github.com/nefalos-tech/OneTab/issues/18) |

The brief's ownership paths are initial destinations. The architecture gives the exact shared-file boundary, and contracts.md gives the initial API names. B1 and F1 implement those agreements rather than choosing separate stacks or protocols.

## Card outputs that complete the handoff

| Card | Output |
| --- | --- |
| F1 | One root application scaffold, pinned toolchain, verified npm scripts and fixture screens |
| B1 | Executable contracts, fixtures and initial database migrations |
| P1 | docs/evidence/payment-proof.md with the working wallet, packages and real transaction evidence |
| B5 | docs/deployment.md with the public URL, provider and applied schema/configuration |
| B6 | docs/demo.md and docs/submission.md with rehearsal, video, disclosures and submission confirmation |

These are implementation outputs, not missing product decisions. Keep them in the same repository as the code. Never commit credentials or wallet keys as evidence.
