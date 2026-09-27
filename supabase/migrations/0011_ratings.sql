-- =====================================================================
-- PayNode — one-way client -> builder ratings
--
-- A client rates the builder once, 1 to 5 stars, after the project has concluded. No text:
-- a score is all the UI asks for, and a free-text field on a public table is a moderation
-- problem this app has no tooling for.
--
-- Replaces projects.rating, which was written from the browser at release time, before the
-- transaction had even confirmed, and which only covered the happy path (a client who
-- released funds). A project that ended in a refund or a dispute settlement could never be
-- rated at all.
--
-- The writer is app/actions/rating.ts (service role, checks everything in-process). The
-- policies below make a direct PostgREST insert exactly as strict, so the table does not
-- depend on every future writer remembering the rules.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- TABLE
-- ---------------------------------------------------------------------

create table if not exists public.ratings (
  id               uuid primary key default gen_random_uuid(),
  project_id       bigint not null references public.projects (id) on delete cascade,
  -- Both denormalised from the project row. The INSERT policy verifies they match it, so a
  -- client cannot attribute a rating to a builder they never worked with.
  client_address   text not null,
  builder_address  text not null,
  score            smallint not null check (score between 1 and 5),
  created_at       timestamptz not null default now()
);

alter table public.ratings drop constraint if exists ratings_wallets_lowercase;
alter table public.ratings add  constraint ratings_wallets_lowercase
  check (client_address = lower(client_address) and builder_address = lower(builder_address));

-- One rating per project, forever. This is the control, not the server action's pre-check:
-- two concurrent submissions both pass a read-then-write check, only one passes this.
create unique index if not exists ratings_project_id_key on public.ratings (project_id);

create index if not exists ratings_builder_idx on public.ratings (builder_address);

-- ---------------------------------------------------------------------
-- ELIGIBILITY
--
-- SECURITY DEFINER for the same reason as project_role() in 0010: an inline subquery on
-- projects inside WITH CHECK would run as the caller and be filtered by projects' own RLS.
-- ---------------------------------------------------------------------

create or replace function public.can_rate_project(
  p_project_id bigint,
  p_client     text,
  p_builder    text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.projects p
     where p.id      = p_project_id
       and p.client  = lower(p_client)
       and p.builder = lower(p_builder)
       -- The indexer's terminal statuses for a funded project. A mutual settlement or a
       -- ruling lands in one of these two as well; there is no separate 'Settled' status.
       and p.status in ('Completed', 'Refunded')
  );
$$;

comment on function public.can_rate_project(bigint, text, text) is
  'True when the wallets are the client and builder of a concluded project. SECURITY DEFINER '
  'so the ratings INSERT policy does not depend on the caller''s access to public.projects.';

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.ratings enable row level security;

-- Readable only by the two parties it names, matching projects_select_parties in 0001. A
-- public read would expose which client worked with which builder — exactly the pairing 0001
-- keeps private. Public reputation comes from the builder_stats aggregate below instead.
-- The columns are checked against the project row on insert, so they are the project's parties.
drop policy if exists ratings_select_public on public.ratings;
drop policy if exists ratings_select_parties on public.ratings;
create policy ratings_select_parties
  on public.ratings for select
  to authenticated
  using (public.current_wallet() in (client_address, builder_address));

drop policy if exists ratings_insert_client on public.ratings;
create policy ratings_insert_client
  on public.ratings for insert
  to authenticated
  with check (
    client_address = public.current_wallet()
    and public.can_rate_project(project_id, client_address, builder_address)
  );

-- No UPDATE or DELETE policy: a rating is immutable once given.

revoke all on public.ratings from anon, authenticated;
grant select on public.ratings to authenticated;
-- Column-level, as elsewhere: no id and no created_at, so a session cannot backdate one.
grant insert (project_id, client_address, builder_address, score) on public.ratings to authenticated;

-- ---------------------------------------------------------------------
-- BACKFILL from the legacy column, so builders keep the reputation they already earned.
-- ---------------------------------------------------------------------

insert into public.ratings (project_id, client_address, builder_address, score)
select p.id, lower(p.client), lower(p.builder), p.rating::smallint
  from public.projects p
 where p.rating between 1 and 5
   and p.status in ('Completed', 'Refunded')
on conflict (project_id) do nothing;

-- ---------------------------------------------------------------------
-- PUBLIC BUILDER STATS now average the ratings table.
--
-- Same three columns and types as 0001, so /[username] needs no change. Full outer join: a
-- builder whose only rated project ended in a refund still has a rating to show.
--
-- security_invoker = false (owner-run, the SECURITY DEFINER equivalent for views) is what
-- lets an anonymous profile visitor see the average: the view reads past the ratings policy
-- above, the same way it already reads past projects'. It exposes aggregates only — never a
-- project id, a client address or an individual score.
-- ---------------------------------------------------------------------

create or replace view public.builder_stats
with (security_invoker = false) as
  select
    coalesce(c.builder_wallet, r.builder_wallet)  as builder_wallet,
    coalesce(c.completed_projects, 0)             as completed_projects,
    r.average_rating                              as average_rating
  from (
    select lower(builder) as builder_wallet, count(*) as completed_projects
      from public.projects
     where status = 'Completed'
     group by lower(builder)
  ) c
  full outer join (
    select builder_address as builder_wallet, round(avg(score)::numeric, 2) as average_rating
      from public.ratings
     group by builder_address
  ) r on r.builder_wallet = c.builder_wallet;

comment on view public.builder_stats is
  'Aggregate-only, intentionally SECURITY DEFINER so public profile pages can show '
  'ratings without being granted read access to projects or ratings rows. Never add a column '
  'here that identifies an individual project, client or amount.';

grant select on public.builder_stats to anon, authenticated;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- VERIFICATION
--
--   As the client of a Completed project:
--     insert into ratings (project_id, client_address, builder_address, score)
--     values (<id>, <me>, <builder>, 5);                     -- expect: success
--     ... same again                                          -- expect: 23505 unique violation
--
--   As the builder, or on a project still Funded/Delivered/Disputed:
--     ... same insert                                         -- expect: violates row-level security
--
--   update ratings set score = 1 where project_id = <id>;     -- expect: permission denied
--
--   Privacy:
--     set role anon;  select * from ratings;                  -- expect: permission denied
--     As a wallet that is neither party: select * from ratings where project_id = <id>;
--                                                             -- expect: 0 rows
--     set role anon;  select * from builder_stats;            -- expect: averages still visible
-- =====================================================================
