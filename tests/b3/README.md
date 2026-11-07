# B3 room operations checks

Run `pwsh -NoProfile -File tests/b3/run-local.ps1`. It starts a fresh, disposable PostgreSQL 16 container with no host volume, creates the Supabase roles, applies B1 through B3 migrations, runs `rooms.sql`, and then runs the concurrency test. It stops and removes only the container it created. To run the steps manually, apply the B1 and B2 migrations, then `20261107020000_b3_rooms.sql`, and run `rooms.sql`.

For the race check, create a two-payer checkout with one organizer participant. Start two independent `psql` processes at the same time, each calling `select public.join_checkout('<checkout-id>', '<distinct-wallet>');`. Exactly one must return slot 1. The other must fail with `ROOM_FULL`. Then assert the checkout has two participants and no duplicate wallet or slot. This exercises separate transactions contending on the checkout row lock.

The Node service tests mock only the PostgREST HTTP boundary. They cover config validation, boundary validation, config-derived create fields and snapshot retrieval after mutations. They do not replace the PostgreSQL concurrency check.
