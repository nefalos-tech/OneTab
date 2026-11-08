\set ON_ERROR_STOP on

do $exposure$
declare
  fn record;
  call text;
  reasons text := '';
  anon_future boolean;
  authenticated_future boolean;
  public_future boolean;
  admin_anon boolean;
  admin_authenticated boolean;
  admin_public boolean;
begin
  begin
    execute 'set local role postgres';
    execute 'alter default privileges for role supabase_admin revoke execute on functions from public';
    reasons := reasons || 'postgres_changed_supabase_admin_defaults ';
    execute 'reset role';
  exception
    when insufficient_privilege then
      execute 'reset role';
  end;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
  ) then
    select reasons || 'definers=' || count(*) || ' '
    into reasons
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not (p.proconfig @> array['search_path=""'])
  ) then
    reasons := reasons || 'search_path ';
  end if;

  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) <> 9
     or not has_table_privilege('service_role', 'public.signatures', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.signatures', 'select')
     or has_table_privilege('authenticated', 'public.wallet_sessions', 'select') then
    reasons := reasons || 'table_boundary ';
  end if;

  if has_schema_privilege('anon', 'private', 'usage')
     or has_schema_privilege('authenticated', 'private', 'usage')
     or not has_schema_privilege('service_role', 'private', 'usage')
     or has_schema_privilege('service_role', 'private', 'create') then
    reasons := reasons || 'private_schema ';
  end if;

  for fn in
    select n.nspname, p.proname, p.prorettype,
           coalesce((
             select string_agg('null::' || pg_catalog.format_type(arg.type_oid, null), ', ' order by arg.ordinality)
             from unnest(p.proargtypes) with ordinality as arg(type_oid, ordinality)
           ), '') as nulls
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
    order by n.nspname, p.proname
  loop
    call := format('select %I.%I(%s)', fn.nspname, fn.proname, fn.nulls);
    execute 'reset role';
    begin
      execute 'set local role anon';
      execute call;
      reasons := reasons || format('anon_ran %s.%s ', fn.nspname, fn.proname);
      execute 'reset role';
    exception
      when insufficient_privilege then
        execute 'reset role';
      when others then
        reasons := reasons || format('anon_entered %s.%s:%s ', fn.nspname, fn.proname, sqlstate);
        execute 'reset role';
    end;

    execute 'reset role';
    begin
      execute 'set local role authenticated';
      execute call;
      reasons := reasons || format('authenticated_ran %s.%s ', fn.nspname, fn.proname);
      execute 'reset role';
    exception
      when insufficient_privilege then
        execute 'reset role';
      when others then
        reasons := reasons || format('authenticated_entered %s.%s:%s ', fn.nspname, fn.proname, sqlstate);
        execute 'reset role';
    end;

    if fn.prorettype = 'trigger'::regtype then
      execute 'reset role';
      begin
        execute 'set local role service_role';
        execute call;
        reasons := reasons || format('service_trigger_ran %s ', fn.proname);
        execute 'reset role';
      exception
        when insufficient_privilege then
          reasons := reasons || format('service_denied %s ', fn.proname);
          execute 'reset role';
        when others then
          execute 'reset role';
      end;
    else
      execute 'reset role';
      begin
        execute 'set local role service_role';
        execute call;
        execute 'reset role';
      exception
        when insufficient_privilege then
          reasons := reasons || format('service_denied %s.%s ', fn.nspname, fn.proname);
          execute 'reset role';
        when syntax_error or undefined_function then
          raise;
        when others then
          execute 'reset role';
      end;
    end if;
  end loop;

  execute 'reset role';
  execute 'set local role postgres';
  execute $sql$create function public.onetab_future_probe() returns integer language sql set search_path = '' as $fn$ select 1 $fn$$sql$;
  execute 'reset role';
  anon_future := has_function_privilege('anon', 'public.onetab_future_probe()', 'execute');
  authenticated_future := has_function_privilege('authenticated', 'public.onetab_future_probe()', 'execute');
  public_future := has_function_privilege('public', 'public.onetab_future_probe()', 'execute');
  execute 'drop function public.onetab_future_probe()';
  if anon_future or authenticated_future or public_future then
    reasons := reasons || format('future_postgres anon=%s authenticated=%s public=%s ', anon_future, authenticated_future, public_future);
  end if;

  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'set local role supabase_admin';
    execute $sql$create function public.onetab_admin_probe() returns integer language sql set search_path = '' as $fn$ select 1 $fn$$sql$;
    execute 'reset role';
    admin_anon := has_function_privilege('anon', 'public.onetab_admin_probe()', 'execute');
    admin_authenticated := has_function_privilege('authenticated', 'public.onetab_admin_probe()', 'execute');
    admin_public := has_function_privilege('public', 'public.onetab_admin_probe()', 'execute');
    execute 'drop function public.onetab_admin_probe()';
    if not admin_anon or not admin_authenticated or not admin_public then
      reasons := reasons || format('admin_defaults_closed anon=%s authenticated=%s public=%s ', admin_anon, admin_authenticated, admin_public);
    end if;
  end if;

  if reasons <> '' then
    raise exception '%', btrim(reasons);
  end if;
end
$exposure$;
