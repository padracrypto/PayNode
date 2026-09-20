-- =====================================================================
-- PayNode — idempotency key for indexer-written notifications
--
-- Until now every notification was written by a browser, after a transaction the user
-- had just signed. That misses the events nobody in a browser caused: a ruling by the
-- designated arbitrator, an automatic resolution, the 30-day timeout breaker. The
-- arbitrator cannot notify the parties themselves — migration 0006 deliberately keeps
-- them out of the insert policy — so the service-role indexer writes those instead.
--
-- The indexer is "at least once": a crash mid-range replays that range, and a failed
-- notification is retried the same way. Replays must therefore be harmless, and this
-- column is what makes them so.
--
--   event_key   '<txHash>:<logIndex>' of the chain log the notification was derived from.
--               NULL for every notification a browser wrote — those have no source log.
--
-- The unique constraint is (event_key, wallet_address), not event_key alone: one log
-- notifies several wallets (client, builder, arbitrator), so the log id is only unique
-- per recipient. Postgres treats NULLs as distinct in a unique constraint, so the
-- existing rows and all future browser-written rows are unaffected.
--
-- SECURITY: event_key is deliberately NOT added to the column-level INSERT grant from
-- migration 0001 (wallet_address, message, type, link). A browser session therefore
-- cannot set it — which matters, because a session that could would be able to insert
-- (txHash:logIndex, victim wallet) ahead of the indexer and make the real notification
-- collide with it and be dropped. Only the service role writes this column.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

alter table public.notifications add column if not exists event_key text;

comment on column public.notifications.event_key is
  'txHash:logIndex of the chain log this notification was derived from. Set only by the '
  'service-role indexer; NULL for browser-written notifications. With wallet_address it '
  'is the replay guard that makes indexer notifications idempotent.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname  = 'notifications_event_key_wallet_key'
  ) then
    alter table public.notifications
      add constraint notifications_event_key_wallet_key unique (event_key, wallet_address);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- The DDL for public.notifications predates this repo's migrations, so a CHECK constraint
-- on `type` cannot be ruled out from here. The indexer writes two new values. If the live
-- table rejected them, every dispute notification would fail at runtime instead — so try
-- each one now, inside a subtransaction that is always rolled back, and fail the
-- migration with a clear message rather than ship a silent gap.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['DISPUTE_RAISED', 'DISPUTE_RESOLVED'] loop
    begin
      insert into public.notifications (wallet_address, message, type, link, event_key)
      values ('0x0000000000000000000000000000000000000000', 'migration probe', t, '/', 'migration-probe');
      -- Reaching here means the insert was accepted. Raise to roll it back.
      raise exception 'probe rollback' using errcode = 'PN001';
    exception
      when check_violation then
        raise exception
          'notifications.type rejects the value %: widen or drop that CHECK constraint, then re-run this migration.', t;
      when sqlstate 'PN001' then
        null;  -- accepted, and rolled back
    end;
  end loop;
end $$;

commit;

-- =====================================================================
-- VERIFICATION (SQL editor, service role)
--
--   -- the constraint exists
--   select conname from pg_constraint
--    where conrelid = 'public.notifications'::regclass and conname = 'notifications_event_key_wallet_key';
--
--   -- replay safety: the second insert must be a no-op, not an error
--   insert into public.notifications (wallet_address, message, type, link, event_key)
--   values ('0x' || repeat('a', 40), 'test', 'DISPUTE_RAISED', '/', '0xdead:0')
--   on conflict (event_key, wallet_address) do nothing;
--   -- (run it again: 0 rows inserted, no error) then clean up:
--   delete from public.notifications where event_key = '0xdead:0';
--
--   -- a browser session must NOT be able to set the key (expect: permission denied for column)
--   --   insert into public.notifications (wallet_address, message, type, link, event_key) ...
--
-- BACKFILLING an already-indexed dispute (optional): rewind the cursor to just before the
-- dispute's block. Replay is safe — the ordering guard skips the status writes and the
-- event_key constraint skips any notification that already exists.
--
--   update public.indexer_state set last_indexed_block = <block before the dispute>
--    where id = 'escrow';
-- =====================================================================
