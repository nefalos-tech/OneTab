create table public.checkouts (
  id uuid primary key,
  client_request_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  organizer_wallet text not null check (length(organizer_wallet) > 0),
  seller_wallet text not null check (length(seller_wallet) > 0 and seller_wallet <> organizer_wallet),
  network text not null check (network = 'devnet'),
  mint text not null,
  token_decimals smallint not null check (token_decimals between 0 and 255),
  total_units numeric not null check (total_units = trunc(total_units) and total_units between 1 and 18446744073709551615),
  payer_count smallint not null check (payer_count in (2,3) and total_units >= payer_count),
  paid_attempt_id uuid,
  created_at timestamptz not null default now(),
  unique (organizer_wallet, client_request_id)
);
create table public.participants (
  checkout_id uuid not null references public.checkouts(id),
  slot smallint not null check (slot between 0 and 2),
  wallet text not null check (length(wallet) > 0),
  share_units numeric not null check (share_units = trunc(share_units) and share_units between 1 and 18446744073709551615),
  ready boolean not null default false,
  primary key (checkout_id, slot),
  unique (checkout_id, wallet)
);
create function public.check_participant() returns trigger language plpgsql set search_path = '' as $$
declare c public.checkouts%rowtype;
begin
  select * into strict c from public.checkouts where id = new.checkout_id for update;
  if new.slot >= c.payer_count or new.wallet = c.seller_wallet or (new.slot = 0 and new.wallet <> c.organizer_wallet) or (new.slot <> 0 and new.wallet = c.organizer_wallet) or new.share_units <> trunc(c.total_units / c.payer_count) + (case when new.slot < mod(c.total_units, c.payer_count) then 1 else 0 end) then
    raise exception 'invalid participant slot, wallet or share';
  end if;
  return new;
end $$;
create trigger participants_validate before insert or update on public.participants for each row execute function public.check_participant();
create table public.attempts (
  id uuid primary key,
  checkout_id uuid not null references public.checkouts(id),
  state text not null check (state in ('preparing','signing','submitting','unresolved','declined','confirmed','failed','expired')),
  safely_resolved boolean not null default false,
  message_bytes bytea,
  message_hash text,
  transaction_bytes bytea,
  payment_summary jsonb,
  blockhash text,
  last_valid_block_height numeric check (last_valid_block_height = trunc(last_valid_block_height) and last_valid_block_height between 0 and 18446744073709551615),
  preparation_token uuid, preparation_expires_at timestamptz,
  submission_token uuid, submission_expires_at timestamptz,
  observed_error text,
  created_at timestamptz not null default now(),
  unique (checkout_id, id),
  check (not safely_resolved or state in ('failed','expired','confirmed')),
  check ((message_bytes is null and message_hash is null and transaction_bytes is null and payment_summary is null and blockhash is null and last_valid_block_height is null) or (message_bytes is not null and message_hash is not null and message_hash ~ '^[0-9a-f]{64}$' and transaction_bytes is not null and payment_summary is not null and blockhash is not null and last_valid_block_height is not null))
);
create unique index one_blocking_attempt_per_checkout on public.attempts(checkout_id) where not safely_resolved;
alter table public.checkouts add constraint paid_attempt_same_checkout foreign key (id, paid_attempt_id) references public.attempts(checkout_id, id);
create table public.attempt_participants (
  attempt_id uuid not null references public.attempts(id),
  slot smallint not null check (slot between 0 and 2),
  wallet text not null,
  share_units numeric not null check (share_units = trunc(share_units) and share_units between 1 and 18446744073709551615),
  primary key (attempt_id, wallet), unique (attempt_id, slot)
);
create table public.signatures (
  attempt_id uuid not null,
  signer_wallet text not null,
  signature bytea not null check (octet_length(signature) = 64),
  primary key (attempt_id, signer_wallet),
  foreign key (attempt_id, signer_wallet) references public.attempt_participants(attempt_id, wallet)
);
create table public.submissions (
  attempt_id uuid primary key references public.attempts(id),
  transaction_bytes bytea not null,
  transaction_reference text not null unique,
  unique (attempt_id, transaction_reference)
);
create table public.receipts (
  attempt_id uuid primary key references public.attempts(id),
  transaction_reference text not null unique,
  confirmation_status text not null check (confirmation_status = 'finalized'),
  execution_result jsonb not null,
  payment_summary jsonb not null,
  observed_at timestamptz not null,
  foreign key (attempt_id, transaction_reference) references public.submissions(attempt_id, transaction_reference)
);
create table public.auth_challenges (
  id uuid primary key, wallet text not null, origin text not null, purpose text not null,
  message_bytes bytea not null, expires_at timestamptz not null, consumed_at timestamptz,
  created_at timestamptz not null default now(), check (expires_at > created_at)
);
create table public.wallet_sessions (
  token_hash bytea primary key check (octet_length(token_hash) = 32), wallet text not null,
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create function public.guard_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'checkouts' then
    if (to_jsonb(new) - 'paid_attempt_id') is distinct from (to_jsonb(old) - 'paid_attempt_id') then
      raise exception 'checkout is immutable';
    end if;
  elsif tg_table_name = 'attempts' then
    if new.checkout_id is distinct from old.checkout_id or new.id is distinct from old.id or
      (old.message_bytes is not null and
       (new.message_bytes, new.message_hash, new.transaction_bytes, new.payment_summary, new.blockhash, new.last_valid_block_height)
       is distinct from
       (old.message_bytes, old.message_hash, old.transaction_bytes, old.payment_summary, old.blockhash, old.last_valid_block_height)) then
      raise exception 'attempt message is immutable';
    end if;
  else
    raise exception 'frozen record is immutable';
  end if;
  return new;
end $$;
create trigger checkout_immutable before update on public.checkouts for each row execute function public.guard_immutable();
create trigger attempt_immutable before update on public.attempts for each row execute function public.guard_immutable();
create trigger frozen_participant_immutable before update or delete on public.attempt_participants for each row execute function public.guard_immutable();
create trigger submission_immutable before update or delete on public.submissions for each row execute function public.guard_immutable();
create trigger receipt_immutable before update or delete on public.receipts for each row execute function public.guard_immutable();
alter table public.checkouts enable row level security;
alter table public.participants enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_participants enable row level security;
alter table public.signatures enable row level security;
alter table public.submissions enable row level security;
alter table public.receipts enable row level security;
alter table public.auth_challenges enable row level security;
alter table public.wallet_sessions enable row level security;
revoke all on public.checkouts, public.participants, public.attempts, public.attempt_participants, public.signatures, public.submissions, public.receipts, public.auth_challenges, public.wallet_sessions from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.checkouts, public.participants, public.attempts, public.attempt_participants, public.signatures, public.submissions, public.receipts, public.auth_challenges, public.wallet_sessions from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on public.checkouts, public.participants, public.attempts, public.attempt_participants, public.signatures, public.submissions, public.receipts, public.auth_challenges, public.wallet_sessions from authenticated'; end if;
end $$;


create trigger signature_immutable before update or delete on public.signatures for each row execute function public.guard_immutable();
create function public.check_frozen_participant() returns trigger language plpgsql set search_path = '' as $$
declare a public.attempts%rowtype;
begin
  select * into strict a from public.attempts where id = new.attempt_id for update;
  if a.state <> 'preparing' or a.message_bytes is not null or not exists (
    select 1 from public.participants p where p.checkout_id = a.checkout_id
      and p.slot = new.slot and p.wallet = new.wallet and p.share_units = new.share_units
  ) then
    raise exception 'invalid frozen participant';
  end if;
  return new;
end $$;
create trigger frozen_participant_validate before insert on public.attempt_participants for each row execute function public.check_frozen_participant();
create function public.guard_participant_identity() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (new.checkout_id, new.slot, new.wallet, new.share_units) is distinct from (old.checkout_id, old.slot, old.wallet, old.share_units) then
    raise exception 'participant identity is immutable';
  end if;
  perform 1 from public.checkouts where id = old.checkout_id for update;
  if exists (select 1 from public.attempts where checkout_id = old.checkout_id) then
    raise exception 'readiness is frozen';
  end if;
  return new;
end $$;
create trigger participant_identity_immutable before update or delete on public.participants for each row execute function public.guard_participant_identity();
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on public.checkouts, public.participants, public.attempts, public.attempt_participants, public.signatures, public.submissions, public.receipts, public.auth_challenges, public.wallet_sessions to service_role';
  end if;
end $$;
