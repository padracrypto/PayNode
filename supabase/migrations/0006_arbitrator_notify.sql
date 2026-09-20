-- =====================================================================
-- PayNode — let a project's parties notify that project's arbitrator
--
-- Migration 0005 gave the designated arbitrator READ access to the project they rule on.
-- This closes the other half of that loop: telling them there is something to rule on.
--
-- app/project/[id]/page.tsx already calls sendNotification() for the arbitrator when a
-- dispute is opened. Under the 0001 policy that insert was silently rejected —
-- notifications_insert_counterparty only accepted a recipient who was the client or the
-- builder of a project the sender is party to, and the arbitrator is neither. Worse, the
-- helper swallows the error in a try/catch, so the write failed with no trace in the UI:
-- the arbitrator's resolution controls rendered correctly and nobody ever told them to look.
--
-- The recipient list gains lower(p.arbitrator). Everything else is deliberately unchanged:
--
--   * The SENDER must still be the client or the builder. An arbitrator is not granted the
--     ability to send notifications to anyone — their ruling is an on-chain transaction, and
--     the DisputeResolved event already drives both the page's live banner and the indexer.
--   * The recipient and the sender are still matched against the SAME project row `p`, so
--     this cannot be used to message the arbitrator of an unrelated project.
--   * lower(wallet_address) <> public.current_wallet() still blocks self-notification.
--
-- NULL semantics: lower(p.arbitrator) is NULL on the autonomous-resolution path, where no
-- arbitrator was named. `x in (a, b, NULL)` yields NULL rather than TRUE when x matches
-- neither a nor b, and a WITH CHECK that evaluates to NULL rejects the row exactly as FALSE
-- does. So projects with no arbitrator keep precisely their old behaviour.
--
-- Trust note: projects.arbitrator is written by the client at insert and then overwritten
-- from the ProjectCreated event by the indexer. Worst case, a client names an arbitrator the
-- contract does not recognise and that wallet receives notifications about that client's own
-- project — the same blast radius migration 0005 already accepted for read access, and the
-- recipient can delete them under notifications_delete_own. No ruling power follows from
-- this column; resolveDispute is gated on projectArbitrator on-chain.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

drop policy if exists notifications_insert_counterparty on public.notifications;
create policy notifications_insert_counterparty
  on public.notifications for insert
  to authenticated
  with check (
    lower(wallet_address) <> public.current_wallet()
    and exists (
      select 1
        from public.projects p
       where public.current_wallet() in (lower(p.client), lower(p.builder))
         and lower(notifications.wallet_address) in (
               lower(p.client),
               lower(p.builder),
               lower(p.arbitrator)
             )
    )
  );

commit;

-- =====================================================================
-- VERIFICATION (run as a session whose JWT `wallet` claim is the client of a project
-- that has a designated arbitrator)
--
--   -- succeeds, and is the case this migration exists for:
--   insert into public.notifications (wallet_address, message, type, link)
--   values ('<arbitrator wallet>', 'Your ruling is needed.', 'PROJECT_CANCELLED', '/project/<id>');
--
--   -- still denied: a wallet that is not a party to, nor the arbitrator of, any project of mine
--   insert into public.notifications (wallet_address, message, type, link)
--   values ('<unrelated wallet>', 'hello', 'PROJECT_CANCELLED', '/project/<id>');
--
--   -- still denied: notifying yourself
--   insert into public.notifications (wallet_address, message, type, link)
--   values ('<my own wallet>', 'hello', 'PROJECT_CANCELLED', '/project/<id>');
-- =====================================================================
