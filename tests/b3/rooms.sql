\set ON_ERROR_STOP on
select public.create_checkout('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Three way','organizer','seller',10,3::smallint,'devnet','mint',6::smallint);
select public.create_checkout('10000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000002','Three way','organizer','seller',10,3::smallint,'devnet','rotated-mint',9::smallint);
do $$ declare n integer; begin
  select count(*) into n from public.checkouts where client_request_id='10000000-0000-4000-8000-000000000002';
  if n <> 1 then raise exception 'idempotent create duplicated checkout'; end if;
  if (select count(*) from public.participants where checkout_id='10000000-0000-4000-8000-000000000001' and slot=0 and share_units=4) <> 1 then raise exception 'organizer slot or remainder share invalid'; end if;
  begin perform public.create_checkout('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','changed','organizer','seller',10,3::smallint,'devnet','mint',6::smallint); raise exception 'idempotency conflict accepted'; exception when raise_exception then if sqlerrm = 'idempotency conflict accepted' then raise; end if; end;
end $$;
do $$ begin
  if has_function_privilege('anon', 'public.join_checkout(uuid,text)', 'execute') or
     has_function_privilege('authenticated', 'public.set_checkout_readiness(uuid,text,boolean)', 'execute') or
     not has_function_privilege('service_role', 'public.create_checkout(uuid,uuid,text,text,text,numeric,smallint,text,text,smallint)', 'execute') then
    raise exception 'B3 room RPC privileges do not match the server-only boundary';
  end if;
end $$;
select public.join_checkout('10000000-0000-4000-8000-000000000001','payer-a');
select public.join_checkout('10000000-0000-4000-8000-000000000001','payer-a');
select public.join_checkout('10000000-0000-4000-8000-000000000001','payer-b');
select public.set_checkout_readiness('10000000-0000-4000-8000-000000000001','organizer',true);
select public.set_checkout_readiness('10000000-0000-4000-8000-000000000001','payer-a',true);
select public.set_checkout_readiness('10000000-0000-4000-8000-000000000001','payer-b',true);
do $$ begin
  if (select count(distinct slot) from public.participants where checkout_id='10000000-0000-4000-8000-000000000001') <> 3 then raise exception 'rejoin claimed another slot'; end if;
  if (select sum(share_units) from public.participants where checkout_id='10000000-0000-4000-8000-000000000001') <> 10 then raise exception 'persisted shares do not sum to total'; end if;
  if public.checkout_room_snapshot('10000000-0000-4000-8000-000000000001')->>'phase' <> 'ready' then raise exception 'snapshot readiness phase invalid'; end if;
  begin perform public.set_checkout_readiness('10000000-0000-4000-8000-000000000001','stranger',true); raise exception 'non-member readiness accepted'; exception when raise_exception then if sqlerrm = 'non-member readiness accepted' then raise; end if; end;
end $$;
insert into public.attempts(id,checkout_id,state) values ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','preparing');
insert into public.attempt_participants(attempt_id,slot,wallet,share_units)
select '10000000-0000-4000-8000-000000000004',slot,wallet,share_units from public.participants where checkout_id='10000000-0000-4000-8000-000000000001';
update public.attempts set state='confirmed', safely_resolved=true where id='10000000-0000-4000-8000-000000000004';
insert into public.submissions(attempt_id,transaction_bytes,transaction_reference)
values ('10000000-0000-4000-8000-000000000004',decode('00','hex'),repeat('2',87));
insert into public.receipts(attempt_id,transaction_reference,confirmation_status,execution_result,payment_summary,observed_at)
values ('10000000-0000-4000-8000-000000000004',repeat('2',87),'finalized','{}','{}',now());
do $$ begin
  begin perform public.set_checkout_readiness('10000000-0000-4000-8000-000000000001','organizer',false); raise exception 'readiness changed after attempt'; exception when raise_exception then if sqlerrm = 'readiness changed after attempt' then raise; end if; end;
  begin perform public.join_checkout('10000000-0000-4000-8000-000000000001','late-payer'); raise exception 'new member joined after attempt'; exception when raise_exception then if sqlerrm = 'new member joined after attempt' then raise; end if; end;
  if public.checkout_room_snapshot('10000000-0000-4000-8000-000000000001')->>'phase' <> 'paid' then raise exception 'finalized receipt did not mark the room paid'; end if;
  if public.checkout_room_snapshot('10000000-0000-4000-8000-000000000001')->'attempt'->>'canRetry' <> 'false' then raise exception 'paid room allowed retry'; end if;
end $$;
select public.create_checkout('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006','Failed room','organizer-error','seller-error',2,2::smallint,'devnet','mint',6::smallint);
insert into public.attempts(id,checkout_id,state) values ('10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000005','preparing');
update public.attempts set state='failed', safely_resolved=true, observed_error='private provider detail' where id='10000000-0000-4000-8000-000000000007';
do $$ begin
  if public.checkout_room_snapshot('10000000-0000-4000-8000-000000000005')->>'phase' <> 'needs_attention' then raise exception 'failed attempt phase is invalid'; end if;
  if public.checkout_room_snapshot('10000000-0000-4000-8000-000000000005')->'attempt'->>'canRetry' <> 'true' then raise exception 'safely resolved unpaid room did not allow retry'; end if;
  if public.checkout_room_snapshot('10000000-0000-4000-8000-000000000005')->'attempt'->'error'->>'message' <> 'Payment attempt did not complete.' then raise exception 'raw attempt error escaped into the public room'; end if;
end $$;
