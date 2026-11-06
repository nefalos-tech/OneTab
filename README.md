# OneTab
OneTab is a group checkout app that lets several people pay for one purchase together using USDC on Solana.

The app combines everyone's approved contribution into **one Solana transaction containing multiple transfers**. Every contribution transfer succeeds together, or all contribution transfers revert. Network fees can still be charged if a submitted transaction fails. The money moves directly from payer wallets to the seller, without pooling it in a OneTab wallet.

## Build OneTab

The agreed stack is **Next.js App Router + React + TypeScript + Supabase Postgres**, with npm and Tailwind CSS. Frontend scaffolds one shared application. Backend and payment routes live in that same application.

This is a desktop-only Solana Devnet prototype for a 24-hour, three-person hackathon build. The application is not scaffolded yet. The documents below are the implementation handoff, not evidence of a working payment system.

Read these before implementing a card:

1. [Product specification](spec.md) defines scope, payment rules and acceptance criteria.
2. [Architecture](docs/architecture.md) defines the stack, module boundaries, file owners and payment flow.
3. [Shared contracts](docs/contracts.md) defines API routes, data shapes, errors and atomic storage operations.
4. [Development guide](docs/development.md) explains setup, environment variables, parallel work and evidence.
5. [Card index](docs/implementation-map.md) links all 18 repository briefs and live GitHub issues.

[AGENTS.md](AGENTS.md) requires coding agents to install pstack when missing and load it before implementation. [The Kanban board](https://github.com/orgs/nefalos-tech/projects/10) owns task status.

| Contributor | Lane | Start here |
| --- | --- | --- |
| @Quantomz | Frontend | [F1. Next.js and TypeScript scaffold, then fixture screens](docs/cards/F1.md) |
| @kyusuku | Payments | [P1. Prove two browser-wallet approvals](docs/cards/P1.md) |
| @SophiaChua | Backend and demo | [B1. Publish contracts, fixtures and schema](docs/cards/B1.md) |

The [environment template](.env.example) contains no secrets. F1 publishes verified run/build commands when it creates the scaffold. P1 proves wallet and Solana package compatibility before those dependencies enter the shared app.

## How we use Solana

| Capability | How OneTab uses it | Benefit |
|---|---|---|
| Multiple transaction signatures | Every payer signs the same transaction message | Each person controls authorization to spend from their wallet |
| Atomic execution | All contribution transfers sit inside one transaction | The seller avoids receiving only some of the group’s contributions |
| USDC transfers | The purchase amount and individual shares use USDC | Everyone sees amounts in the same payment asset |
| Low network fees | We combine the contributions into one transaction | Network costs can remain small relative to the purchase |
