\set ON_ERROR_STOP on

select public.create_checkout('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Attempt store','organizer','seller',10,2::smallint,'devnet','mint',6::smallint);
select public.join_checkout('20000000-0000-4000-8000-000000000001','payer');
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000001','organizer',true);
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000001','payer',true);

do $$
declare reserved jsonb; lease jsonb; payload jsonb;
begin
  reserved := public.reserve_attempt('20000000-0000-4000-8000-000000000001','organizer',null);
  if reserved->>'state' <> 'preparing' or jsonb_array_length(reserved->'participants') <> 2 then raise exception 'reserve_attempt did not freeze the ready participants'; end if;
  lease := public.claim_attempt_preparation((reserved->>'id')::uuid);
  if lease->>'token' is null then raise exception 'preparation lease was not issued'; end if;
  payload := jsonb_build_object(
    'attemptId', reserved->>'id',
    'checkoutId', reserved->>'checkoutId',
    'transactionBase64', 'RklYVFVSRQ==',
    'messageBase64', 'RklYVFVSRQ==',
    'messageHash', repeat('0',64),
    'blockhash', repeat('1',32),
    'lastValidBlockHeight', '123456',
    'payment', jsonb_build_object(
      'network','devnet','mint','mint','tokenDecimals',6,'sellerWallet','seller',
      'sellerTokenAccount','seller-token','feePayerWallet','organizer',
      'contributions',jsonb_build_array(
        jsonb_build_object('slot',0,'wallet','organizer','amountUnits','5','sourceTokenAccount','source-a'),
        jsonb_build_object('slot',1,'wallet','payer','amountUnits','5','sourceTokenAccount','source-b')
      )
    )
  );
  perform public.freeze_attempt_message((reserved->>'id')::uuid,(lease->>'token')::uuid,payload);
end $$;

do $$ declare result jsonb; begin
  result := public.put_attempt_signature((select id from public.attempts where checkout_id='20000000-0000-4000-8000-000000000001'),'organizer',repeat('0',64),repeat('A',86)||'==');
  if jsonb_array_length(result->'signatures') <> 1 then raise exception 'first signature did not persist'; end if;
  perform public.put_attempt_signature((select id from public.attempts where checkout_id='20000000-0000-4000-8000-000000000001'),'payer',repeat('0',64),repeat('B',86)||'==');
end $$;

do $$ declare claim jsonb; outcome jsonb; receipt jsonb; target_id uuid := (select id from public.attempts where checkout_id='20000000-0000-4000-8000-000000000001'); begin
  claim := public.claim_attempt_submission(
    target_id,
    'AQ==',repeat('2',87)
  );
  if claim->>'token' is null or (public.get_attempt(target_id)->'submission'->>'transactionReference') <> repeat('2',87) then raise exception 'submission identity was not persisted with a lease'; end if;
  receipt := jsonb_build_object('transactionReference',repeat('2',87),'confirmationStatus','finalized','sellerWallet','seller','totalUnits','10','contributions',jsonb_build_array(jsonb_build_object('slot',0,'wallet','organizer','amountUnits','5'),jsonb_build_object('slot',1,'wallet','payer','amountUnits','5')),'observedAt',pg_catalog.clock_timestamp());
  outcome := public.record_attempt_outcome(target_id,(claim->>'token')::uuid,jsonb_build_object('state','unresolved','safelyResolved',false,'error','temporary observation gap'));
  if outcome->>'state' <> 'unresolved' then raise exception 'unresolved outcome was not persisted'; end if;
  begin
    perform public.record_attempt_outcome(target_id,null,jsonb_build_object('state','confirmed','receipt',receipt));
    raise exception 'null fencing token accepted a confirmed outcome';
  exception when raise_exception then
    if sqlerrm='null fencing token accepted a confirmed outcome' then raise; end if;
  end;
  claim := public.claim_attempt_submission(target_id,'AQ==',repeat('2',87));
  if claim->>'token' is null then raise exception 'submission lease was not renewed for reconciliation'; end if;
  outcome := public.record_attempt_outcome(target_id,(claim->>'token')::uuid,jsonb_build_object('state','confirmed','receipt',receipt));
  if outcome->>'state' <> 'confirmed' or (select paid_attempt_id from public.checkouts where id='20000000-0000-4000-8000-000000000001') is distinct from target_id or not exists(select 1 from public.receipts r where r.attempt_id=target_id) then raise exception 'confirmed receipt and paid checkout were not persisted atomically'; end if;
end $$;

do $$ begin
  if has_function_privilege('anon','public.reserve_attempt(uuid,text,uuid)','execute') or has_function_privilege('authenticated','public.get_attempt(uuid)','execute') or not has_function_privilege('service_role','public.get_attempt(uuid)','execute') then raise exception 'B4 RPC privileges are not server-only'; end if;
end $$;

select public.create_checkout('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004','Concurrent attempt','organizer-2','seller-2',10,2::smallint,'devnet','mint',6::smallint);
select public.join_checkout('20000000-0000-4000-8000-000000000003','payer-2');
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000003','organizer-2',true);
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000003','payer-2',true);

select public.create_checkout('20000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000006','Declined attempt','organizer-3','seller-3',10,2::smallint,'devnet','mint',6::smallint);
select public.join_checkout('20000000-0000-4000-8000-000000000005','payer-3');
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000005','organizer-3',true);
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000005','payer-3',true);
do $$ declare attempt jsonb; lease jsonb; payload jsonb; declined jsonb; resolution jsonb; outcome jsonb; replacement jsonb; begin
  attempt := public.reserve_attempt('20000000-0000-4000-8000-000000000005','organizer-3',null);
  lease := public.claim_attempt_preparation((attempt->>'id')::uuid);
  payload := jsonb_build_object('attemptId',attempt->>'id','checkoutId',attempt->>'checkoutId','transactionBase64','RklYVFVSRQ==','messageBase64','RklYVFVSRQ==','messageHash',repeat('4',64),'blockhash',repeat('5',32),'lastValidBlockHeight','123456','payment',jsonb_build_object('network','devnet','mint','mint','tokenDecimals',6,'sellerWallet','seller-3','sellerTokenAccount','seller-token-3','feePayerWallet','organizer-3','contributions',jsonb_build_array(jsonb_build_object('slot',0,'wallet','organizer-3','amountUnits','5','sourceTokenAccount','source-e'),jsonb_build_object('slot',1,'wallet','payer-3','amountUnits','5','sourceTokenAccount','source-f'))));
  perform public.freeze_attempt_message((attempt->>'id')::uuid,(lease->>'token')::uuid,payload);
  declined := public.decline_attempt((attempt->>'id')::uuid,'payer-3');
  if declined->>'state' <> 'declined' then raise exception 'decline did not close signature collection'; end if;
  begin perform public.put_attempt_signature((attempt->>'id')::uuid,'payer-3',repeat('4',64),repeat('B',86)||'=='); raise exception 'signature accepted after decline'; exception when raise_exception then if sqlerrm='signature accepted after decline' then raise; end if; end;
  resolution := public.claim_attempt_resolution((attempt->>'id')::uuid);
  if resolution->>'token' is null then raise exception 'pre-submission resolution lease was not issued'; end if;
  outcome := public.record_attempt_outcome((attempt->>'id')::uuid,(resolution->>'token')::uuid,jsonb_build_object('state','expired','safelyResolved',true,'error','no submission exists'));
  if outcome->>'state' <> 'expired' or outcome->>'safelyResolved' <> 'true' then raise exception 'safe resolution did not close the declined attempt'; end if;
  replacement := public.reserve_attempt('20000000-0000-4000-8000-000000000005','organizer-3',(attempt->>'id')::uuid);
  if replacement->>'id' = attempt->>'id' or replacement->>'state' <> 'preparing' then raise exception 'safe resolution did not permit a replacement attempt'; end if;
end $$;
