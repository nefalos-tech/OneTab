#!/usr/bin/env bash
set -euo pipefail
root="${PG17_ROOT:-/tmp/onetab-pg17-root}"
bin="$root/usr/lib/postgresql/17/bin"
share="$root/usr/share/postgresql/17"
postgrest="${POSTGREST_BIN:-/tmp/postgrest-v16.5/postgrest}"
repo="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
omit="${ONETAB_OMIT_MIGRATION:-}"
harden_name="20261108092756_harden_exposed_function_grants.sql"
shopt -s nullglob
migration_files=("$repo"/supabase/migrations/*.sql)
shopt -u nullglob
if [ "${#migration_files[@]}" -eq 0 ]; then
  echo "no reviewed migrations" >&2
  exit 1
fi
if [ -n "$omit" ]; then
  if [ "$omit" = "$harden_name" ]; then
    echo "refusing to omit the non-repeatable hardening migration" >&2
    exit 1
  fi
  found=0
  for file in "${migration_files[@]}"; do
    if [ "$(basename "$file")" = "$omit" ]; then found=1; fi
  done
  if [ "$found" -ne 1 ]; then
    echo "ONETAB_OMIT_MIGRATION is not one reviewed migration: $omit" >&2
    exit 1
  fi
fi
base="${TMPDIR:-/tmp}"
data="$(mktemp -d "${base}/onetab-identical-signature.XXXXXX")"
case "$data" in
  "${base}/"*) ;;
  *) echo "data directory is outside TMPDIR: $data" >&2; exit 1 ;;
esac
echo "DATA_DIR $data"
port="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
rest_port="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
export LD_LIBRARY_PATH="$root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [ ! -x "$bin/initdb" ] || [ ! -x "$postgrest" ]; then
  echo "missing PostgreSQL 17 binaries or PostgREST" >&2
  exit 1
fi
rest_pid=""
cleanup() {
  if [ -n "$rest_pid" ]; then kill "$rest_pid" >/dev/null 2>&1 || true; wait "$rest_pid" >/dev/null 2>&1 || true; fi
  "$bin/pg_ctl" -D "$data" -m fast -w stop >/dev/null 2>&1 || true
  rm -rf "$data"
}
trap cleanup EXIT
"$bin/initdb" -D "$data" -L "$share" --username=onetab --auth=trust --locale=C --encoding=UTF8 >/dev/null
"$bin/pg_ctl" -D "$data" -l "$data/server.log" -w start -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=$data" >/dev/null
psql() { "$bin/psql" -h 127.0.0.1 -p "$port" -U onetab -d "$1" -v ON_ERROR_STOP=1 -X "${@:2}"; }
password="$(node -e 'console.log(require("crypto").randomBytes(18).toString("hex"))')"
secret="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
token="$(node -e 'const {createHmac}=require("crypto"); const header=Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url"); const payload=Buffer.from(JSON.stringify({role:"service_role",exp:Math.floor(Date.now()/1000)+3600})).toString("base64url"); const body=`${header}.${payload}`; process.stdout.write(`${body}.${createHmac("sha256", process.argv[1]).update(body).digest("base64url")}`)' "$secret")"
psql postgres -c "create role anon nologin nosuperuser nobypassrls; create role authenticated nologin nosuperuser nobypassrls; create role service_role nologin nosuperuser bypassrls; create role postgres nosuperuser createrole createdb login bypassrls; create role authenticator noinherit login password '$password'; grant anon, authenticated, service_role to authenticator;"
psql postgres -c "create database identical owner postgres"
psql identical <<'SQL'
set role postgres;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
reset role;
SQL
harden_count=0
applied=0
for file in "${migration_files[@]}"; do
  name="$(basename "$file")"
  if [ "$name" = "$omit" ]; then
    continue
  fi
  if [ "$name" = "$harden_name" ]; then
    harden_count=$((harden_count + 1))
  fi
  "$bin/psql" -h 127.0.0.1 -p "$port" -U onetab -d identical -v ON_ERROR_STOP=1 -X -1 <<EOF >/dev/null
set role postgres;
\\i $file
EOF
  applied=$((applied + 1))
done
if [ "$harden_count" -ne 1 ]; then
  echo "non-repeatable hardening applied ${harden_count} times" >&2
  exit 1
fi
echo "MIGRATIONS applied=$applied harden=1 omit=${omit:-none}"
if [ -n "$omit" ]; then
  psql identical <<'SQL' >/dev/null
set role service_role;
do $$ begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'put_attempt_signature'
      and (p.prosecdef or not (p.proconfig @> array['search_path=""']))
  ) then raise exception 'put_attempt_signature lost invoker or search_path'; end if;
end $$;
SQL
  set +e
  sequential="$(psql identical -c "set role service_role" -f "$repo/tests/b4/identical-signature-after-close.sql" 2>&1)"
  sequential_status=$?
  set -e
  if [ "$sequential_status" -eq 0 ] || ! printf '%s\n' "$sequential" | grep -q 'ATTEMPT_NOT_SIGNABLE'; then
    printf '%s\n' "$sequential" >&2
    echo "omitted migration still accepted an identical signature after close" >&2
    exit 1
  fi
  echo "NEGATIVE_SEQUENTIAL ok"
  psql identical <<'SQL'
set role service_role;
select public.create_checkout('20000000-0000-4000-8000-000000000094','20000000-0000-4000-8000-0000000000a4','Omitted migration overlap','organizer-4','seller-4',10,2::smallint,'devnet','mint',6::smallint);
select public.join_checkout('20000000-0000-4000-8000-000000000094','payer-4');
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000094','organizer-4',true);
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000094','payer-4',true);
SQL
  attempt="$(psql identical -At -c "set role service_role; select public.reserve_attempt('20000000-0000-4000-8000-000000000094','organizer-4',null)->>'id'" | tail -n 1)"
  lease="$(psql identical -At -c "set role service_role; select public.claim_attempt_preparation('${attempt}')->>'token'" | tail -n 1)"
  hash="$(node -e 'process.stdout.write("6".repeat(64))')"
  signature="$(node -e 'process.stdout.write("F".repeat(86) + "==")')"
  psql identical -c "set role service_role; select public.freeze_attempt_message('${attempt}'::uuid,'${lease}'::uuid, jsonb_build_object('attemptId','${attempt}','checkoutId','20000000-0000-4000-8000-000000000094','transactionBase64','RklYVFVSRQ==','messageBase64','RklYVFVSRQ==','messageHash','${hash}','blockhash',repeat('7',32),'lastValidBlockHeight','123456','payment',jsonb_build_object('network','devnet','mint','mint','tokenDecimals',6,'sellerWallet','seller-4','sellerTokenAccount','seller-token-4','feePayerWallet','organizer-4','contributions',jsonb_build_array(jsonb_build_object('slot',0,'wallet','organizer-4','amountUnits','5','sourceTokenAccount','source-g'),jsonb_build_object('slot',1,'wallet','payer-4','amountUnits','5','sourceTokenAccount','source-h')))))" >/dev/null
  "$bin/psql" -h 127.0.0.1 -p "$port" -U onetab -d identical -v ON_ERROR_STOP=1 -X >/dev/null <<SQL &
set role service_role;
begin;
select id from public.checkouts where id='20000000-0000-4000-8000-000000000094' for update;
select pg_sleep(2);
select public.put_attempt_signature('${attempt}'::uuid,'organizer-4','${hash}','${signature}');
select public.decline_attempt('${attempt}'::uuid,'payer-4');
commit;
SQL
  holder=$!
  seen=""
  for _ in $(seq 1 50); do
    if psql identical -At -c "select 1 from pg_stat_activity where state='active' and query like '%pg_sleep(2)%' limit 1" | grep -q 1; then
      seen=1
      break
    fi
    sleep 0.05
  done
  if [ -z "$seen" ]; then
    echo "holder did not keep the checkout lock" >&2
    wait "$holder" || true
    exit 1
  fi
  replay_started="$(date +%s%3N)"
  set +e
  replay_err="$(psql identical -At -c "set role service_role; select public.put_attempt_signature('${attempt}'::uuid,'organizer-4','${hash}','${signature}')->>'state'" 2>&1)"
  replay_status=$?
  set -e
  holder_status=0
  wait "$holder" || holder_status=$?
  replay_ms="$(( $(date +%s%3N) - replay_started ))"
  if [ "$holder_status" -ne 0 ] || [ "$replay_status" -eq 0 ] || ! printf '%s\n' "$replay_err" | grep -q 'ATTEMPT_NOT_SIGNABLE' || [ "$replay_ms" -lt 500 ]; then
    echo "omitted migration did not fail the overlapping put holder=$holder_status status=$replay_status waited_ms=$replay_ms" >&2
    printf '%s\n' "$replay_err" >&2
    exit 1
  fi
  echo "NEGATIVE_OVERLAP ok waited_ms=$replay_ms"
  echo "NEGATIVE_CONTROL ok omit=$omit"
  exit 0
fi
psql identical -c "set role service_role" -f "$repo/tests/b4/identical-signature-after-close.sql" >/dev/null
psql identical -c "set role service_role" -f "$repo/tests/b4/attempt-store.sql" >/dev/null
echo "SEQUENTIAL_CLOSED_GATE ok"

psql identical <<'SQL'
set role service_role;
select public.create_checkout('20000000-0000-4000-8000-000000000093','20000000-0000-4000-8000-0000000000a3','Overlapping identical signature','organizer-3','seller-3',10,2::smallint,'devnet','mint',6::smallint);
select public.join_checkout('20000000-0000-4000-8000-000000000093','payer-3');
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000093','organizer-3',true);
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000093','payer-3',true);
SQL
attempt="$(psql identical -At -c "set role service_role; select public.reserve_attempt('20000000-0000-4000-8000-000000000093','organizer-3',null)->>'id'" | tail -n 1)"
lease="$(psql identical -At -c "set role service_role; select public.claim_attempt_preparation('${attempt}')->>'token'" | tail -n 1)"
hash="$(node -e 'process.stdout.write("4".repeat(64))')"
signature="$(node -e 'process.stdout.write("E".repeat(86) + "==")')"
psql identical -c "set role service_role; select public.freeze_attempt_message('${attempt}'::uuid,'${lease}'::uuid, jsonb_build_object('attemptId','${attempt}','checkoutId','20000000-0000-4000-8000-000000000093','transactionBase64','RklYVFVSRQ==','messageBase64','RklYVFVSRQ==','messageHash','${hash}','blockhash',repeat('5',32),'lastValidBlockHeight','123456','payment',jsonb_build_object('network','devnet','mint','mint','tokenDecimals',6,'sellerWallet','seller-3','sellerTokenAccount','seller-token-3','feePayerWallet','organizer-3','contributions',jsonb_build_array(jsonb_build_object('slot',0,'wallet','organizer-3','amountUnits','5','sourceTokenAccount','source-e'),jsonb_build_object('slot',1,'wallet','payer-3','amountUnits','5','sourceTokenAccount','source-f')))))" >/dev/null
"$bin/psql" -h 127.0.0.1 -p "$port" -U onetab -d identical -v ON_ERROR_STOP=1 -X >/dev/null <<SQL &
set role service_role;
begin;
select id from public.checkouts where id='20000000-0000-4000-8000-000000000093' for update;
select pg_sleep(2);
select public.put_attempt_signature('${attempt}'::uuid,'organizer-3','${hash}','${signature}');
select public.decline_attempt('${attempt}'::uuid,'payer-3');
commit;
SQL
holder=$!
seen=""
for _ in $(seq 1 50); do
  if psql identical -At -c "select 1 from pg_stat_activity where state='active' and query like '%pg_sleep(2)%' limit 1" | grep -q 1; then
    seen=1
    break
  fi
  sleep 0.05
done
if [ -z "$seen" ]; then
  echo "holder did not keep the checkout lock" >&2
  wait "$holder" || true
  exit 1
fi
replay_started="$(date +%s%3N)"
replay="$(psql identical -At -c "set role service_role; select public.put_attempt_signature('${attempt}'::uuid,'organizer-3','${hash}','${signature}')->>'state'" | tail -n 1)"
wait "$holder"
replay_ms="$(( $(date +%s%3N) - replay_started ))"
count="$(psql identical -At -c "set role service_role; select count(*) from public.signatures where attempt_id='${attempt}'" | tail -n 1)"
if [ "$replay" != "declined" ] || [ "$count" != "1" ] || [ "$replay_ms" -lt 500 ]; then
  echo "overlapping identical put returned state=$replay signatures=$count waited_ms=$replay_ms" >&2
  exit 1
fi
echo "OVERLAP_CLOSED_GATE ok state=$replay signatures=$count waited_ms=$replay_ms"

cat >"$data/postgrest.conf" <<EOF
db-uri = "postgresql://authenticator:${password}@127.0.0.1:${port}/identical"
db-schemas = "public"
db-anon-role = "anon"
db-config = false
db-channel-enabled = false
jwt-secret = "${secret}"
server-host = "127.0.0.1"
server-port = ${rest_port}
log-level = "warn"
EOF
"$postgrest" "$data/postgrest.conf" >"$data/postgrest.log" 2>&1 &
rest_pid=$!
ready=""
for _ in $(seq 1 25); do
  if curl -sf -o /dev/null "http://127.0.0.1:${rest_port}/"; then ready=1; break; fi
  sleep 0.2
done
if [ -z "$ready" ]; then
  cat "$data/postgrest.log" >&2
  exit 1
fi
body="$(node -e 'process.stdout.write(JSON.stringify({p_attempt_id:process.argv[1],p_signer_wallet:"organizer-3",p_message_hash:process.argv[2],p_signature:process.argv[3]}))' "$attempt" "$hash" "$signature")"
http="$(curl -sS -o "$data/replay.json" -w "%{http_code}" -X POST "http://127.0.0.1:${rest_port}/rpc/put_attempt_signature" -H "authorization: Bearer ${token}" -H "content-type: application/json" -d "$body")"
if [ "$http" != "200" ] || ! grep -q '"declined"' "$data/replay.json"; then
  echo "PostgREST identical replay status=$http" >&2
  cat "$data/replay.json" >&2
  exit 1
fi
fresh="$(node -e 'process.stdout.write(JSON.stringify({p_attempt_id:process.argv[1],p_signer_wallet:"payer-3",p_message_hash:process.argv[2],p_signature:"B".repeat(86)+"=="}))' "$attempt" "$hash")"
denied="$(curl -sS -o "$data/denied.json" -w "%{http_code}" -X POST "http://127.0.0.1:${rest_port}/rpc/put_attempt_signature" -H "authorization: Bearer ${token}" -H "content-type: application/json" -d "$fresh")"
if [ "$denied" = "200" ] || ! grep -q 'ATTEMPT_NOT_SIGNABLE' "$data/denied.json"; then
  echo "PostgREST accepted a new signature after close status=$denied" >&2
  cat "$data/denied.json" >&2
  exit 1
fi
echo "POSTGREST_CLOSED_GATE ok replay=$http denied=$denied"
