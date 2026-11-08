do $$
declare
  creator name;
  seen name[] := '{}';
  fn record;
begin
  foreach creator in array array['postgres', 'supabase_admin', current_user]::name[] loop
    if creator = any(seen) or not exists (select 1 from pg_roles where rolname = creator) then
      continue;
    end if;
    seen := seen || creator;
    execute format('alter default privileges for role %I revoke execute on functions from public', creator);
    execute format('alter default privileges for role %I in schema public revoke execute on functions from public', creator);
    execute format('alter default privileges for role %I in schema private revoke execute on functions from public', creator);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('alter default privileges for role %I revoke execute on functions from anon', creator);
      execute format('alter default privileges for role %I in schema public revoke execute on functions from anon', creator);
      execute format('alter default privileges for role %I in schema private revoke execute on functions from anon', creator);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('alter default privileges for role %I revoke execute on functions from authenticated', creator);
      execute format('alter default privileges for role %I in schema public revoke execute on functions from authenticated', creator);
      execute format('alter default privileges for role %I in schema private revoke execute on functions from authenticated', creator);
    end if;
  end loop;

  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
  loop
    execute format('alter function %I.%I(%s) security invoker', fn.nspname, fn.proname, fn.args);
  end loop;

  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %I.%I(%s) from public', fn.nspname, fn.proname, fn.args);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %I.%I(%s) from anon', fn.nspname, fn.proname, fn.args);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %I.%I(%s) from authenticated', fn.nspname, fn.proname, fn.args);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %I.%I(%s) to service_role', fn.nspname, fn.proname, fn.args);
    end if;
  end loop;
end $$;

revoke all on function private.attempt_snapshot(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function private.attempt_snapshot(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function private.attempt_snapshot(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema private to service_role';
    execute 'grant execute on function private.attempt_snapshot(uuid) to service_role';
  end if;
end $$;
