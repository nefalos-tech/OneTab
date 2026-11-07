create or replace function public.issue_auth_challenge(
  p_id uuid,
  p_wallet text,
  p_origin text,
  p_purpose text,
  p_message_bytes bytea,
  p_expires_at timestamptz
) returns table (id uuid, wallet text, origin text, purpose text, message_bytes bytea, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare recent_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_wallet || ':' || p_origin, 0));
  select count(*) into recent_count from public.auth_challenges c
  where c.wallet = p_wallet and c.origin = p_origin and c.created_at > now() - interval '1 minute';
  if recent_count >= 5 then raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;
  return query insert into public.auth_challenges as c (id, wallet, origin, purpose, message_bytes, expires_at)
  values (p_id, p_wallet, p_origin, p_purpose, p_message_bytes, p_expires_at)
  returning c.id, c.wallet, c.origin, c.purpose, c.message_bytes, c.expires_at;
end $$;

create or replace function public.consume_auth_challenge(
  p_id uuid,
  p_wallet text,
  p_origin text,
  p_purpose text,
  p_token_hash bytea,
  p_session_expires_at timestamptz
) returns table (wallet text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare challenge public.auth_challenges%rowtype;
begin
  select * into challenge from public.auth_challenges c
  where c.id = p_id for update;
  if not found or challenge.consumed_at is not null then raise exception 'CHALLENGE_USED' using errcode = 'P0001'; end if;
  if challenge.expires_at <= now() then raise exception 'CHALLENGE_EXPIRED' using errcode = 'P0001'; end if;
  if challenge.wallet <> p_wallet or challenge.origin <> p_origin or challenge.purpose <> p_purpose then
    raise exception 'ORIGIN_MISMATCH' using errcode = 'P0001';
  end if;
  update public.auth_challenges set consumed_at = now() where id = p_id;
  insert into public.wallet_sessions (token_hash, wallet, expires_at) values (p_token_hash, challenge.wallet, p_session_expires_at);
  return query select challenge.wallet, p_session_expires_at;
end $$;

alter table public.auth_challenges add column verification_attempts smallint not null default 0 check (verification_attempts between 0 and 5);

create or replace function public.claim_auth_verification(p_id uuid, p_origin text)
returns table (wallet text, origin text, purpose text, message_bytes bytea, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare challenge public.auth_challenges%rowtype;
begin
  select * into challenge from public.auth_challenges c where c.id = p_id for update;
  if not found or challenge.consumed_at is not null then raise exception 'CHALLENGE_USED' using errcode = 'P0001'; end if;
  if challenge.expires_at <= now() then raise exception 'CHALLENGE_EXPIRED' using errcode = 'P0001'; end if;
  if challenge.origin <> p_origin then raise exception 'ORIGIN_MISMATCH' using errcode = 'P0001'; end if;
  if challenge.verification_attempts >= 5 then raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;
  update public.auth_challenges set verification_attempts = verification_attempts + 1 where id = p_id;
  return query select challenge.wallet, challenge.origin, challenge.purpose, challenge.message_bytes, challenge.expires_at;
end $$;

revoke all on function public.issue_auth_challenge(uuid, text, text, text, bytea, timestamptz) from public;
revoke all on function public.consume_auth_challenge(uuid, text, text, text, bytea, timestamptz) from public;
revoke all on function public.claim_auth_verification(uuid, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.issue_auth_challenge(uuid, text, text, text, bytea, timestamptz) from anon';
    execute 'revoke all on function public.consume_auth_challenge(uuid, text, text, text, bytea, timestamptz) from anon';
    execute 'revoke all on function public.claim_auth_verification(uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.issue_auth_challenge(uuid, text, text, text, bytea, timestamptz) from authenticated';
    execute 'revoke all on function public.consume_auth_challenge(uuid, text, text, text, bytea, timestamptz) from authenticated';
    execute 'revoke all on function public.claim_auth_verification(uuid, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.issue_auth_challenge(uuid, text, text, text, bytea, timestamptz) to service_role';
    execute 'grant execute on function public.consume_auth_challenge(uuid, text, text, text, bytea, timestamptz) to service_role';
    execute 'grant execute on function public.claim_auth_verification(uuid, text) to service_role';
  end if;
end $$;
