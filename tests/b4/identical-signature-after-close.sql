\set ON_ERROR_STOP on

select public.create_checkout('20000000-0000-4000-8000-000000000091','20000000-0000-4000-8000-0000000000a1','Identical after decline','organizer','seller',10,2::smallint,'devnet','mint',6::smallint);
select public.join_checkout('20000000-0000-4000-8000-000000000091','payer');
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000091','organizer',true);
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000091','payer',true);

do $$
declare
  attempt jsonb;
  lease jsonb;
  payload jsonb;
  first jsonb;
  replay jsonb;
  signature text := repeat('A', 86) || '==';
begin
  attempt := public.reserve_attempt('20000000-0000-4000-8000-000000000091','organizer',null);
  lease := public.claim_attempt_preparation((attempt->>'id')::uuid);
  payload := jsonb_build_object(
    'attemptId', attempt->>'id', 'checkoutId', attempt->>'checkoutId',
    'transactionBase64', 'RklYVFVSRQ==', 'messageBase64', 'RklYVFVSRQ==',
    'messageHash', repeat('0', 64), 'blockhash', repeat('1', 32), 'lastValidBlockHeight', '123456',
    'payment', jsonb_build_object(
      'network','devnet','mint','mint','tokenDecimals',6,'sellerWallet','seller',
      'sellerTokenAccount','seller-token','feePayerWallet','organizer',
      'contributions', jsonb_build_array(
        jsonb_build_object('slot',0,'wallet','organizer','amountUnits','5','sourceTokenAccount','source-a'),
        jsonb_build_object('slot',1,'wallet','payer','amountUnits','5','sourceTokenAccount','source-b')
      )
    )
  );
  perform public.freeze_attempt_message((attempt->>'id')::uuid, (lease->>'token')::uuid, payload);
  first := public.put_attempt_signature((attempt->>'id')::uuid, 'organizer', repeat('0', 64), signature);
  if jsonb_array_length(first->'signatures') <> 1 then
    raise exception 'first signature did not persist';
  end if;
  replay := public.put_attempt_signature((attempt->>'id')::uuid, 'organizer', repeat('0', 64), signature);
  if replay->>'state' <> 'signing' or jsonb_array_length(replay->'signatures') <> 1 then
    raise exception 'sequential duplicate while signing changed the stored signature';
  end if;
  perform public.decline_attempt((attempt->>'id')::uuid, 'payer');
  replay := public.put_attempt_signature((attempt->>'id')::uuid, 'organizer', repeat('0', 64), signature);
  if replay->>'state' <> 'declined' or jsonb_array_length(replay->'signatures') <> 1
     or replay->'signatures'->0->>'signatureBase64' <> signature then
    raise exception 'identical signature was not idempotent after decline';
  end if;
  begin
    perform public.put_attempt_signature((attempt->>'id')::uuid, 'payer', repeat('0', 64), repeat('B', 86) || '==');
    raise exception 'new signature accepted after decline';
  exception when raise_exception then
    if sqlerrm = 'new signature accepted after decline' or sqlerrm <> 'ATTEMPT_NOT_SIGNABLE' then raise; end if;
  end;
end $$;

select public.create_checkout('20000000-0000-4000-8000-000000000092','20000000-0000-4000-8000-0000000000a2','Identical after submit','organizer-2','seller-2',10,2::smallint,'devnet','mint',6::smallint);
select public.join_checkout('20000000-0000-4000-8000-000000000092','payer-2');
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000092','organizer-2',true);
select public.set_checkout_readiness('20000000-0000-4000-8000-000000000092','payer-2',true);

do $$
declare
  attempt jsonb;
  lease jsonb;
  payload jsonb;
  replay jsonb;
  signature text := repeat('C', 86) || '==';
begin
  attempt := public.reserve_attempt('20000000-0000-4000-8000-000000000092','organizer-2',null);
  lease := public.claim_attempt_preparation((attempt->>'id')::uuid);
  payload := jsonb_build_object(
    'attemptId', attempt->>'id', 'checkoutId', attempt->>'checkoutId',
    'transactionBase64', 'RklYVFVSRQ==', 'messageBase64', 'RklYVFVSRQ==',
    'messageHash', repeat('2', 64), 'blockhash', repeat('3', 32), 'lastValidBlockHeight', '123456',
    'payment', jsonb_build_object(
      'network','devnet','mint','mint','tokenDecimals',6,'sellerWallet','seller-2',
      'sellerTokenAccount','seller-token-2','feePayerWallet','organizer-2',
      'contributions', jsonb_build_array(
        jsonb_build_object('slot',0,'wallet','organizer-2','amountUnits','5','sourceTokenAccount','source-c'),
        jsonb_build_object('slot',1,'wallet','payer-2','amountUnits','5','sourceTokenAccount','source-d')
      )
    )
  );
  perform public.freeze_attempt_message((attempt->>'id')::uuid, (lease->>'token')::uuid, payload);
  perform public.put_attempt_signature((attempt->>'id')::uuid, 'organizer-2', repeat('2', 64), signature);
  perform public.put_attempt_signature((attempt->>'id')::uuid, 'payer-2', repeat('2', 64), repeat('D', 86) || '==');
  if public.claim_attempt_submission((attempt->>'id')::uuid, 'AQ==', repeat('9', 87))->>'token' is null then
    raise exception 'submission lease was not issued';
  end if;
  replay := public.put_attempt_signature((attempt->>'id')::uuid, 'organizer-2', repeat('2', 64), signature);
  if replay->>'state' <> 'submitting' or jsonb_array_length(replay->'signatures') <> 2 then
    raise exception 'identical signature was not idempotent after submission';
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'put_attempt_signature'
      and (p.prosecdef or not (p.proconfig @> array['search_path=""']))
  ) then raise exception 'put_attempt_signature lost invoker or search_path'; end if;
  if has_function_privilege('anon', 'public.put_attempt_signature(uuid,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.put_attempt_signature(uuid,text,text,text)', 'execute')
     or has_function_privilege('public', 'public.put_attempt_signature(uuid,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.put_attempt_signature(uuid,text,text,text)', 'execute') then
    raise exception 'put_attempt_signature grants changed';
  end if;
end $$;
