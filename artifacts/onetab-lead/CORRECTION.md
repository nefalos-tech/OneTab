# Correction to the writer database note

Lead QA reviewed the writer logs on `cc135f52c20de7a461b359733e6ed75569330f6f` and required this correction before any merge. The `.log` files in this directory remain the original writer output. They are non-runnable historical evidence. This directory is not a supported harness.

## Database

The PostgreSQL process was the existing system cluster `16/main`. The writer script dropped and recreated the database `b4test` on that cluster. It changed cluster roles and the authenticator password, terminated connections, and restarted that system cluster with sudo. The run used an existing system cluster and a recreated database.

`b4-local.log` does not record a git SHA. Commit `3f278faafdd5a782581e959ff9df02b46fec6ef9` is the commit that later added the log file. That association is a source comparison. It is not a SHA captured by the database run. `node-check-after-main.log` names `40141c8818c83f56206f4ef1eacc0639eb33e1c0` for `npm run check` only.

## What those commands showed

The reservation overlap used two SQL sessions. Each session locked the checkout row with `FOR UPDATE` and slept before `reserve_attempt`. That is harness serialization in SQL. It is not concurrent HTTP through the payment routes.

After the cluster restart, SQL reads showed the previous rows, and a new reader called `getAttempt`. That is a fresh read of stored rows. It is not a Payments process stopping during send and resuming the same transaction bytes.

The expiry pass set `backendAssurance` to `coherent_backend_and_retention_established` and used a stand-in RPC. Production composition still leaves assurance `unverified`.

The writer executed the log. QA reviewed that log. QA did not execute the database. The log is not independent database acceptance.

## Superseded wording

The decision row at `2026-11-08T06:26:00Z` called this a new local PostgreSQL 16 cluster and a local disposable pass. `skill-activation.md` called the intended database check a disposable local PostgreSQL 16 plus PostgREST run. The pull request text called it a new local cluster. Those descriptions are withdrawn. This file supersedes them. The older rows and the original log bytes stay in place.

## Gates that stay open

P3, P4, P5, and P6 stay open and are not Done. Production assurance stays unverified. A declined attempt with no frozen payload stays blocking. An independent real database run and an application-process restart are still required. P5's scenarios and P6's hosted checkout stay NOT RUN.

Removed from the branch because they operate on the system cluster and are not a supported harness: `run-b4-local.sh`, `rest-prefix-proxy.mjs`, `vitest.harness.mts`, and `postgrest-progress.test.ts`.
