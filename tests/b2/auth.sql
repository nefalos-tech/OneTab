\set ON_ERROR_STOP on
do $$
declare challenge_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
declare result record;
declare used_error text;
declare i integer;
begin
  select * into result from public.issue_auth_challenge(
    challenge_id, 'wallet-one', 'http://localhost:3000', 'authenticate', decode('010203','hex'), now() + interval '5 minutes'
  );
  if result.wallet <> 'wallet-one' or result.origin <> 'http://localhost:3000' or result.message_bytes <> decode('010203','hex') then
    raise exception 'challenge fields changed';
  end if;
  for i in 1..5 loop
    perform * from public.claim_auth_verification(challenge_id, 'http://localhost:3000');
  end loop;
  begin
    perform * from public.claim_auth_verification(challenge_id, 'http://localhost:3000');
    raise exception 'signature verification limit was not enforced';
  exception when sqlstate 'P0001' then
    get stacked diagnostics used_error = message_text;
    if used_error <> 'RATE_LIMITED' then raise; end if;
  end;
  select * into result from public.consume_auth_challenge(
    challenge_id, 'wallet-one', 'http://localhost:3000', 'authenticate', decode(repeat('ab',32),'hex'), now() + interval '12 hours'
  );
  if result.wallet <> 'wallet-one' then raise exception 'session wallet mismatch'; end if;
  if not exists (select 1 from public.wallet_sessions where token_hash = decode(repeat('ab',32),'hex') and wallet = 'wallet-one') then
    raise exception 'session token hash was not persisted';
  end if;
  begin
    perform * from public.consume_auth_challenge(
      challenge_id, 'wallet-one', 'http://localhost:3000', 'authenticate', decode(repeat('cd',32),'hex'), now() + interval '12 hours'
    );
    raise exception 'challenge was consumed twice';
  exception when sqlstate 'P0001' then
    get stacked diagnostics used_error = message_text;
    if used_error <> 'CHALLENGE_USED' then raise; end if;
  end;
  for i in 1..5 loop
    perform * from public.issue_auth_challenge(gen_random_uuid(), 'wallet-two', 'http://localhost:3000', 'authenticate', decode('01','hex'), now() + interval '5 minutes');
  end loop;
  begin
    perform * from public.issue_auth_challenge(gen_random_uuid(), 'wallet-two', 'http://localhost:3000', 'authenticate', decode('01','hex'), now() + interval '5 minutes');
    raise exception 'rate limit was not enforced';
  exception when sqlstate 'P0001' then
    get stacked diagnostics used_error = message_text;
    if used_error <> 'RATE_LIMITED' then raise; end if;
  end;
end $$;
select
  has_function_privilege('anon', 'public.issue_auth_challenge(uuid,text,text,text,bytea,timestamp with time zone)', 'execute') as anon_issue,
  has_function_privilege('authenticated', 'public.consume_auth_challenge(uuid,text,text,text,bytea,timestamp with time zone)', 'execute') as authenticated_consume,
  has_function_privilege('anon', 'public.claim_auth_verification(uuid,text)', 'execute') as anon_verify,
  has_function_privilege('service_role', 'public.issue_auth_challenge(uuid,text,text,text,bytea,timestamp with time zone)', 'execute') as service_issue,
  (select count(*) = 6 from public.auth_challenges) as persisted_challenges,
  (select count(*) = 1 from public.wallet_sessions) as one_session;
