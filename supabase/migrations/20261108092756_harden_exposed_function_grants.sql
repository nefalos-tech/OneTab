do $$
declare
  definers regprocedure[] := array[
    'private.attempt_snapshot(uuid)',
    'public.claim_attempt_preparation(uuid)',
    'public.claim_attempt_resolution(uuid)',
    'public.claim_attempt_submission(uuid,text,text)',
    'public.claim_auth_verification(uuid,text)',
    'public.checkout_room_snapshot(uuid)',
    'public.consume_auth_challenge(uuid,text,text,text,bytea,timestamptz)',
    'public.create_checkout(uuid,uuid,text,text,text,numeric,smallint,text,text,smallint)',
    'public.decline_attempt(uuid,text)',
    'public.freeze_attempt_message(uuid,uuid,jsonb)',
    'public.get_attempt(uuid)',
    'public.issue_auth_challenge(uuid,text,text,text,bytea,timestamptz)',
    'public.join_checkout(uuid,text)',
    'public.put_attempt_signature(uuid,text,text,text)',
    'public.record_attempt_outcome(uuid,uuid,jsonb)',
    'public.reserve_attempt(uuid,text,uuid)',
    'public.set_checkout_readiness(uuid,text,boolean)'
  ]::regprocedure[];
  triggers regprocedure[] := array[
    'public.check_frozen_participant()',
    'public.check_participant()',
    'public.guard_immutable()',
    'public.guard_participant_identity()'
  ]::regprocedure[];
  actual_definers oid[];
  expected_definers oid[];
  actual_triggers oid[];
  expected_triggers oid[];
  signature regprocedure;
  found text;
begin
  select coalesce(array_agg(p.oid order by p.oid), '{}') into actual_definers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef;
  select array_agg(fn::oid order by fn::oid) into expected_definers from unnest(definers) as fn;
  if actual_definers is distinct from expected_definers then
    select coalesce(string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by n.nspname, p.proname), '<none>')
    into found
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef;
    raise exception 'OneTab security definer inventory mismatch: %', found;
  end if;

  select coalesce(array_agg(p.oid order by p.oid), '{}') into actual_triggers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prorettype = 'trigger'::regtype;
  select array_agg(fn::oid order by fn::oid) into expected_triggers from unnest(triggers) as fn;
  if actual_triggers is distinct from expected_triggers then
    select coalesce(string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by n.nspname, p.proname), '<none>')
    into found
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prorettype = 'trigger'::regtype;
    raise exception 'OneTab trigger inventory mismatch: %', found;
  end if;

  foreach signature in array definers loop
    execute format('alter function %s security invoker', signature::text);
  end loop;
  foreach signature in array triggers loop
    execute format('revoke all on function %s from public', signature::text);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', signature::text);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', signature::text);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', signature::text);
    end if;
  end loop;

  alter default privileges revoke execute on functions from public;
  alter default privileges in schema public revoke execute on functions from public;
  alter default privileges in schema private revoke execute on functions from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    alter default privileges revoke execute on functions from anon;
    alter default privileges in schema public revoke execute on functions from anon;
    alter default privileges in schema private revoke execute on functions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter default privileges revoke execute on functions from authenticated;
    alter default privileges in schema public revoke execute on functions from authenticated;
    alter default privileges in schema private revoke execute on functions from authenticated;
  end if;

  revoke all on function private.attempt_snapshot(uuid) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function private.attempt_snapshot(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.attempt_snapshot(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema private to service_role;
    grant execute on function private.attempt_snapshot(uuid) to service_role;
  end if;
end $$;
