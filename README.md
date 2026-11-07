# OneTab
OneTab is a group checkout app that lets several people pay for one purchase together using USDC on Solana.

The app combines everyone's approved contribution into **one Solana transaction containing multiple transfers**. Every contribution transfer succeeds together, or all contribution transfers revert. Network fees can still be charged if a submitted transaction fails. The money moves directly from payer wallets to the seller, without pooling it in a OneTab wallet.

## Build OneTab

The agreed stack is **Next.js App Router + React + TypeScript + Supabase Postgres**, with npm and Tailwind CSS. Frontend scaffolds one shared application. Backend and payment routes live in that same application.

This is a desktop-only Solana Devnet prototype for a 24-hour, three-person hackathon build. The app renders its three screens from sample data. Wallets, rooms and payments are not connected yet, so nothing in it is evidence of a working payment system.

## Run OneTab locally

You need Node.js 24.22.1, the version in [.nvmrc](.nvmrc). With nvm, select it first:

```bash
nvm use
```

Install the exact dependencies from the lockfile:

```bash
npm ci
```

Start the development server:

```bash
npm run dev
```

Open http://localhost:3000/samples to see every screen and state with sample data. [The development guide](docs/development.md) lists every script and environment variable.

## Read before implementing a card

1. [Product specification](spec.md) defines scope, payment rules and acceptance criteria.
2. [Architecture](docs/architecture.md) defines the stack, module boundaries, file owners and payment flow.
3. [Shared contracts](docs/contracts.md) defines API routes, data shapes, errors and atomic storage operations.
4. [Development guide](docs/development.md) explains setup, environment variables, parallel work and evidence.
5. [Card index](docs/implementation-map.md) links all 18 repository briefs and live GitHub issues.
6. [Design system](docs/design-system.md) defines colors, type, components, states and words for every screen. [Design decisions](docs/design-decisions.md) explains why.

[AGENTS.md](AGENTS.md) requires coding agents to install pstack when missing and load it before implementation. [The Kanban board](https://github.com/orgs/nefalos-tech/projects/10) owns task status.

| Contributor | Lane | Start here |
| --- | --- | --- |
| @Quantomz | Frontend | [F1. Next.js and TypeScript scaffold, then fixture screens](docs/cards/F1.md) |
| @kyusuku | Payments | [P1. Prove two browser-wallet approvals](docs/cards/P1.md) |
| @SophiaChua | Backend and demo | [B1. Publish contracts, fixtures and schema](docs/cards/B1.md) |

The [environment template](.env.example) contains no secrets. P1 proves wallet and Solana package compatibility before those dependencies enter the shared app.

## How we use Solana

| Capability | How OneTab uses it | Benefit |
|---|---|---|
| Multiple transaction signatures | Every payer signs the same transaction message | Each person controls authorization to spend from their wallet |
| Atomic execution | All contribution transfers sit inside one transaction | The seller avoids receiving only some of the group’s contributions |
| USDC transfers | The purchase amount and individual shares use USDC | Everyone sees amounts in the same payment asset |
| Low network fees | We combine the contributions into one transaction | Network costs can remain small relative to the purchase |
