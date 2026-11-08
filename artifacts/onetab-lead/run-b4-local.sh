#!/bin/bash
# Disposable local PostgreSQL 16 and PostgREST. Not a hosted or production database.
set -euo pipefail
export PATH="/home/ubuntu/.nvm/versions/node/v24.22.1/bin:${PATH}"
hash -r
cd /workspace
echo "NODE $(node -p 'process.execPath+" "+process.version')"
echo "NPM $(npm -v) $(npm exec -- node -p 'process.execPath+" "+process.version')"
echo "POSTGREST $(/tmp/postgrest-v16.5/postgrest --version)"
psql --version

DB=b4test
SECRET=onetab-b4-test-only
JWT_SECRET=onetab-local-b4-jwt-secret-32chars
UPSTREAM_PORT=54928
PORT=54929
ATTEMPT_FILE=/tmp/onetab-b4-attempt-id
rm -f "$ATTEMPT_FILE"
sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true
sudo pg_lsclusters

sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 <<SQL
select version();
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login password '${SECRET}'; end if;
end \$\$;
alter role authenticator password '${SECRET}';
grant anon, authenticated, service_role to authenticator;
select pg_terminate_backend(pid) from pg_stat_activity where datname='${DB}' and pid <> pg_backend_pid();
drop database if exists ${DB};
create database ${DB};
grant connect on database ${DB} to authenticator;
SQL

for migration in \
  supabase/migrations/20261107000000_b1_schema.sql \
  supabase/migrations/20261107010000_b2_auth.sql \
  supabase/migrations/20261107020000_b3_rooms.sql \
  supabase/migrations/20261108000000_b4_attempt_store.sql \
  tests/b4/attempt-store.sql
do
  sudo -u postgres psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$migration"
done
echo "MIGRATIONS_AND_SQL_FIXTURE ok"

reserve_sql=$(cat <<'SQL'
begin;
select id from public.checkouts where id='20000000-0000-4000-8000-000000000003' for update;
select pg_sleep(1);
select public.reserve_attempt('20000000-0000-4000-8000-000000000003','organizer-2',null)->>'id';
commit;
SQL
)
sudo -u postgres psql -d "$DB" -qAt -v ON_ERROR_STOP=1 <<<"$reserve_sql" > /tmp/onetab-b4-reserve-a.txt &
pid_a=$!
sudo -u postgres psql -d "$DB" -qAt -v ON_ERROR_STOP=1 <<<"$reserve_sql" > /tmp/onetab-b4-reserve-b.txt &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
id_a=$(grep -E '^[0-9a-f-]{36}$' /tmp/onetab-b4-reserve-a.txt | tail -1)
id_b=$(grep -E '^[0-9a-f-]{36}$' /tmp/onetab-b4-reserve-b.txt | tail -1)
echo "CONCURRENT_RESERVE ${id_a} ${id_b}"
test -n "$id_a" && test "$id_a" = "$id_b"

sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 <<SQL
do \$\$
declare attempt_id uuid := '${id_a}'; lease jsonb; payload jsonb;
begin
  lease := public.claim_attempt_preparation(attempt_id);
  payload := jsonb_build_object(
    'attemptId',attempt_id,'checkoutId','20000000-0000-4000-8000-000000000003',
    'transactionBase64','RklYVFVSRQ==','messageBase64','RklYVFVSRQ==','messageHash',repeat('1',64),
    'blockhash',repeat('2',32),'lastValidBlockHeight','123456',
    'payment',jsonb_build_object('network','devnet','mint','mint','tokenDecimals',6,'sellerWallet','seller-2',
      'sellerTokenAccount','seller-token-2','feePayerWallet','organizer-2','contributions',jsonb_build_array(
        jsonb_build_object('slot',0,'wallet','organizer-2','amountUnits','5','sourceTokenAccount','source-c'),
        jsonb_build_object('slot',1,'wallet','payer-2','amountUnits','5','sourceTokenAccount','source-d'))));
  perform public.freeze_attempt_message(attempt_id,(lease->>'token')::uuid,payload);
end \$\$;
SQL

sudo -u postgres psql -d "$DB" -qAt -v ON_ERROR_STOP=1 -c "select public.put_attempt_signature('${id_a}','organizer-2',repeat('1',64),repeat('A',86)||'==')" >/tmp/onetab-b4-sig-a.txt &
pid_a=$!
sudo -u postgres psql -d "$DB" -qAt -v ON_ERROR_STOP=1 -c "select public.put_attempt_signature('${id_a}','payer-2',repeat('1',64),repeat('B',86)||'==')" >/tmp/onetab-b4-sig-b.txt &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
signature_count=$(sudo -u postgres psql -d "$DB" -Atc "select count(*) from public.signatures where attempt_id='${id_a}'")
echo "CONCURRENT_SIGNATURES ${signature_count}"
test "$signature_count" = "2"

claim_sql="select public.claim_attempt_submission('${id_a}','Ag==',repeat('3',87))::text"
sudo -u postgres psql -d "$DB" -qAt -v ON_ERROR_STOP=1 -c "$claim_sql" >/tmp/onetab-b4-claim-a.txt &
pid_a=$!
sudo -u postgres psql -d "$DB" -qAt -v ON_ERROR_STOP=1 -c "$claim_sql" >/tmp/onetab-b4-claim-b.txt &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
tokens=$(grep -o '"token"' /tmp/onetab-b4-claim-a.txt /tmp/onetab-b4-claim-b.txt | wc -l)
echo "CONCURRENT_CLAIMS token_rows ${tokens}"
test "${tokens// /}" = "1"
reference_ok=$(sudo -u postgres psql -d "$DB" -Atc "select (public.get_attempt('${id_a}')->'submission'->>'transactionReference') = repeat('3',87)")
echo "CANONICAL_REFERENCE ${reference_ok}"
test "$reference_ok" = "t"

export SUPABASE_URL="http://127.0.0.1:${PORT}"
export SUPABASE_SECRET_KEY="$(JWT_SECRET="$JWT_SECRET" node --input-type=module -e '
import { createHmac } from "node:crypto";
const secret = process.env.JWT_SECRET;
const part = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const data = `${part({ alg: "HS256", typ: "JWT" })}.${part({ role: "service_role", iss: "onetab-local-b4", iat: now, exp: now + 3600 })}`;
process.stdout.write(`${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`);
')"
test -n "$SUPABASE_SECRET_KEY"
cat > /tmp/onetab-b4-postgrest.conf <<EOF
db-uri = "postgres://authenticator:${SECRET}@127.0.0.1:5432/${DB}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-port = ${UPSTREAM_PORT}
EOF
if [[ -f /tmp/onetab-b4-postgrest.pid ]]; then kill "$(cat /tmp/onetab-b4-postgrest.pid)" >/dev/null 2>&1 || true; fi
/tmp/postgrest-v16.5/postgrest /tmp/onetab-b4-postgrest.conf >/tmp/onetab-b4-postgrest.log 2>&1 &
echo $! > /tmp/onetab-b4-postgrest.pid
ready=0
for _ in $(seq 1 30); do
  if grep -qi "listening" /tmp/onetab-b4-postgrest.log; then ready=1; break; fi
  sleep 0.2
done
test "$ready" = "1"
export B4_UPSTREAM_PORT="$UPSTREAM_PORT"
export B4_PROXY_PORT="$PORT"
if [[ -f /tmp/onetab-b4-proxy.pid ]]; then kill "$(cat /tmp/onetab-b4-proxy.pid)" >/dev/null 2>&1 || true; fi
node artifacts/onetab-lead/rest-prefix-proxy.mjs >/tmp/onetab-b4-proxy.log 2>&1 &
echo $! > /tmp/onetab-b4-proxy.pid
echo "POSTGREST_LISTENING upstream ${UPSTREAM_PORT} proxy ${PORT}"

export B4_PHASE=expire
export B4_ATTEMPT_FILE="$ATTEMPT_FILE"
./node_modules/.bin/vitest run --config artifacts/onetab-lead/vitest.harness.mts
attempt_id=$(tr -d '[:space:]' < "$ATTEMPT_FILE")
echo "PAYMENT_EXPIRED ${attempt_id}"

before=$(sudo awk 'NR==1 { print; exit }' /var/lib/postgresql/16/main/postmaster.pid)
started_before=$(sudo -u postgres psql -d "$DB" -Atc "select pg_postmaster_start_time()")
echo "POSTGRES_PID_BEFORE ${before} ${started_before}"
sudo pg_ctlcluster 16 main restart
after=$(sudo awk 'NR==1 { print; exit }' /var/lib/postgresql/16/main/postmaster.pid)
started_after=$(sudo -u postgres psql -d "$DB" -Atc "select pg_postmaster_start_time()")
echo "POSTGRES_PID_AFTER ${after} ${started_after}"
test "$before" != "$after"
sudo -u postgres psql -d "$DB" -Atc "select 'ready'"

persisted=$(sudo -u postgres psql -d "$DB" -Atc "select (state || ':' || (select count(*) from public.signatures where attempt_id=a.id)::text || ':' || (select transaction_reference from public.submissions where attempt_id=a.id) || ':' || (public.get_attempt(a.id)->'signingPayload'->>'messageBase64') || ':' || (public.get_attempt(a.id)->'signingPayload'->>'messageHash')) = ('confirmed:2:' || repeat('2',87) || ':RklYVFVSRQ==:' || repeat('0',64)) from public.attempts a where checkout_id='20000000-0000-4000-8000-000000000001'")
echo "RESTART_CONFIRMED ${persisted}"
test "$persisted" = "t"
concurrent=$(sudo -u postgres psql -d "$DB" -Atc "select (state || ':' || (select count(*) from public.signatures where attempt_id=a.id)::text || ':' || (select transaction_reference from public.submissions where attempt_id=a.id) || ':' || (public.get_attempt(a.id)->'signingPayload'->>'messageBase64') || ':' || (public.get_attempt(a.id)->'signingPayload'->>'messageHash')) = ('submitting:2:' || repeat('3',87) || ':RklYVFVSRQ==:' || repeat('1',64)) from public.attempts a where id='${id_a}'")
echo "RESTART_CONCURRENT ${concurrent}"
test "$concurrent" = "t"

kill "$(cat /tmp/onetab-b4-postgrest.pid)" >/dev/null 2>&1 || true
/tmp/postgrest-v16.5/postgrest /tmp/onetab-b4-postgrest.conf >/tmp/onetab-b4-postgrest.log 2>&1 &
echo $! > /tmp/onetab-b4-postgrest.pid
ready=0
for _ in $(seq 1 30); do
  if grep -qi "listening" /tmp/onetab-b4-postgrest.log; then ready=1; break; fi
  sleep 0.2
done
test "$ready" = "1"
export B4_PHASE=read
export B4_ATTEMPT_ID="$attempt_id"
./node_modules/.bin/vitest run --config artifacts/onetab-lead/vitest.harness.mts
echo "B4 local Postgres concurrency, process restart, and Payments PostgREST progress passed."
