-- =====================================================================
-- PayNode — indexer support
--
-- Migration 0001 removed the UPDATE grant on projects.status from browser sessions.
-- This migration creates the machinery that writes it instead: a cursor, an ordering
-- guard, and a service-role-only RPC that applies one confirmed log atomically.
--
-- THE ORDERING GUARD IS THE WHOLE DESIGN.
-- An indexer must be safe to re-run over blocks it has already seen (restarts, RPC
-- hiccups, reorgs, overlapping cron invocations). Two naive approaches both fail:
--
--   * "only move status forward by rank" breaks a LEGAL transition — a client may
--     request a revision on delivered work, so Delivered -> InRevision must be allowed.
--   * "last write wins" breaks partial dispute settlement — _settle emits DisputeResolved,
--     then FundsReleased, then ProjectRefunded in ONE transaction. Taking the highest log
--     index would leave a 50/50 split recorded as Refunded when the contract says Completed.
--
-- So: apply a log only if (block_number, log_index) is strictly newer than the last one
-- applied to that project, AND the project is not already terminal. DisputeResolved carries
-- the authoritative outcome in builderBps and is emitted FIRST, so it sets the terminal
-- status and the two payout logs that follow it in the same transaction are correctly ignored.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

-- =====================================================================
-- 1. CURSOR
-- =====================================================================

create table if not exists public.indexer_state (
  id                 text primary key,
  last_indexed_block bigint      not null default 0,
  updated_at         timestamptz not null default now()
);

comment on table public.indexer_state is
  'One row per indexer stream. last_indexed_block is the highest block whose logs are '
  'fully applied. Advanced only after every log in a range succeeds, so a crash mid-range '
  'replays that range — which the ordering guard makes harmless.';

insert into public.indexer_state (id, last_indexed_block)
values ('escrow', 0)
on conflict (id) do nothing;

-- Not exposed to browsers at all. Only the service role touches this.
alter table public.indexer_state enable row level security;
revoke all on public.indexer_state from anon, authenticated;

-- =====================================================================
-- 2. PER-PROJECT ORDERING CURSOR
-- =====================================================================

alter table public.projects add column if not exists last_event_block     bigint;
alter table public.projects add column if not exists last_event_log_index integer;
alter table public.projects add column if not exists funded_at            timestamptz;
alter table public.projects add column if not exists disputed_at          timestamptz;
alter table public.projects add column if not exists settled_at           timestamptz;
alter table public.projects add column if not exists resolution_path      smallint;
alter table public.projects add column if not exists resolution_builder_bps integer;
alter table public.projects add column if not exists amount_wei           numeric(78, 0);
alter table public.projects add column if not exists arbitrator           text;

comment on column public.projects.last_event_block is
  'Block of the most recent chain log applied to this row. With last_event_log_index, '
  'forms the replay guard that makes the indexer idempotent.';

comment on column public.projects.resolution_path is
  '0 designated arbitrator, 1 autonomous resolver, 2 mutual 2-of-2, 3 stale-dispute breaker. '
  'Mirrors DisputeResolved.resolutionPath.';

-- Tips are user-submitted claims until the indexer confirms the transaction.
alter table public.tips add column if not exists amount_wei   numeric(78, 0);
alter table public.tips add column if not exists verified_at  timestamptz;
alter table public.tips add column if not exists block_number bigint;

comment on column public.tips.amount_wei is
  'Written by the indexer from the on-chain transaction value — NOT from the amount the '
  'sender claimed. Totals must be computed from this column, never from tips.amount.';

create index if not exists tips_unverified_idx on public.tips (verified) where verified = false;

-- =====================================================================
-- 3. TERMINAL-STATUS HELPER
-- =====================================================================

create or replace function public.is_terminal_status(s text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s in ('Completed', 'Refunded', 'Cancelled')
$$;

-- =====================================================================
-- 4. THE APPLY RPC  (service role only)
-- =====================================================================

create or replace function public.apply_project_event(
  p_blockchain_id bigint,
  p_block         bigint,
  p_log_index     integer,
  p_status        text,      -- NULL = record metadata without changing status
  p_fields        jsonb default '{}'::jsonb
)
returns boolean               -- true when the event was applied, false when skipped
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current   public.projects%rowtype;
  v_is_newer  boolean;
begin
  select * into v_current
    from public.projects
   where blockchain_id = p_blockchain_id
   for update;

  -- A log for a project with no database row. Legitimate: the row is written by the
  -- client after createProject confirms, and the log can arrive first. The caller
  -- retries it on a later pass rather than inventing a row from partial data.
  if not found then
    return false;
  end if;

  v_is_newer :=
    v_current.last_event_block is null
    or p_block > v_current.last_event_block
    or (p_block = v_current.last_event_block and p_log_index > coalesce(v_current.last_event_log_index, -1));

  if not v_is_newer then
    return false;                                  -- already applied; replay is a no-op
  end if;

  -- Terminal is terminal. This is what makes the three logs of a partial dispute
  -- settlement collapse to the single correct outcome.
  if public.is_terminal_status(v_current.status) and p_status is distinct from null then
    update public.projects
       set last_event_block = p_block,
           last_event_log_index = p_log_index
     where blockchain_id = p_blockchain_id;
    return false;
  end if;

  update public.projects
     set status                 = coalesce(p_status, status),
         deadline               = coalesce((p_fields ->> 'deadline')::timestamptz, deadline),
         delivered_at           = coalesce((p_fields ->> 'delivered_at')::timestamptz, delivered_at),
         funded_at              = coalesce((p_fields ->> 'funded_at')::timestamptz, funded_at),
         disputed_at            = coalesce((p_fields ->> 'disputed_at')::timestamptz, disputed_at),
         settled_at             = coalesce((p_fields ->> 'settled_at')::timestamptz, settled_at),
         resolution_path        = coalesce((p_fields ->> 'resolution_path')::smallint, resolution_path),
         resolution_builder_bps = coalesce((p_fields ->> 'resolution_builder_bps')::integer, resolution_builder_bps),
         amount_wei             = coalesce((p_fields ->> 'amount_wei')::numeric, amount_wei),
         arbitrator             = coalesce(p_fields ->> 'arbitrator', arbitrator),
         tx_hash                = coalesce(p_fields ->> 'tx_hash', tx_hash),
         last_event_block       = p_block,
         last_event_log_index   = p_log_index
   where blockchain_id = p_blockchain_id;

  return true;
end;
$$;

comment on function public.apply_project_event is
  'Applies one confirmed chain log to a project. SECURITY DEFINER so it can write the '
  'status column that browser sessions are not granted. Returns false when the log was '
  'skipped as stale, already-applied, or arriving after a terminal state.';

-- SECURITY DEFINER means this function runs as its owner and bypasses the column grants
-- from 0001. It must therefore be callable ONLY by the service role.
revoke all on function public.apply_project_event(bigint, bigint, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_project_event(bigint, bigint, integer, text, jsonb)
  to service_role;

-- =====================================================================
-- 5. PAYMENT-DEFERRED LEDGER MIRROR
--    When a push payout fails, the contract credits withdrawable[] and emits
--    PaymentDeferred. Users have no way to discover that money without being told.
-- =====================================================================

create table if not exists public.deferred_payments (
  id            bigserial primary key,
  wallet_address text        not null check (wallet_address = lower(wallet_address)),
  amount_wei    numeric(78, 0) not null,
  tx_hash       text        not null,
  block_number  bigint      not null,
  log_index     integer     not null,
  created_at    timestamptz not null default now(),
  unique (tx_hash, log_index)          -- the replay guard for this stream
);

alter table public.deferred_payments enable row level security;
revoke all on public.deferred_payments from anon, authenticated;

drop policy if exists deferred_select_own on public.deferred_payments;
create policy deferred_select_own
  on public.deferred_payments for select
  to authenticated
  using (lower(wallet_address) = public.current_wallet());

grant select on public.deferred_payments to authenticated;

create index if not exists deferred_wallet_idx on public.deferred_payments (wallet_address);

commit;

-- =====================================================================
-- VERIFICATION
--   select * from public.indexer_state;
--   -- replay safety: applying the same log twice must return true then false
--   select public.apply_project_event(1, 100, 0, 'Funded', '{}'::jsonb);  -- t
--   select public.apply_project_event(1, 100, 0, 'Funded', '{}'::jsonb);  -- f
--   -- terminal guard
--   select public.apply_project_event(1, 101, 0, 'Completed', '{}'::jsonb); -- t
--   select public.apply_project_event(1, 102, 0, 'Refunded',  '{}'::jsonb); -- f
-- =====================================================================
