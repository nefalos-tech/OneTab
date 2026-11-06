# OneTab
OneTab is a group checkout app that lets several people pay for one purchase together using USDC on Solana.

The app combines everyone's approved contribution into **one Solana transaction containing multiple transfers**. Every contribution transfer succeeds together, or all contribution transfers revert. Network fees can still be charged if a submitted transaction fails. The money moves directly from payer wallets to the seller, without pooling it in a OneTab wallet.

## Build OneTab

This is a desktop-only Solana Devnet prototype for a 24-hour, three-person hackathon build.

- [spec.md](spec.md) defines the agreed scope, user flow, payment rules, shared contracts and acceptance criteria.
- [AGENTS.md](AGENTS.md) requires coding agents to install pstack when missing and load it before implementation.
- [Kanban board](https://github.com/orgs/nefalos-tech/projects/10) tracks the three parallel work lanes and their assigned cards.

Application setup and run commands will be added when the app is scaffolded.

## How we use Solana

| Capability | How OneTab uses it | Benefit |
|---|---|---|
| Multiple transaction signatures | Every payer signs the same transaction message | Each person controls authorization to spend from their wallet |
| Atomic execution | All contribution transfers sit inside one transaction | The seller avoids receiving only some of the group’s contributions |
| USDC transfers | The purchase amount and individual shares use USDC | Everyone sees amounts in the same payment asset |
| Low network fees | We combine the contributions into one transaction | Network costs can remain small relative to the purchase |
