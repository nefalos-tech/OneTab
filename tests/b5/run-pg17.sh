#!/usr/bin/env bash
set -euo pipefail
root="${PG17_ROOT:-/tmp/onetab-pg17-root}"
bin="$root/usr/lib/postgresql/17/bin"
share="$root/usr/share/postgresql/17"
data="${PG17_DATA:-/tmp/onetab-pg17-invoker}"
port="${PG17_PORT:-55433}"
repo="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
export LD_LIBRARY_PATH="$root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [ ! -x "$bin/initdb" ]; then
  echo "missing official PostgreSQL 17 binaries at $bin" >&2
  exit 1
fi
rm -rf "$data"
"$bin/initdb" -D "$data" -L "$share" --username=onetab --auth=trust --locale=C --encoding=UTF8 >/tmp/onetab-pg17-invoker-initdb.log
cleanup() {
  "$bin/pg_ctl" -D "$data" -m fast -w stop >/tmp/onetab-pg17-invoker-stop.log 2>&1 || true
  rm -rf "$data"
}
trap cleanup EXIT
"$bin/pg_ctl" -D "$data" -l "$data/server.log" -w start -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=$data"
psql() {
  "$bin/psql" -h 127.0.0.1 -p "$port" -U onetab -d "$1" -v ON_ERROR_STOP=1 -X "${@:2}"
}
psql postgres -c "create role anon nologin nosuperuser nobypassrls; create role authenticated nologin nosuperuser nobypassrls; create role service_role nologin nosuperuser bypassrls; create role supabase_admin superuser nologin; create role postgres nosuperuser createrole createdb login bypassrls;"
echo "ROLE $(psql postgres -At -c "select rolsuper::text || ' member=' || pg_has_role('postgres','supabase_admin','member')::text from pg_roles where rolname='postgres'")"
apply() {
  local database="$1"
  local file="$2"
  "$bin/psql" -h 127.0.0.1 -p "$port" -U onetab -d "$database" -v ON_ERROR_STOP=1 -X -1 <<EOF
set role postgres;
\\i $file
EOF
}
prepare() {
  local database="$1"
  local file
  psql postgres -c "create database ${database} owner postgres"
  psql "$database" <<'SQL'
set role postgres;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
reset role;
set role supabase_admin;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
reset role;
SQL
  for file in "$repo"/supabase/migrations/*.sql; do
    apply "$database" "$file" >/dev/null
  done
}
echo "INVENTORY"
psql postgres -c "create database inventory owner postgres"
psql inventory <<'SQL'
set role postgres;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
reset role;
SQL
for file in "$repo"/supabase/migrations/20261107000000_b1_schema.sql "$repo"/supabase/migrations/20261107010000_b2_auth.sql "$repo"/supabase/migrations/20261107020000_b3_rooms.sql "$repo"/supabase/migrations/20261108000000_b4_attempt_store.sql; do
  apply inventory "$file" >/dev/null
done
psql inventory <<'SQL'
set role postgres;
create function public.unrelated_definer() returns integer language sql security definer set search_path = '' as $$ select 1 $$;
reset role;
SQL
if apply inventory "$repo/supabase/migrations/20261108092756_harden_exposed_function_grants.sql" >/tmp/onetab-pg17-inventory.out 2>&1; then
  echo "inventory guard applied over an unrelated security definer" >&2
  exit 1
fi
if ! grep -q "OneTab security definer inventory mismatch" /tmp/onetab-pg17-inventory.out; then
  cat /tmp/onetab-pg17-inventory.out >&2
  exit 1
fi
echo "INVENTORY_STOPPED $(psql inventory -At -c "select p.proname || '=' || p.prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('unrelated_definer','get_attempt') order by 1")"
echo "EXPOSURE"
prepare exposure
psql exposure -f "$repo/tests/b5/exposure.sql"
echo "SERVICE_ROLE b1"
prepare b1
psql b1 -c "set role service_role" -f "$repo/tests/b1/schema.sql"
echo "SERVICE_ROLE b2"
prepare b2
psql b2 -c "set role service_role" -f "$repo/tests/b2/auth.sql"
echo "SERVICE_ROLE b3"
prepare b3
psql b3 -c "set role service_role" -f "$repo/tests/b3/rooms.sql"
echo "SERVICE_ROLE b4"
prepare b4
psql b4 -c "set role service_role" -f "$repo/tests/b4/attempt-store.sql"
echo "PG17_OK $($bin/postgres --version)"
