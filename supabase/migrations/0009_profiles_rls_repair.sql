-- =====================================================================
-- PayNode — repair row level security on public.profiles, and let a user set their own role
--
-- Two separate problems, both found while fixing "permission denied for table profiles" on
-- /onboarding. The error itself was client-side (the page wrote as `anon`, exactly like the
-- tip page in 0008), but fixing that alone leaves both of these in place.
--
-- ---------------------------------------------------------------------
-- PROBLEM 1 — RLS is not in force on public.profiles.
--
-- The same defect 0008 found on `tips`, on a second table. Measured on the live database
-- with a JWT for a wallet that owns no profile:
--
--   insert into profiles (wallet_address, ...) values ('<not my wallet>', ...)  -> 201 Created
--   update profiles set username = 'hijacked' where wallet_address = '<someone else>'
--     -> 200, and it returned the rewritten row
--
-- profiles_insert_own and profiles_update_own both say no. They are not being consulted, so
-- any signed-in wallet can rewrite any other user's username, bio, skills and links.
--
-- What is NOT possible, and the reason this is defacement rather than the tip-hijack 0001
-- was written to stop: `wallet_address` is absent from the column-level UPDATE grant, and
-- that grant IS in force (probe 4 below). Nobody can move a profile onto another wallet and
-- redirect its tips. The blast radius is the six presentation columns.
--
-- ---------------------------------------------------------------------
-- PROBLEM 2 — /onboarding could never have saved a returning user, RLS or no RLS.
--
-- The page used `upsert(..., { onConflict: 'wallet_address' })`, which PostgREST compiles to
-- INSERT ... ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = excluded.wallet_address,
-- username = excluded.username, role = excluded.role.
--
-- Postgres checks UPDATE privilege on every column in that SET list when it PLANS the
-- statement — not per row, and not only when a conflict actually happens. So the upsert
-- needed UPDATE on `wallet_address` and `role`, and 0001 grants neither:
--
--   1  authenticated upsert            -> 403 42501 permission denied for table profiles
--   2  authenticated plain insert      -> 201 Created
--   3  authenticated update username   -> 204 No Content
--   4  authenticated update role       -> 403 42501 permission denied for table profiles
--
-- `wallet_address` must stay ungranted — that is the line 0001 called critical, and this
-- migration does not touch it. The application now inserts or updates explicitly instead of
-- upserting, so it never names wallet_address in a SET list.
--
-- `role` is different: it is the client/builder toggle the onboarding form offers, it is
-- self-declared, and nothing in the app reads it for any authorisation decision — it is a
-- label shown back to its owner. Granting UPDATE on it lets a user change their own answer,
-- which is the only thing the UI ever asked for.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. RLS ON. Policies on a table with RLS disabled are inert: Postgres skips them, which is
--    how an insert naming someone else's wallet came back 201.
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------
-- 2. REMOVE ANY POLICY 0001 DID NOT CREATE.
--    Permissive policies are OR-ed together, so a single leftover `using (true)` from the
--    dashboard's "Enable update for all users" template re-opens the table regardless of
--    what sits beside it. 0001 only dropped its own three names.
-- ---------------------------------------------------------------------
do $$
declare
  stray record;
begin
  for stray in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'profiles'
       and policyname not in ('profiles_select_public', 'profiles_insert_own', 'profiles_update_own')
  loop
    execute format('drop policy %I on public.profiles', stray.policyname);
    raise notice '[0009] dropped stray policy % on public.profiles', stray.policyname;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. RECREATE 0001 §5 VERBATIM, so the two files cannot drift.
-- ---------------------------------------------------------------------
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

-- USING restricts which rows you may touch; WITH CHECK restricts what they may become.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using      (lower(wallet_address) = public.current_wallet())
  with check (lower(wallet_address) = public.current_wallet());

-- ---------------------------------------------------------------------
-- 4. GRANTS. As 0001, plus `role` on the UPDATE grant — see PROBLEM 2 above.
--
--    `wallet_address` remains deliberately absent. Even a policy bug cannot then let a
--    session move a profile to another wallet, which is the failure that would redirect a
--    creator's tips. Do not add it to make an upsert convenient; insert or update instead.
-- ---------------------------------------------------------------------
revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant insert on public.profiles to authenticated;
grant update (username, role, "about me", skills, github, x, linkedin, website)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 5. SAFETY NET.
--    Two of the four app tables were found with RLS switched off, by two different bug
--    reports, weeks apart. Neither showed up as an error — both looked like the app working.
--    Fail the migration rather than let a third go unnoticed.
-- ---------------------------------------------------------------------
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('profiles', 'projects', 'tips', 'notifications')
     and not c.relrowsecurity;

  if unprotected is not null then
    raise exception
      'Row level security is still disabled on: %. Apply 0008_tips_rls_repair.sql (tips) '
      'and re-run this migration; for any other table, re-apply its policies from '
      '0001_rls_siwe.sql before enabling RLS, or enabling it will lock out every user.',
      unprotected;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- VERIFICATION
--
-- 1. RLS is on and exactly three policies remain:
--
--      select relrowsecurity from pg_class where oid = 'public.profiles'::regclass;   -- t
--      select policyname, cmd from pg_policies
--       where schemaname = 'public' and tablename = 'profiles' order by policyname;
--      -- expect: profiles_insert_own (INSERT), profiles_select_public (SELECT),
--      --         profiles_update_own (UPDATE)
--
-- 2. As a JWT whose `wallet` claim is NOT the owner of some profile row:
--
--      update public.profiles set username = 'hijacked' where wallet_address = '<theirs>';
--      -- expect: 0 rows. Before this migration it returned the rewritten row.
--
--      insert into public.profiles (wallet_address, username, role)
--      values ('<not my wallet>', 'squatter', 'client');
--      -- expect: new row violates row-level security policy for table "profiles"
--
-- 3. As a JWT for a wallet that owns its row, the onboarding path must still work:
--
--      insert into public.profiles (wallet_address, username, role) values (<mine>, 'me', 'builder');
--      update public.profiles set username = 'me2', role = 'client' where wallet_address = <mine>;
--      -- both expect: success
--
--      update public.profiles set wallet_address = '<someone else>' where wallet_address = <mine>;
--      -- expect: permission denied for column wallet_address  (this must never start working)
-- =====================================================================
