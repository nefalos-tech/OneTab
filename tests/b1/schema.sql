\set ON_ERROR_STOP on
insert into public.checkouts (id, client_request_id, title, organizer_wallet, seller_wallet, network, mint, token_decimals, total_units, payer_count) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Example', 'organizer', 'seller', 'devnet', 'mint', 6, 10, 2);
insert into public.participants values ('00000000-0000-4000-8000-000000000001', 0, 'organizer', 5, true), ('00000000-0000-4000-8000-000000000001', 1, 'payer', 5, true);
insert into public.attempts (id, checkout_id, state) values ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'preparing');
insert into public.attempt_participants select '00000000-0000-4000-8000-000000000003', slot, wallet, share_units from public.participants;
insert into public.signatures values ('00000000-0000-4000-8000-000000000003', 'organizer', decode(repeat('ab',64),'hex'));
do $$ begin
  begin insert into public.participants values ('00000000-0000-4000-8000-000000000001', 1, 'organizer', 5, false); raise exception 'duplicate participant accepted'; exception when unique_violation or raise_exception then if sqlerrm = 'duplicate participant accepted' then raise; end if; end;
  begin insert into public.participants values ('00000000-0000-4000-8000-000000000001', 2, 'extra', 5, false); raise exception 'out-of-range slot accepted'; exception when raise_exception then if sqlerrm = 'out-of-range slot accepted' then raise; end if; end;
  begin insert into public.signatures values ('00000000-0000-4000-8000-000000000003', 'organizer', decode(repeat('ab',64),'hex')); raise exception 'duplicate signature accepted'; exception when unique_violation then null; end;
  begin insert into public.signatures values ('00000000-0000-4000-8000-000000000003', 'stranger', decode(repeat('ab',64),'hex')); raise exception 'unexpected signer accepted'; exception when foreign_key_violation then null; end;
  begin update public.signatures set signature = decode(repeat('cd',64),'hex'); raise exception 'signature mutation accepted'; exception when raise_exception then if sqlerrm = 'signature mutation accepted' then raise; end if; end;
  begin insert into public.attempts (id, checkout_id, state) values ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'preparing'); raise exception 'duplicate active attempt accepted'; exception when unique_violation then null; end;
  update public.attempts set state = 'declined' where id = '00000000-0000-4000-8000-000000000003';
  begin insert into public.attempts (id, checkout_id, state) values ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'preparing'); raise exception 'declined attempt released'; exception when unique_violation then null; end;
  begin update public.checkouts set total_units = 1.5 where id = '00000000-0000-4000-8000-000000000001'; raise exception 'checkout mutation accepted'; exception when raise_exception then if sqlerrm = 'checkout mutation accepted' then raise; end if; end;
  begin insert into public.checkouts (id, client_request_id, title, organizer_wallet, seller_wallet, network, mint, token_decimals, total_units, payer_count) values ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006', 'fraction', 'a', 'b', 'devnet', 'mint', 6, 2.5, 2); raise exception 'fraction accepted'; exception when check_violation then null; end;
  begin update public.attempts set message_bytes = decode('01','hex'), transaction_bytes = decode('01','hex'), payment_summary = '{}', blockhash = 'block', last_valid_block_height = 3 where id = '00000000-0000-4000-8000-000000000003'; raise exception 'missing hash accepted'; exception when check_violation then null; end;
end $$;
