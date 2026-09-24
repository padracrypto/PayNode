-- =====================================================================
-- PayNode — repair row level security on public.tips
--
-- FOUND WHILE DEBUGGING "Transaction succeeded, but failed to save record to database"
-- on /[username]/tip. The reported bug was client-side (the page wrote to Supabase without
-- a SIWE session, so PostgREST saw `anon`, which migration 0001 revoked all grants from).
-- Probing the live database to confirm that turned up something worse: on `tips`, and only
-- on `tips`, the policies from migration 0001 §8 are not in force.
--
-- Measured against the live database with a JWT for a wallet involved in no tip at all:
--
--   select * from public.tips;                -> 16 of 16 rows        (policy says: 0)
--   insert ... sender_wallet = <not my wallet> -> 201 Created          (policy says: denied)
--   update public.tips ...                    -> 42501 permission denied for table tips
--   select * from public.projects;            -> 0 of 1 rows
--   select * from public.notifications;       -> 0 of 55 rows
--
-- So the GRANTs from 0001 landed (UPDATE is refused, and `anon` is refused outright) and the
-- CHECK constraints landed (a mixed-case wallet is rejected), but row filtering on this one
-- table does nothing. That is the signature of `alter table public.tips disable row level
-- security`, or of the two policies having been dropped, from the dashboard after 0001 ran.
-- Either way every signed-in wallet can currently read every tip anyone has ever sent, and
-- can insert tips attributed to wallets it does not control.
--
-- This migration does not assume which of the two happened. It re-enables RLS, removes any
-- policy on the table that 0001 did not create, and recreates 0001 §8 verbatim.
--
-- Idempotent: safe to re-run. Safe to run on a database where 0001 §8 is already intact —
-- it is then a no-op apart from re-issuing identical DDL.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. RLS ON. Without this the policies below are inert decoration: Postgres skips them
--    entirely for a table with RLS disabled, which is exactly how 16 rows came back.
-- ---------------------------------------------------------------------
alter table public.tips enable row level security;

-- ---------------------------------------------------------------------
-- 2. REMOVE ANY POLICY 0001 DID NOT CREATE.
--    Permissive policies are OR-ed, so one leftover `using (true)` from the Supabase
--    dashboard's "Enable read access for all users" template re-opens the table no matter
--    how correct the policies beside it are. 0001 only dropped policies by its own two
--    names, so anything predating it under a different name survived untouched.
-- ---------------------------------------------------------------------
do $$
declare
  stray record;
begin
  for stray in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'tips'
       and policyname not in ('tips_select_involved', 'tips_insert_as_sender')
  loop
    execute format('drop policy %I on public.tips', stray.policyname);
    raise notice '[0008] dropped stray policy % on public.tips', stray.policyname;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. RECREATE 0001 §8. Identical text, so the two files cannot drift.
-- ---------------------------------------------------------------------
drop policy if exists tips_select_involved on public.tips;
create policy tips_select_involved
  on public.tips for select
  to authenticated
  using (public.current_wallet() in (lower(sender_wallet), lower(receiver_wallet)));

drop policy if exists tips_insert_as_sender on public.tips;
create policy tips_insert_as_sender
  on public.tips for insert
  to authenticated
  with check (
    lower(sender_wallet) = public.current_wallet()
    and verified = false                   -- self-attestation only; indexer promotes it
  );

-- ---------------------------------------------------------------------
-- 4. RE-ASSERT THE GRANTS.
--    These measured as already correct, but a database whose RLS was switched off by hand
--    may have had other things switched too. Restating them costs nothing and makes this
--    file a complete description of the table's access rules.
--
--    Still no UPDATE grant: a tip row is immutable to browser sessions. `verified`,
--    `amount_wei`, `verified_at`, `block_number` and `last_verify_attempt_at` are written
--    only by the service-role indexer, which bypasses RLS.
-- ---------------------------------------------------------------------
revoke all on public.tips from anon, authenticated;
grant select on public.tips to authenticated;
grant insert (sender_wallet, receiver_wallet, amount, message, tx_hash) on public.tips to authenticated;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- VERIFICATION
--
-- 1. RLS is on and exactly two policies remain:
--
--      select relrowsecurity from pg_class where oid = 'public.tips'::regclass;   -- t
--      select policyname, cmd from pg_policies
--       where schemaname = 'public' and tablename = 'tips' order by policyname;
--      -- expect exactly: tips_insert_as_sender (INSERT), tips_select_involved (SELECT)
--
-- 2. From the app, signed in as a wallet with no tips, the dashboard tip list must be
--    empty rather than showing strangers' tips.
--
-- 3. Re-run the probe that found this, as a JWT whose `wallet` claim is an uninvolved
--    address. Before: 16 rows and a 201. After: 0 rows and a 403 with
--    "new row violates row-level security policy for table \"tips\"".
--
-- NOTE ON EXISTING DATA: rows inserted while RLS was off were never sender-checked, so
-- `tips.sender_wallet` is not trustworthy for any row with verified = false. The indexer
-- re-derives both wallets from the transaction itself before setting verified = true
-- (lib/indexer/core.ts, verifyPendingTips), so verified rows are sound regardless. Totals
-- must continue to be computed from verified rows and `amount_wei` only, per 0002.
-- =====================================================================
