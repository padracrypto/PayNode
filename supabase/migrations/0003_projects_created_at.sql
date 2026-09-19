-- =====================================================================
-- PayNode — add the missing projects.created_at column
--
-- app/dashboard/page.tsx selects and orders projects by `created_at` (added when active/past
-- projects were made to sort newest-first), but the projects table was never migrated to add
-- the column. Every dashboard load threw "column projects.created_at does not exist"
-- (Postgres 42703), which the UI surfaces as "Could not load your dashboard."
--
-- `tips` already has created_at from its original creation; `projects` simply never got one.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

alter table public.projects
  add column if not exists created_at timestamptz not null default now();

comment on column public.projects.created_at is
  'Row insert time. Existing rows predate this column and were backfilled to now() at '
  'migration time — their real creation time is not recoverable, so dashboard ordering for '
  'those rows is only accurate going forward.';

create index if not exists projects_created_at_idx on public.projects (created_at desc);

commit;
