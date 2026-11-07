# B2 wallet authentication

The auth routes require `APP_ORIGIN`, `SUPABASE_URL`, and the server-only `SUPABASE_SECRET_KEY`. The challenge endpoint accepts only the configured origin and issues a five-minute message that names the origin, wallet, purpose, challenge ID, and expiry. It allows five new challenges per wallet and origin per minute, and five signature attempts per challenge.

After a valid Ed25519 signature, a database function consumes the challenge and inserts the hash of a random session token in one transaction. The browser receives the token in a 12-hour HttpOnly, SameSite=Lax cookie. The cookie is Secure when `APP_ORIGIN` uses HTTPS. The database never stores the raw token.

Run the service behavior tests with `npm test -- src/server/auth/service.test.ts`. They check the signed message fields, valid signature path, cookie options, and cross-origin rejection. Run `npm run typecheck` and `npm run lint` for the route and module checks.

To verify the migration, apply B1 and B2 migrations to a disposable PostgreSQL 16 database. Create `anon`, `authenticated`, and `service_role BYPASSRLS` roles first. Then run `tests/b2/auth.sql`. It checks challenge contents, one-time consumption, both rate limits, session hash storage, and function grants. The auth SQL functions are server-only. Anonymous and authenticated roles cannot call them.

The auth tables and functions were exercised in local PostgreSQL 16. The route tests mock the Supabase HTTP boundary. A hosted Supabase project and browser wallet were not used for these checks.
