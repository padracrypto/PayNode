-- =====================================================================
-- PayNode — let a project's designated arbitrator read that project
--
-- Migration 0001 lets only the client and builder SELECT a project row. That was correct
-- until arbitration existed as a UI flow: the arbitrator is a third wallet, and PayNodeEscrowV2's
-- resolveDispute() is callable only by them. With no read access the arbitrator cannot load the
-- project page at all — no title, no delivery notes or links to judge from, no way to rule.
--
-- This adds a SELECT-only policy. It grants no write access of any kind: the arbitrator's
-- ruling is an on-chain transaction, and projects.status stays owned by the indexer.
--
-- Trust note: projects.arbitrator is written by the client at insert and then overwritten from
-- the ProjectCreated event by the indexer. Worst case, a client names a wallet in this column
-- that the contract does not recognise — that wallet then gets READ access to that client's own
-- project and nothing else. The ruling itself is enforced on-chain, never by this column.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

drop policy if exists projects_select_arbitrator on public.projects;
create policy projects_select_arbitrator
  on public.projects for select
  to authenticated
  using (
    arbitrator is not null
    and lower(arbitrator) = public.current_wallet()
  );

commit;

-- =====================================================================
-- VERIFICATION (run as a session whose JWT `wallet` claim is the arbitrator)
--   select id, title, status from public.projects where lower(arbitrator) = '<arbitrator wallet>';  -- rows
--   update public.projects set title = 'x' where lower(arbitrator) = '<arbitrator wallet>';         -- 0 rows / denied
-- =====================================================================
