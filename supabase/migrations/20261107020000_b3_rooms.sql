create or replace function public.create_checkout(
  p_id uuid, p_client_request_id uuid, p_title text, p_organizer_wallet text,
  p_seller_wallet text, p_total_units numeric, p_payer_count smallint,
  p_network text, p_mint text, p_token_decimals smallint
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare existing public.checkouts%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organizer_wallet || ':' || p_client_request_id::text, 0));
  select * into existing from public.checkouts
  where organizer_wallet = p_organizer_wallet and client_request_id = p_client_request_id
  for update;
  if found then
    if (existing.title, existing.seller_wallet, existing.total_units, existing.payer_count)
       is distinct from (p_title, p_seller_wallet, p_total_units, p_payer_count) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return existing.id;
  end if;
  insert into public.checkouts (id, client_request_id, title, organizer_wallet, seller_wallet, network, mint, token_decimals, total_units, payer_count)
  values (p_id, p_client_request_id, p_title, p_organizer_wallet, p_seller_wallet, p_network, p_mint, p_token_decimals, p_total_units, p_payer_count);
  insert into public.participants (checkout_id, slot, wallet, share_units, ready)
  values (p_id, 0, p_organizer_wallet, trunc(p_total_units / p_payer_count) + case when mod(p_total_units, p_payer_count) > 0 then 1 else 0 end, false);
  return p_id;
end $$;

create or replace function public.join_checkout(p_checkout_id uuid, p_wallet text)
returns smallint language plpgsql security definer set search_path = '' as $$
declare c public.checkouts%rowtype; chosen smallint;
begin
  select * into c from public.checkouts where id = p_checkout_id for update;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001'; end if;
  if p_wallet = c.seller_wallet then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  select slot into chosen from public.participants where checkout_id = p_checkout_id and wallet = p_wallet;
  if found then return chosen; end if;
  if c.paid_attempt_id is not null then raise exception 'CHECKOUT_PAID' using errcode = 'P0001'; end if;
  if exists (select 1 from public.attempts where checkout_id = p_checkout_id) then raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode = 'P0001'; end if;
  select slots.slot into chosen from generate_series(1, c.payer_count - 1) as slots(slot)
  where not exists (select 1 from public.participants p where p.checkout_id = p_checkout_id and p.slot = slots.slot)
  order by slots.slot limit 1;
  if chosen is null then raise exception 'ROOM_FULL' using errcode = 'P0001'; end if;
  insert into public.participants(checkout_id, slot, wallet, share_units, ready)
  values (p_checkout_id, chosen, p_wallet, trunc(c.total_units / c.payer_count) + case when chosen < mod(c.total_units, c.payer_count) then 1 else 0 end, false);
  return chosen;
end $$;

create or replace function public.set_checkout_readiness(p_checkout_id uuid, p_wallet text, p_ready boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare member public.participants%rowtype; c public.checkouts%rowtype;
begin
  select * into c from public.checkouts where id = p_checkout_id for update;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001'; end if;
  if c.paid_attempt_id is not null then raise exception 'CHECKOUT_PAID' using errcode = 'P0001'; end if;
  if exists (select 1 from public.attempts where checkout_id = p_checkout_id) then raise exception 'ATTEMPT_NOT_SIGNABLE' using errcode = 'P0001'; end if;
  select * into member from public.participants where checkout_id = p_checkout_id and wallet = p_wallet for update;
  if not found then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  update public.participants set ready = p_ready where checkout_id = p_checkout_id and wallet = p_wallet;
  return true;
end $$;

create or replace function public.checkout_room_snapshot(p_checkout_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checkouts%rowtype; attempt_row public.attempts%rowtype; participant_rows jsonb; attempt_json jsonb := null; phase text;
begin
  select * into c from public.checkouts where id = p_checkout_id for share;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot', p.slot, 'wallet', p.wallet, 'shareUnits', p.share_units::text, 'ready', p.ready) order by p.slot), '[]'::jsonb)
  into participant_rows from public.participants p where p.checkout_id = p_checkout_id;
  select * into attempt_row from public.attempts a where a.checkout_id = p_checkout_id order by a.created_at desc, a.id desc limit 1;
  if found then
    attempt_json := jsonb_build_object('id', attempt_row.id, 'state', attempt_row.state, 'signedWallets', coalesce((select jsonb_agg(s.signer_wallet order by ap.slot) from public.signatures s join public.attempt_participants ap on ap.attempt_id=s.attempt_id and ap.wallet=s.signer_wallet where s.attempt_id=attempt_row.id), '[]'::jsonb), 'transactionReference', (select transaction_reference from public.submissions where attempt_id=attempt_row.id), 'lastValidBlockHeight', case when attempt_row.last_valid_block_height is null then null else attempt_row.last_valid_block_height::text end, 'error', case when attempt_row.observed_error is null then null else jsonb_build_object('code', 'INVALID_PAYMENT', 'message', 'Payment attempt did not complete.') end, 'canRetry', attempt_row.safely_resolved and c.paid_attempt_id is null and not exists (select 1 from public.receipts r join public.attempts a on a.id=r.attempt_id where a.checkout_id=p_checkout_id), 'receipt', null);
    if attempt_row.state = 'confirmed' then
      attempt_json := jsonb_set(attempt_json, '{receipt}', (select jsonb_build_object('transactionReference', r.transaction_reference, 'confirmationStatus', r.confirmation_status, 'sellerWallet', c.seller_wallet, 'totalUnits', c.total_units::text, 'contributions', (select jsonb_agg(jsonb_build_object('slot', ap.slot, 'wallet', ap.wallet, 'amountUnits', ap.share_units::text) order by ap.slot) from public.attempt_participants ap where ap.attempt_id=r.attempt_id), 'observedAt', r.observed_at, 'explorerUrl', 'https://explorer.solana.com/tx/' || r.transaction_reference || '?cluster=devnet') from public.receipts r where r.attempt_id=attempt_row.id));
    end if;
  end if;
  phase := case when c.paid_attempt_id is not null or exists (select 1 from public.receipts r join public.attempts a on a.id = r.attempt_id where a.checkout_id = p_checkout_id) then 'paid'
    when attempt_row.id is not null and attempt_row.state in ('declined','unresolved','failed','expired') then 'needs_attention'
    when attempt_row.id is not null then 'paying'
    when jsonb_array_length(participant_rows) = c.payer_count and (select bool_and(p.ready) from public.participants p where p.checkout_id=p_checkout_id) then 'ready'
    else 'open' end;
  return jsonb_build_object('checkout', jsonb_build_object('id', c.id, 'title', c.title, 'organizerWallet', c.organizer_wallet, 'sellerWallet', c.seller_wallet, 'network', c.network, 'mint', c.mint, 'tokenDecimals', c.token_decimals, 'totalUnits', c.total_units::text, 'payerCount', c.payer_count, 'createdAt', c.created_at), 'participants', participant_rows, 'phase', phase, 'attempt', attempt_json);
end $$;

revoke all on function public.create_checkout(uuid,uuid,text,text,text,numeric,smallint,text,text,smallint), public.join_checkout(uuid,text), public.set_checkout_readiness(uuid,text,boolean), public.checkout_room_snapshot(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.create_checkout(uuid,uuid,text,text,text,numeric,smallint,text,text,smallint), public.join_checkout(uuid,text), public.set_checkout_readiness(uuid,text,boolean), public.checkout_room_snapshot(uuid) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function public.create_checkout(uuid,uuid,text,text,text,numeric,smallint,text,text,smallint), public.join_checkout(uuid,text), public.set_checkout_readiness(uuid,text,boolean), public.checkout_room_snapshot(uuid) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.create_checkout(uuid,uuid,text,text,text,numeric,smallint,text,text,smallint), public.join_checkout(uuid,text), public.set_checkout_readiness(uuid,text,boolean), public.checkout_room_snapshot(uuid) to service_role'; end if;
end $$;
