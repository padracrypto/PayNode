-- =====================================================================
-- PayNode — indexer lease lock + monotonic cursor + fair tip-verification queue
--
-- Why this exists
-- ---------------
-- Migration 0002's ordering guard already makes replaying a log harmless, so overlapping
-- indexer runs never corrupt project state. What they DO do:
--   * waste RPC quota (both runs fetch and re-apply the same blocks), and
--   * let a slow run overwrite a newer cursor with an older one, so the cursor moves
--     BACKWARDS and the same range is replayed again.
-- Vercel documents that cron delivery is best-effort and can fire the same schedule twice,
-- and a run that outlives its interval overlaps the next one, so both happen in production.
--
-- Design: a lease, not a session lock.
-- A serverless function can be killed mid-run without ever releasing anything, so a plain
-- advisory lock would be held forever. Instead each run takes a time-limited lease
-- (locked_by / locked_until). A crashed run's lease simply expires; a live run renews it
-- every time it advances the cursor. The cursor can only be advanced by the current lease
-- holder, and only forwards (greatest()), so a run that lost its lease cannot move it back.
--
-- Concurrency: both UPDATEs below take a row lock on the single indexer_state row, so two
-- simultaneous acquirers serialise, and the loser re-evaluates the WHERE clause against the
-- winner's committed lease (READ COMMITTED semantics) and gets found = false.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

-- =====================================================================
-- 1. LEASE COLUMNS
-- =====================================================================

alter table public.indexer_state add column if not exists locked_by    text;
alter table public.indexer_state add column if not exists locked_until timestamptz;

comment on column public.indexer_state.locked_by is
  'Random per-run owner token of the run currently holding the lease. NULL when free.';
comment on column public.indexer_state.locked_until is
  'Lease expiry. A crashed or killed run stops blocking others once this passes.';

-- =====================================================================
-- 2. ACQUIRE / RELEASE / ADVANCE   (service role only)
-- =====================================================================

create or replace function public.acquire_indexer_lock(
  p_id          text,
  p_owner       text,
  p_ttl_seconds integer default 75
)
returns boolean                  -- true = this caller now holds the lease
language plpgsql
set search_path = ''
as $$
begin
  update public.indexer_state
     set locked_by    = p_owner,
         locked_until = now() + make_interval(secs => p_ttl_seconds)
   where id = p_id
     and (locked_until is null or locked_until <= now() or locked_by = p_owner);
  return found;
end;
$$;

create or replace function public.release_indexer_lock(
  p_id    text,
  p_owner text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.indexer_state
     set locked_by = null,
         locked_until = null
   where id = p_id
     and locked_by = p_owner;    -- never release somebody else's lease
end;
$$;

-- Moves the cursor forward AND renews the lease, in one atomic statement. Returns false when
-- the caller no longer holds a live lease; the indexer treats that as fatal and stops, which
-- is what prevents a stalled run from clobbering the run that replaced it.
create or replace function public.advance_indexer_cursor(
  p_id          text,
  p_owner       text,
  p_block       bigint,
  p_ttl_seconds integer default 75
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.indexer_state
     set last_indexed_block = greatest(last_indexed_block, p_block),   -- monotonic
         updated_at         = now(),
         locked_until       = now() + make_interval(secs => p_ttl_seconds)
   where id = p_id
     and locked_by = p_owner
     and locked_until > now();
  return found;
end;
$$;

revoke all on function public.acquire_indexer_lock(text, text, integer)          from public, anon, authenticated;
revoke all on function public.release_indexer_lock(text, text)                   from public, anon, authenticated;
revoke all on function public.advance_indexer_cursor(text, text, bigint, integer) from public, anon, authenticated;

grant execute on function public.acquire_indexer_lock(text, text, integer)          to service_role;
grant execute on function public.release_indexer_lock(text, text)                   to service_role;
grant execute on function public.advance_indexer_cursor(text, text, bigint, integer) to service_role;

-- =====================================================================
-- 3. FAIR TIP-VERIFICATION QUEUE
--    The indexer used to fetch "any 50 unverified tips". tips_insert_as_sender lets any
--    signed-in wallet insert rows with an arbitrary tx_hash, so 50 junk rows that can never
--    verify would sit in that window permanently and starve every real tip behind them.
--    Stamping each attempt and ordering never-attempted rows first means a new tip is always
--    tried on the next pass, no matter how many junk rows exist.
--    Browser sessions have no UPDATE grant on tips, so they cannot reset this column.
-- =====================================================================

alter table public.tips add column if not exists last_verify_attempt_at timestamptz;

create index if not exists tips_verify_queue_idx
  on public.tips (last_verify_attempt_at nulls first)
  where verified = false;

-- Make PostgREST see the new functions immediately.
notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- VERIFICATION
--   -- first acquire wins, a second owner is refused, the same owner may renew
--   select public.acquire_indexer_lock('escrow', 'run-a', 75);   -- t
--   select public.acquire_indexer_lock('escrow', 'run-b', 75);   -- f
--   select public.acquire_indexer_lock('escrow', 'run-a', 75);   -- t
--   -- only the holder can advance, and never backwards
--   select public.advance_indexer_cursor('escrow', 'run-b', 500); -- f
--   select public.advance_indexer_cursor('escrow', 'run-a', 500); -- t
--   select public.advance_indexer_cursor('escrow', 'run-a', 400); -- t, but cursor stays 500
--   select last_indexed_block from public.indexer_state where id = 'escrow'; -- 500
--   -- a non-holder cannot release; the holder can
--   select public.release_indexer_lock('escrow', 'run-b');
--   select public.release_indexer_lock('escrow', 'run-a');
--   select locked_by, locked_until from public.indexer_state where id = 'escrow'; -- null, null
-- =====================================================================
