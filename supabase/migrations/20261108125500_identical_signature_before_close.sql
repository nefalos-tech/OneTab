create or replace function public.put_attempt_signature(p_attempt_id uuid, p_signer_wallet text, p_message_hash text, p_signature text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare a public.attempts%rowtype;
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform 1 from public.checkouts where id=a.checkout_id for update;
  select * into a from public.attempts where id=p_attempt_id for update;
  -- The stored bytes are the idempotency key. Collection may already have closed.
  if p_signature ~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then
    if octet_length(pg_catalog.decode(p_signature,'base64')) = 64
       and a.message_hash = p_message_hash
       and exists(select 1 from public.attempt_participants where attempt_id=p_attempt_id and wallet=p_signer_wallet)
       and exists(select 1 from public.signatures where attempt_id=p_attempt_id and signer_wallet=p_signer_wallet and signature=pg_catalog.decode(p_signature,'base64')) then
      return private.attempt_snapshot(p_attempt_id);
    end if;
  end if;
  if a.state <> 'signing' or a.message_hash <> p_message_hash or p_signature !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' or octet_length(pg_catalog.decode(p_signature,'base64')) <> 64 or not exists(select 1 from public.attempt_participants where attempt_id=p_attempt_id and wallet=p_signer_wallet) then raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode='P0001'; end if;
  insert into public.signatures(attempt_id,signer_wallet,signature) values(p_attempt_id,p_signer_wallet,pg_catalog.decode(p_signature,'base64')) on conflict(attempt_id,signer_wallet) do nothing;
  if exists(select 1 from public.signatures where attempt_id=p_attempt_id and signer_wallet=p_signer_wallet and signature <> pg_catalog.decode(p_signature,'base64')) then raise exception 'MESSAGE_MISMATCH' using errcode='P0001'; end if;
  return private.attempt_snapshot(p_attempt_id);
end $$;

revoke all on function public.put_attempt_signature(uuid, text, text, text) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then execute 'revoke all on function public.put_attempt_signature(uuid, text, text, text) from anon'; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then execute 'revoke all on function public.put_attempt_signature(uuid, text, text, text) from authenticated'; end if;
  if exists(select 1 from pg_roles where rolname='service_role') then execute 'grant execute on function public.put_attempt_signature(uuid, text, text, text) to service_role'; end if;
end $$;
