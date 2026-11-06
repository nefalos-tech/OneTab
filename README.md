# OneTab
OneTab is a group checkout app that lets several people pay for one purchase together using USDC on Solana.

The app combines everyone's approved contribution into **one Solana transaction containing multiple transfers**. Every split transfers succeeds together, or every split transfer reverts. Our main distinction here is this is one transaction containing several transfers. It does not require pooling everyone's money into a OneTab wallet beforehand.
## How we use Solana

| Capability | How OneTab uses it | Benefit |
|---|---|---|
| Multiple transaction signatures | Every payer signs the same transaction message | Each person controls authorization to spend from their wallet |
| Atomic execution | All contribution transfers sit inside one transaction | The seller avoids receiving only some of the group’s contributions |
| USDC transfers | The purchase amount and individual shares use USDC | Everyone sees amounts in the same payment asset |
| Low network fees | We combine the contributions into one transaction | Network costs can remain small relative to the purchase |
