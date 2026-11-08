# B4 payment-attempt store checks

Run `pwsh -NoProfile -File tests/b4/run-local.ps1`. The script starts a uniquely named PostgreSQL 16 container with no host volume, creates the Supabase roles, applies B1 through B4 migrations, and checks reservation, message freezing, concurrent reservation, concurrent signatures, single submission-lease ownership, safe decline resolution, atomic finalized receipts and retry, and restart persistence. It stops and removes only the container it created.

The transactions and addresses are synthetic database fixtures. The checks do not validate Solana signatures, submit a Devnet payment, or prove behavior against hosted Supabase. Payment orchestration must verify signatures and chain outcomes before calling the store.
