create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then execute 'revoke all on schema private from anon'; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then execute 'revoke all on schema private from authenticated'; end if;
end $$;

alter table public.attempts add column resolution_token uuid, add column resolution_expires_at timestamptz;

create function private.attempt_snapshot(p_attempt_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'checkoutId', a.checkout_id, 'state', a.state, 'safelyResolved', a.safely_resolved,
    'observedError', a.observed_error,
    'preparationLease', case when a.preparation_token is null then null else jsonb_build_object('token', a.preparation_token, 'expiresAt', a.preparation_expires_at) end,
    'submissionLease', case when a.submission_token is null then null else jsonb_build_object('token', a.submission_token, 'expiresAt', a.submission_expires_at) end,
    'resolutionLease', case when a.resolution_token is null then null else jsonb_build_object('token', a.resolution_token, 'expiresAt', a.resolution_expires_at) end,
    'participants', coalesce((select jsonb_agg(jsonb_build_object('slot', ap.slot, 'wallet', ap.wallet, 'shareUnits', ap.share_units::text, 'ready', p.ready) order by ap.slot) from public.attempt_participants ap left join public.participants p on p.checkout_id=a.checkout_id and p.wallet=ap.wallet where ap.attempt_id=a.id), '[]'::jsonb),
    'signingPayload', case when a.message_bytes is null then null else jsonb_build_object(
      'attemptId', a.id, 'checkoutId', a.checkout_id, 'transactionBase64', pg_catalog.replace(pg_catalog.encode(a.transaction_bytes, 'base64'), pg_catalog.chr(10), ''),
      'messageBase64', pg_catalog.replace(pg_catalog.encode(a.message_bytes, 'base64'), pg_catalog.chr(10), ''), 'messageHash', a.message_hash, 'blockhash', a.blockhash,
      'lastValidBlockHeight', a.last_valid_block_height::text, 'payment', a.payment_summary
    ) end,
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('signerWallet', s.signer_wallet, 'signatureBase64', pg_catalog.replace(pg_catalog.encode(s.signature, 'base64'), pg_catalog.chr(10), '')) order by ap.slot) from public.signatures s join public.attempt_participants ap on ap.attempt_id=s.attempt_id and ap.wallet=s.signer_wallet where s.attempt_id=a.id), '[]'::jsonb),
    'submission', (select jsonb_build_object('transactionBase64', pg_catalog.replace(pg_catalog.encode(s.transaction_bytes, 'base64'), pg_catalog.chr(10), ''), 'transactionReference', s.transaction_reference) from public.submissions s where s.attempt_id=a.id),
    'receipt', (select jsonb_build_object('transactionReference', r.transaction_reference, 'confirmationStatus', r.confirmation_status, 'sellerWallet', c.seller_wallet, 'totalUnits', c.total_units::text, 'contributions', (select jsonb_agg(jsonb_build_object('slot', ap.slot, 'wallet', ap.wallet, 'amountUnits', ap.share_units::text) order by ap.slot) from public.attempt_participants ap where ap.attempt_id=a.id), 'observedAt', r.observed_at, 'explorerUrl', 'https://explorer.solana.com/tx/' || r.transaction_reference || '?cluster=devnet') from public.receipts r join public.checkouts c on c.id=a.checkout_id where r.attempt_id=a.id)
  ) from public.attempts a where a.id=p_attempt_id
$$;
revoke all on function private.attempt_snapshot(uuid) from public;

create function public.reserve_attempt(p_checkout_id uuid, p_organizer_wallet text, p_retry_of_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checkouts%rowtype; old_attempt public.attempts%rowtype; new_id uuid := pg_catalog.gen_random_uuid();
begin
  select * into c from public.checkouts where id=p_checkout_id for update;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0001'; end if;
  if c.organizer_wallet <> p_organizer_wallet then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  if c.paid_attempt_id is not null then raise exception 'CHECKOUT_PAID' using errcode='P0001'; end if;
  select * into old_attempt from public.attempts where checkout_id=p_checkout_id order by created_at desc, id desc limit 1 for update;
  if found then
    if not old_attempt.safely_resolved then
      if p_retry_of_attempt_id is null then return private.attempt_snapshot(old_attempt.id); end if;
      raise exception 'RETRY_BLOCKED' using errcode='P0001';
    end if;
    if old_attempt.id <> p_retry_of_attempt_id then raise exception 'RETRY_BLOCKED' using errcode='P0001'; end if;
  elsif p_retry_of_attempt_id is not null then raise exception 'RETRY_BLOCKED' using errcode='P0001'; end if;
  if (select count(*) from public.participants where checkout_id=p_checkout_id) <> c.payer_count or exists(select 1 from public.participants where checkout_id=p_checkout_id and not ready) then raise exception 'ROOM_NOT_READY' using errcode='P0001'; end if;
  insert into public.attempts(id,checkout_id,state) values(new_id,p_checkout_id,'preparing');
  insert into public.attempt_participants(attempt_id,slot,wallet,share_units) select new_id,slot,wallet,share_units from public.participants where checkout_id=p_checkout_id order by slot;
  return private.attempt_snapshot(new_id);
end $$;

create function public.claim_attempt_preparation(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts%rowtype; token uuid := pg_catalog.gen_random_uuid(); expiry timestamptz := pg_catalog.clock_timestamp()+interval '30 seconds';
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform 1 from public.checkouts where id=a.checkout_id for update;
  select * into a from public.attempts where id=p_attempt_id for update;
  if a.state <> 'preparing' or a.message_bytes is not null then return null; end if;
  if a.preparation_expires_at > pg_catalog.clock_timestamp() then return null; end if;
  update public.attempts set preparation_token=token, preparation_expires_at=expiry where id=p_attempt_id;
  return jsonb_build_object('token',token,'expiresAt',expiry);
end $$;

create function public.freeze_attempt_message(p_attempt_id uuid,p_lease_token uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts%rowtype; c public.checkouts%rowtype; payload jsonb := p_payload; payment jsonb := p_payload->'payment';
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform 1 from public.checkouts where id=a.checkout_id for update;
  select * into c from public.checkouts where id=a.checkout_id;
  select * into a from public.attempts where id=p_attempt_id for update;
  if a.state <> 'preparing' or a.preparation_token <> p_lease_token or a.preparation_expires_at <= pg_catalog.clock_timestamp() or p_payload->>'attemptId' <> a.id::text or p_payload->>'checkoutId' <> a.checkout_id::text or payment->>'network' <> c.network or payment->>'mint' <> c.mint or (payment->>'tokenDecimals')::smallint <> c.token_decimals or payment->>'sellerWallet' <> c.seller_wallet or jsonb_typeof(payment->'contributions') <> 'array' or jsonb_array_length(payment->'contributions') <> (select count(*) from public.attempt_participants where attempt_id=a.id) or exists(select 1 from public.attempt_participants ap where ap.attempt_id=a.id and not exists(select 1 from jsonb_array_elements(payment->'contributions') contribution where (contribution->>'slot')::smallint=ap.slot and contribution->>'wallet'=ap.wallet and (contribution->>'amountUnits')::numeric=ap.share_units)) or (p_payload->>'lastValidBlockHeight') !~ '^(0|[1-9][0-9]*)$' or (p_payload->>'lastValidBlockHeight')::numeric > 18446744073709551615 or p_payload->>'messageHash' !~ '^[0-9a-f]{64}$' or p_payload->>'transactionBase64' !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' or p_payload->>'messageBase64' !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode='P0001'; end if;
  update public.attempts set state='signing', message_bytes=pg_catalog.decode(payload->>'messageBase64','base64'), message_hash=payload->>'messageHash', transaction_bytes=pg_catalog.decode(payload->>'transactionBase64','base64'), payment_summary=payment, blockhash=payload->>'blockhash', last_valid_block_height=(payload->>'lastValidBlockHeight')::numeric, preparation_token=null, preparation_expires_at=null where id=p_attempt_id;
  return private.attempt_snapshot(p_attempt_id);
end $$;

create function public.put_attempt_signature(p_attempt_id uuid,p_signer_wallet text,p_message_hash text,p_signature text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts%rowtype;
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform 1 from public.checkouts where id=a.checkout_id for update;
  select * into a from public.attempts where id=p_attempt_id for update;
  if a.state <> 'signing' or a.message_hash <> p_message_hash or p_signature !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' or octet_length(pg_catalog.decode(p_signature,'base64')) <> 64 or not exists(select 1 from public.attempt_participants where attempt_id=p_attempt_id and wallet=p_signer_wallet) then raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode='P0001'; end if;
  insert into public.signatures(attempt_id,signer_wallet,signature) values(p_attempt_id,p_signer_wallet,pg_catalog.decode(p_signature,'base64')) on conflict(attempt_id,signer_wallet) do nothing;
  if exists(select 1 from public.signatures where attempt_id=p_attempt_id and signer_wallet=p_signer_wallet and signature <> pg_catalog.decode(p_signature,'base64')) then raise exception 'MESSAGE_MISMATCH' using errcode='P0001'; end if;
  return private.attempt_snapshot(p_attempt_id);
end $$;

create function public.decline_attempt(p_attempt_id uuid,p_signer_wallet text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts%rowtype;
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform 1 from public.checkouts where id=a.checkout_id for update;
  select * into a from public.attempts where id=p_attempt_id for update;
  if not exists(select 1 from public.attempt_participants where attempt_id=p_attempt_id and wallet=p_signer_wallet) then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
  if a.state in ('preparing','signing') then update public.attempts set state='declined', preparation_token=null, preparation_expires_at=null, resolution_token=null, resolution_expires_at=null where id=p_attempt_id; end if;
  return private.attempt_snapshot(p_attempt_id);
end $$;

create function public.claim_attempt_submission(p_attempt_id uuid,p_transaction_bytes text,p_transaction_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts%rowtype; token uuid := pg_catalog.gen_random_uuid(); expiry timestamptz := pg_catalog.clock_timestamp()+interval '30 seconds';
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform 1 from public.checkouts where id=a.checkout_id for update;
  select * into a from public.attempts where id=p_attempt_id for update;
  if a.state not in ('signing','submitting','unresolved') or (select count(*) from public.signatures where attempt_id=p_attempt_id) <> (select count(*) from public.attempt_participants where attempt_id=p_attempt_id) or p_transaction_bytes !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' or p_transaction_reference !~ '^[1-9A-HJ-NP-Za-km-z]{86,88}$' then raise exception 'SIGNATURES_INCOMPLETE' using errcode='P0001'; end if;
  if not exists(select 1 from public.submissions where attempt_id=p_attempt_id) then
    insert into public.submissions(attempt_id,transaction_bytes,transaction_reference) values(p_attempt_id,pg_catalog.decode(p_transaction_bytes,'base64'),p_transaction_reference);
  elsif exists(select 1 from public.submissions where attempt_id=p_attempt_id and (transaction_bytes <> pg_catalog.decode(p_transaction_bytes,'base64') or transaction_reference <> p_transaction_reference)) then raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode='P0001'; end if;
  if a.state='submitting' and a.submission_expires_at > pg_catalog.clock_timestamp() then
    return jsonb_build_object('lease',null,'submission',jsonb_build_object('transactionBase64',pg_catalog.replace(pg_catalog.encode((select transaction_bytes from public.submissions where attempt_id=p_attempt_id),'base64'),pg_catalog.chr(10),''),'transactionReference',(select transaction_reference from public.submissions where attempt_id=p_attempt_id)));
  end if;
  update public.attempts set state='submitting', submission_token=token, submission_expires_at=expiry where id=p_attempt_id;
  return jsonb_build_object('lease',jsonb_build_object('token',token,'expiresAt',expiry),'submission',jsonb_build_object('transactionBase64',pg_catalog.replace(pg_catalog.encode((select transaction_bytes from public.submissions where attempt_id=p_attempt_id),'base64'),pg_catalog.chr(10),''),'transactionReference',(select transaction_reference from public.submissions where attempt_id=p_attempt_id)));
end $$;

create function public.claim_attempt_resolution(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts%rowtype; token uuid := pg_catalog.gen_random_uuid(); expiry timestamptz := pg_catalog.clock_timestamp()+interval '30 seconds';
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform 1 from public.checkouts where id=a.checkout_id for update;
  select * into a from public.attempts where id=p_attempt_id for update;
  if a.state not in ('signing','declined') or exists(select 1 from public.submissions where attempt_id=p_attempt_id) then return null; end if;
  if a.resolution_expires_at > pg_catalog.clock_timestamp() then return null; end if;
  update public.attempts set resolution_token=token,resolution_expires_at=expiry where id=p_attempt_id;
  return jsonb_build_object('token',token,'expiresAt',expiry);
end $$;

create function public.record_attempt_outcome(p_attempt_id uuid,p_lease_kind text,p_lease_token uuid,p_outcome jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts%rowtype; c public.checkouts%rowtype; receipt jsonb := p_outcome->'receipt';
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform 1 from public.checkouts where id=a.checkout_id for update;
  select * into c from public.checkouts where id=a.checkout_id;
  select * into a from public.attempts where id=p_attempt_id for update;
  if p_lease_kind='preparation' and a.preparation_token=p_lease_token and a.preparation_expires_at > pg_catalog.clock_timestamp() and a.state='preparing' and a.message_bytes is null and p_outcome->>'state' in ('failed','expired') and (p_outcome->>'safelyResolved')::boolean then
    update public.attempts set state=p_outcome->>'state',safely_resolved=true,observed_error=p_outcome->>'error',preparation_token=null,preparation_expires_at=null where id=p_attempt_id;
  elsif p_lease_kind='submission' and a.submission_token=p_lease_token then
    if a.submission_expires_at <= pg_catalog.clock_timestamp() or p_outcome->>'state'='confirmed' and (receipt->>'confirmationStatus' <> 'finalized' or not exists(select 1 from public.submissions where attempt_id=p_attempt_id and transaction_reference=receipt->>'transactionReference') or (c.paid_attempt_id is not null and c.paid_attempt_id <> p_attempt_id) or receipt->>'sellerWallet' <> c.seller_wallet or (receipt->>'totalUnits')::numeric <> c.total_units or (receipt->>'observedAt') is null or jsonb_typeof(receipt->'contributions') <> 'array') then raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode='P0001'; end if;
    if p_outcome->>'state'='confirmed' then
      insert into public.receipts(attempt_id,transaction_reference,confirmation_status,execution_result,payment_summary,observed_at)
      select p_attempt_id,s.transaction_reference,'finalized',jsonb_build_object('err',null),a.payment_summary,(receipt->>'observedAt')::timestamptz from public.submissions s where s.attempt_id=p_attempt_id and s.transaction_reference=receipt->>'transactionReference' on conflict(attempt_id) do nothing;
      update public.checkouts set paid_attempt_id=p_attempt_id where id=c.id and paid_attempt_id is null;
      if not found and c.paid_attempt_id <> p_attempt_id then raise exception 'CHECKOUT_PAID' using errcode='P0001'; end if;
      update public.attempts set state='confirmed',safely_resolved=true,observed_error=null,submission_token=null,submission_expires_at=null where id=p_attempt_id;
    elsif a.submission_expires_at > pg_catalog.clock_timestamp() and p_outcome->>'state'='unresolved' and a.state in ('submitting','unresolved') and coalesce((p_outcome->>'safelyResolved')::boolean,false)=false then
      update public.attempts set state='unresolved',safely_resolved=false,observed_error=p_outcome->>'error',submission_token=null,submission_expires_at=null where id=p_attempt_id;
    elsif a.submission_expires_at > pg_catalog.clock_timestamp() and p_outcome->>'state' in ('failed','expired') and a.state in ('submitting','unresolved') and coalesce((p_outcome->>'safelyResolved')::boolean,false) then
      update public.attempts set state=p_outcome->>'state',safely_resolved=true,observed_error=p_outcome->>'error',submission_token=null,submission_expires_at=null where id=p_attempt_id;
    else raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode='P0001';
    end if;
  elsif p_lease_kind='resolution' and a.resolution_token=p_lease_token and a.resolution_expires_at > pg_catalog.clock_timestamp() and a.state in ('signing','declined') and not exists(select 1 from public.submissions where attempt_id=p_attempt_id) and p_outcome->>'state' in ('failed','expired') and (p_outcome->>'safelyResolved')::boolean then
    update public.attempts set state=p_outcome->>'state',safely_resolved=coalesce((p_outcome->>'safelyResolved')::boolean,false),observed_error=p_outcome->>'error',resolution_token=null,resolution_expires_at=null where id=p_attempt_id;
  else raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode='P0001'; end if;
  return private.attempt_snapshot(p_attempt_id);
end $$;

create function public.get_attempt(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.attempts%rowtype;
begin
  select * into a from public.attempts where id=p_attempt_id;
  if not found then return null; end if;
  perform 1 from public.checkouts where id=a.checkout_id for share;
  return private.attempt_snapshot(p_attempt_id);
end $$;

revoke all on function public.reserve_attempt(uuid,text,uuid), public.claim_attempt_preparation(uuid), public.freeze_attempt_message(uuid,uuid,jsonb), public.put_attempt_signature(uuid,text,text,text), public.decline_attempt(uuid,text), public.claim_attempt_submission(uuid,text,text), public.claim_attempt_resolution(uuid), public.record_attempt_outcome(uuid,text,uuid,jsonb), public.get_attempt(uuid), private.attempt_snapshot(uuid) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then execute 'revoke all on function public.reserve_attempt(uuid,text,uuid), public.claim_attempt_preparation(uuid), public.freeze_attempt_message(uuid,uuid,jsonb), public.put_attempt_signature(uuid,text,text,text), public.decline_attempt(uuid,text), public.claim_attempt_submission(uuid,text,text), public.claim_attempt_resolution(uuid), public.record_attempt_outcome(uuid,text,uuid,jsonb), public.get_attempt(uuid), private.attempt_snapshot(uuid) from anon'; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then execute 'revoke all on function public.reserve_attempt(uuid,text,uuid), public.claim_attempt_preparation(uuid), public.freeze_attempt_message(uuid,uuid,jsonb), public.put_attempt_signature(uuid,text,text,text), public.decline_attempt(uuid,text), public.claim_attempt_submission(uuid,text,text), public.claim_attempt_resolution(uuid), public.record_attempt_outcome(uuid,text,uuid,jsonb), public.get_attempt(uuid), private.attempt_snapshot(uuid) from authenticated'; end if;
  if exists(select 1 from pg_roles where rolname='service_role') then execute 'grant execute on function public.reserve_attempt(uuid,text,uuid), public.claim_attempt_preparation(uuid), public.freeze_attempt_message(uuid,uuid,jsonb), public.put_attempt_signature(uuid,text,text,text), public.decline_attempt(uuid,text), public.claim_attempt_submission(uuid,text,text), public.claim_attempt_resolution(uuid), public.record_attempt_outcome(uuid,text,uuid,jsonb), public.get_attempt(uuid) to service_role'; end if;
end $$;
