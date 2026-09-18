-- =====================================================================
-- PayNode — Row Level Security + wallet-bound auth
-- Closes audit finding C-4: unauthenticated writes via the public anon key.
--
-- BEFORE THIS MIGRATION, with only the anon key and one HTTP request, anyone could:
--   * overwrite any creator's profiles.wallet_address and redirect all their tips;
--   * flip any project's status, hiding the release button from the real client;
--   * read every project, tip, delivery link and wallet pair in the database
--     (app/dashboard/page.tsx did `select('*')` and filtered in the browser);
--   * squat any username, because uniqueness was a read-then-write race with no
--     constraint behind it.
--
-- Identity comes from a SIWE-signed JWT carrying a `wallet` claim. See
-- app/api/siwe/verify/route.ts. RLS matches on lower(wallet) throughout, because
-- the app has historically stored a mix of checksummed and lowercase addresses.
--
-- RUN ORDER MATTERS. Sections 1-2 normalise existing rows so the constraints in
-- section 3 can be applied without failing on legacy data.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

-- =====================================================================
-- 1. IDENTITY HELPER
-- =====================================================================

-- The wallet of the current request, lowercased, or NULL for anonymous callers.
-- STABLE so the planner evaluates it once per statement rather than per row.
create or replace function public.current_wallet()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(nullif(auth.jwt() ->> 'wallet', ''))
$$;

comment on function public.current_wallet() is
  'Lowercased wallet address from the SIWE-issued JWT. NULL when unauthenticated.';

grant execute on function public.current_wallet() to anon, authenticated;

-- =====================================================================
-- 2. NORMALISE LEGACY DATA  (must precede the constraints in section 3)
-- =====================================================================

update public.profiles      set wallet_address  = lower(wallet_address)  where wallet_address  <> lower(wallet_address);
update public.projects      set client          = lower(client)          where client          <> lower(client);
update public.projects      set builder         = lower(builder)         where builder         <> lower(builder);
update public.tips          set sender_wallet   = lower(sender_wallet)   where sender_wallet   <> lower(sender_wallet);
update public.tips          set receiver_wallet = lower(receiver_wallet) where receiver_wallet <> lower(receiver_wallet);
update public.notifications set wallet_address  = lower(wallet_address)  where wallet_address  <> lower(wallet_address);

update public.profiles set username = lower(trim(username)) where username <> lower(trim(username));

-- Surface duplicate usernames BEFORE the unique index fails, with a usable message.
do $$
declare dupes text;
begin
  select string_agg(username || ' (x' || n || ')', ', ')
    into dupes
    from (select username, count(*) n from public.profiles
           where username is not null group by username having count(*) > 1) d;
  if dupes is not null then
    raise exception
      'Cannot add UNIQUE(username): duplicates exist -> %. Resolve these rows, then re-run.', dupes;
  end if;
end $$;

-- =====================================================================
-- 3. CONSTRAINTS
-- =====================================================================

-- Wallets are stored lowercase, always. This is what makes `.eq()` safe and is why
-- the app's mix of `.eq()` and `.ilike()` produced silent misses (and an infinite
-- redirect out of the dashboard when a profile lookup returned null).
alter table public.profiles      drop constraint if exists profiles_wallet_lowercase;
alter table public.profiles      add  constraint profiles_wallet_lowercase
  check (wallet_address = lower(wallet_address));

alter table public.projects      drop constraint if exists projects_client_lowercase;
alter table public.projects      add  constraint projects_client_lowercase
  check (client = lower(client));

alter table public.projects      drop constraint if exists projects_builder_lowercase;
alter table public.projects      add  constraint projects_builder_lowercase
  check (builder = lower(builder));

alter table public.tips          drop constraint if exists tips_wallets_lowercase;
alter table public.tips          add  constraint tips_wallets_lowercase
  check (sender_wallet = lower(sender_wallet) and receiver_wallet = lower(receiver_wallet));

alter table public.notifications drop constraint if exists notifications_wallet_lowercase;
alter table public.notifications add  constraint notifications_wallet_lowercase
  check (wallet_address = lower(wallet_address));

-- Username uniqueness enforced by the database, not by a TOCTOU check in the browser.
create unique index if not exists profiles_username_key on public.profiles (username);
create unique index if not exists profiles_wallet_key   on public.profiles (wallet_address);

-- One DB row per on-chain project. Prevents duplicate inserts from a re-fired effect.
create unique index if not exists projects_blockchain_id_key
  on public.projects (blockchain_id) where blockchain_id is not null;

-- Tips are user-submitted claims until an indexer confirms the tx on-chain.
-- Until then they must not count toward any displayed total.
alter table public.tips add column if not exists verified boolean not null default false;

comment on column public.tips.verified is
  'Set true ONLY by the service-role indexer after confirming tx_hash on Arc. '
  'Unverified rows are self-reported and must be excluded from totals.';

-- Indexes matching the RLS predicates below, so policies stay sargable.
create index if not exists projects_client_idx        on public.projects (client);
create index if not exists projects_builder_idx       on public.projects (builder);
create index if not exists tips_receiver_idx          on public.tips (receiver_wallet);
create index if not exists tips_sender_idx            on public.tips (sender_wallet);
create index if not exists notifications_wallet_idx   on public.notifications (wallet_address, created_at desc);

-- =====================================================================
-- 4. LOCK DOWN DEFAULT GRANTS
--    Supabase grants broad table access to anon/authenticated by default.
--    Revoke everything, then re-grant exactly what each role needs, per column.
-- =====================================================================

revoke all on public.profiles      from anon, authenticated;
revoke all on public.projects      from anon, authenticated;
revoke all on public.tips          from anon, authenticated;
revoke all on public.notifications from anon, authenticated;

alter table public.profiles      enable row level security;
alter table public.projects      enable row level security;
alter table public.tips          enable row level security;
alter table public.notifications enable row level security;

-- =====================================================================
-- 5. PROFILES
--    Publicly readable (the /[username] page is public), writable only by the
--    wallet that owns the row.
-- =====================================================================

drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check (lower(wallet_address) = public.current_wallet());

-- USING restricts which rows you may touch; WITH CHECK restricts what they may
-- become. Both are required: without WITH CHECK a user could edit their own row
-- and reassign wallet_address to someone else, which is exactly the tip-hijack.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using      (lower(wallet_address) = public.current_wallet())
  with check (lower(wallet_address) = public.current_wallet());

grant select on public.profiles to anon, authenticated;
grant insert on public.profiles to authenticated;
grant update (username, "about me", skills, github, x, linkedin, website)
  on public.profiles to authenticated;
-- NOTE: wallet_address is deliberately absent from the UPDATE grant. Even a policy
-- bug cannot let a session move a profile to another wallet.

-- =====================================================================
-- 6. PROJECTS
--    Readable only by its two parties. Status and all money fields are
--    service-role only — they are derived from chain events, never from a browser.
-- =====================================================================

drop policy if exists projects_select_parties on public.projects;
create policy projects_select_parties
  on public.projects for select
  to authenticated
  using (
    public.current_wallet() in (lower(client), lower(builder))
  );

drop policy if exists projects_insert_as_client on public.projects;
create policy projects_insert_as_client
  on public.projects for insert
  to authenticated
  with check (
    lower(client) = public.current_wallet()
    and lower(builder) <> public.current_wallet()
    and status = 'AwaitingFunds'          -- a new row can only start here
  );

-- Parties may edit presentation fields only. Which fields is enforced by the
-- column-level GRANT below, not by this policy.
drop policy if exists projects_update_parties on public.projects;
create policy projects_update_parties
  on public.projects for update
  to authenticated
  using      (public.current_wallet() in (lower(client), lower(builder)))
  with check (public.current_wallet() in (lower(client), lower(builder)));

grant select on public.projects to authenticated;
grant insert on public.projects to authenticated;

-- THE CRITICAL LINE. `status` is NOT grantable to any browser session. Neither are
-- client, builder, budget, amount_wei, blockchain_id or tx_hash. A compromised
-- session cannot mark a project Completed, cannot retarget the builder, and cannot
-- alter the amount. Those columns move only via the service-role indexer reacting
-- to FundsLocked / WorkDelivered / FundsReleased / ProjectRefunded / DisputeResolved.
grant update (title, description, delivery_type, delivery_notes, delivery_links, revision_notes, rating)
  on public.projects to authenticated;

-- =====================================================================
-- 7. PUBLIC BUILDER STATS
--    The /[username] page needs a builder's completed-project rating. It must NOT
--    get that by reading other people's project rows. This view exposes aggregates
--    only, and is owner-run so it can read past the projects RLS policy above.
-- =====================================================================

create or replace view public.builder_stats
with (security_invoker = false) as
  select
    lower(builder)                             as builder_wallet,
    count(*)                                   as completed_projects,
    round(avg(nullif(rating, 0))::numeric, 2)  as average_rating
  from public.projects
  where status = 'Completed'
  group by lower(builder);

comment on view public.builder_stats is
  'Aggregate-only, intentionally SECURITY DEFINER so public profile pages can show '
  'ratings without being granted read access to projects rows. Never add a column '
  'here that identifies an individual project, client or amount.';

grant select on public.builder_stats to anon, authenticated;

-- =====================================================================
-- 8. TIPS
--    Visible to the two wallets involved. Insertable by the sender, but never
--    trusted: `verified` stays false until the indexer confirms the tx on-chain.
-- =====================================================================

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

grant select on public.tips to authenticated;
grant insert (sender_wallet, receiver_wallet, amount, message, tx_hash) on public.tips to authenticated;
-- No UPDATE grant at all: a tip record is immutable to users.

-- =====================================================================
-- 9. NOTIFICATIONS
--    You read your own. You may write one to your counterparty on a shared
--    project, and to nobody else — this is what stops the table becoming a
--    spam channel addressable at any wallet.
-- =====================================================================

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select
  to authenticated
  using (lower(wallet_address) = public.current_wallet());

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
         and lower(notifications.wallet_address) in (lower(p.client), lower(p.builder))
    )
  );

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications for update
  to authenticated
  using      (lower(wallet_address) = public.current_wallet())
  with check (lower(wallet_address) = public.current_wallet());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own
  on public.notifications for delete
  to authenticated
  using (lower(wallet_address) = public.current_wallet());

grant select on public.notifications to authenticated;
grant insert (wallet_address, message, type, link) on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;   -- ONLY the read flag
grant delete on public.notifications to authenticated;

-- =====================================================================
-- 10. REALTIME
--     Realtime respects RLS only for tables in the publication with RLS enabled.
--     NotificationBell subscribes to notifications; scope it explicitly.
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

commit;

-- =====================================================================
-- POST-MIGRATION VERIFICATION
-- Run these as the ANON role. Every one must return zero rows or error.
-- =====================================================================
--
--   set role anon;
--   select * from public.projects;       -- expect: 0 rows (was: the entire table)
--   select * from public.tips;           -- expect: 0 rows
--   select * from public.notifications;  -- expect: 0 rows
--   update public.profiles set wallet_address = '0xattacker';  -- expect: permission denied
--   reset role;
--
-- And as an authenticated wallet, confirm a session cannot forge status:
--   update public.projects set status = 'Completed' where id = <yours>;
--   -- expect: ERROR permission denied for column status
-- =====================================================================
