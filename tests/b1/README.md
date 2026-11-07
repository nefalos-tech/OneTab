# B1 local verification

B1 defines interfaces and schema. B2 owns wallet authentication and sessions. B3 owns room operations. B4 owns the transactional AttemptStore, including lease fencing, readiness checks, safe outcome transitions, and atomic paid receipts. B1 does not include a production AttemptStore implementation. `fake-attempt-store.ts` is a compile-checked consumer example backed by the signing fixture. Reads return fixture data; mutation methods throw explicitly. The migration alone does not implement these operations or prove wallet authentication. Server routes must check the wallet session; the database service role must remain server-only.

The migration enables RLS with no client policies and revokes direct access from `anon` and `authenticated` when those roles exist. A Supabase `service_role` is granted table access. The test database must be disposable.

For a local PostgreSQL container named `onetab-b1-local`, apply the migration to a new database and run the checks from PowerShell:

```powershell
Get-Content -Raw supabase/migrations/20261107000000_b1_schema.sql | docker exec -i onetab-b1-local psql -U postgres -d b1test -v ON_ERROR_STOP=1
Get-Content -Raw tests/b1/schema.sql | docker exec -i onetab-b1-local psql -U postgres -d b1test -v ON_ERROR_STOP=1
docker restart onetab-b1-local
docker exec onetab-b1-local psql -U postgres -d b1test -Atc "select (select count(*) from public.participants), (select count(*) from public.signatures), (select state from public.attempts limit 1)"
```

On November 7, 2026, PostgreSQL 16 accepted the migration and rejection checks. The restart query returned `2|1|declined`. A separate fresh database with `anon`, `authenticated`, and `service_role BYPASSRLS` roles returned `f|f|t|t` for anonymous signature read, authenticated session read, service signature read, and RLS enabled on all nine tables. These are local database results, not hosted Supabase or chain evidence.

The contracts, fixtures, tests, and fake-store consumer compile with TypeScript 5.9.3 using `tsc --noEmit --strict --target es2020 --moduleResolution node src/contracts/index.ts src/fixtures/index.ts src/server/attempt-store/index.ts tests/b1/contracts.ts tests/b1/fake-attempt-store.ts`. Run the fixture assertions with `node .local-setup/b1-check/tests/b1/contracts.js` after compiling those files to `.local-setup/b1-check` as CommonJS. Fixtures are marked test data and intentionally do not contain valid Solana transactions. No wallet approval or payment was performed.
