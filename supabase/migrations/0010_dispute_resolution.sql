-- =====================================================================
-- PayNode — evidence tables and the AI resolver's ruling ledger
--
-- PATH 2 of PayNodeEscrowV2 (`resolveDisputeWithAttestation`) settles a dispute against an
-- EIP-712 attestation signed by the project's epoch resolver key. Nothing in this repo
-- produced those attestations: the autonomous path existed on-chain with no off-chain
-- counterpart. These three tables are that counterpart's storage.
--
--   deliverables         What the builder says they shipped, and when. Evidence, not state —
--                        `markDelivered` on-chain remains the only thing that moves status.
--   dispute_claims       Each party's written argument once a dispute is raised.
--   dispute_resolutions  The resolver's ruling ledger. One row per project, forever.
--
-- WHY THE RULING LEDGER IS UNIQUE ON blockchain_id, AND WHY THAT IS A SECURITY CONTROL:
--
-- On-chain replay of a *submitted* attestation is already structurally impossible — settling
-- moves the project to a terminal status and nothing returns it to Disputed, so a projectId
-- can be resolved at most once. What the contract cannot prevent is TWO DIFFERENT valid
-- attestations existing for the same project at the same time. Both would verify; whichever
-- is broadcast first wins. A party who could re-trigger the pipeline until it produced a
-- friendlier split, then submit only that one, would have turned arbitration into a slot
-- machine at the protocol's expense.
--
-- So the pipeline claims this row BEFORE it spends a token on the model, and the unique
-- constraint is what makes the claim exclusive under concurrency. A second request for a
-- project that already has a row is served the ORIGINAL signature, never a fresh ruling.
--
-- RLS: parties read their own project's evidence and its final ruling. Nobody but the
-- service role writes `dispute_resolutions` — a client-writable ruling row would let a
-- party pre-claim their own project and permanently block the real resolver from ever
-- recording one, which is a cheap denial of arbitration.
--
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- DELIVERABLES
-- ---------------------------------------------------------------------

create table if not exists public.deliverables (
  id           uuid primary key default gen_random_uuid(),
  project_id   bigint not null references public.projects (id) on delete cascade,
  -- Denormalised so RLS and the resolver can filter without a join back to projects.
  builder      text not null,
  title        text,
  description  text,
  -- Free-form list of links (repo, preview URL, file storage). The resolver reads the
  -- text; it does not fetch these.
  artifact_urls text[] not null default '{}',
  -- Which revision round this submission belongs to, mirroring the on-chain
  -- `revisionsUsed` at the time of submission. `projects` has no such column — the
  -- revision counter lives only in the contract.
  revision_index smallint not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.deliverables
  drop constraint if exists deliverables_builder_lowercase;
alter table public.deliverables
  add  constraint deliverables_builder_lowercase check (builder = lower(builder));

create index if not exists deliverables_project_idx
  on public.deliverables (project_id, created_at);

-- ---------------------------------------------------------------------
-- DISPUTE CLAIMS
-- ---------------------------------------------------------------------

create table if not exists public.dispute_claims (
  id          uuid primary key default gen_random_uuid(),
  project_id  bigint not null references public.projects (id) on delete cascade,
  -- The wallet making the argument. Constrained to a party of the project by RLS below.
  author      text not null,
  -- 'client' | 'builder'. Stored rather than derived so the resolver never has to re-resolve
  -- an address against a project row it was handed separately.
  role        text not null check (role in ('client', 'builder')),
  body        text not null,
  evidence_urls text[] not null default '{}',
  created_at  timestamptz not null default now()
);

alter table public.dispute_claims
  drop constraint if exists dispute_claims_author_lowercase;
alter table public.dispute_claims
  add  constraint dispute_claims_author_lowercase check (author = lower(author));

create index if not exists dispute_claims_project_idx
  on public.dispute_claims (project_id, created_at);

-- ---------------------------------------------------------------------
-- RULING LEDGER
-- ---------------------------------------------------------------------

create table if not exists public.dispute_resolutions (
  id             uuid primary key default gen_random_uuid(),

  project_id     bigint not null references public.projects (id) on delete cascade,

  -- THE IDEMPOTENCY KEY. The on-chain project id, not the Supabase row id: the attestation
  -- is signed over the on-chain id, so that is the identity the uniqueness has to be about.
  -- `project_id` above is `projects.id`, a bigint surrogate key, and is a different number.
  --
  -- Deliberately wider than `projects.blockchain_id`, which is int4 and therefore caps the
  -- on-chain projectCounter at ~2.1 billion. Postgres compares the two with an implicit
  -- cast, so the mismatch is harmless, and this column does not want to inherit a ceiling
  -- that a uint256 counter does not have.
  blockchain_id  bigint not null,

  -- pending  — row claimed, model not finished. A crash leaves this behind; see the
  --            stale-claim note in lib/resolver/pipeline.ts.
  -- signed   — attestation issued and stored below.
  -- failed   — terminal refusal to rule (bad state, epoch mismatch, model refusal).
  status         text not null default 'pending'
                 check (status in ('pending', 'signed', 'failed')),

  -- ---- the ruling ----
  builder_bps    integer check (builder_bps between 0 and 10000),
  reasoning      text,
  -- Full structured model output: per-item evidence analysis, confidence, the lot.
  analysis       jsonb,

  -- ---- the attestation ----
  -- Kept alongside the ruling because a signature is only meaningful with the exact tuple
  -- it commits to. Re-deriving `deadline` at read time would produce a different digest.
  signature      text,
  attestation_deadline bigint,
  signer         text,
  -- resolverAt[] generation this was signed for. A rotation changes which key is valid for
  -- NEW projects only, so a stored ruling records the epoch it was authoritative under.
  resolver_epoch integer,

  -- ---- provenance ----
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  error          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The exclusivity that makes the pipeline safe to retry. Named so the pipeline can detect
-- this specific violation (Postgres 23505) and treat it as "already claimed", not an error.
create unique index if not exists dispute_resolutions_blockchain_id_key
  on public.dispute_resolutions (blockchain_id);

create index if not exists dispute_resolutions_project_idx
  on public.dispute_resolutions (project_id);

create index if not exists dispute_resolutions_status_idx
  on public.dispute_resolutions (status) where status = 'pending';

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.deliverables         enable row level security;
alter table public.dispute_claims       enable row level security;
alter table public.dispute_resolutions  enable row level security;

-- Mirrors projects_select_parties / projects_select_arbitrator (migrations 0001, 0005):
-- a row is visible to the project's client, builder or designated arbitrator.
-- `create or replace function` matches on the ARGUMENT TYPES, so replacing a uuid-argument
-- version with a bigint one creates a second overload rather than replacing it — and an
-- overload left behind from an earlier attempt at this migration would make every call
-- ambiguous. Drop it explicitly first.
drop function if exists public.is_project_party(uuid);

create or replace function public.is_project_party(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and lower(coalesce(auth.jwt() ->> 'wallet', '')) in (
        p.client, p.builder, coalesce(p.arbitrator, '')
      )
  );
$$;

comment on function public.is_project_party(bigint) is
  'True when the JWT wallet claim is the client, builder or arbitrator of the project. '
  'SECURITY DEFINER so it can read projects without recursing through projects'' own RLS.';

/**
 * Which side of a project a wallet is on: 'client', 'builder', or null.
 *
 * The INSERT policies below need this, and the obvious way to write them — an inline
 * `exists (select 1 from public.projects ...)` in the WITH CHECK — is wrong twice over.
 * That subquery runs as the CALLING role, so it needs a standing SELECT grant on
 * public.projects, and it is then filtered by projects' OWN row-level security. A policy
 * whose correctness depends on another table's grants and policies fails in whichever
 * direction those are changed next, and it fails by silently rejecting honest writes.
 *
 * SECURITY DEFINER settles it here instead, the same way is_project_party already does for
 * the SELECT policies.
 */
create or replace function public.project_role(p_project_id bigint, p_wallet text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p.client  = lower(p_wallet) then 'client'
           when p.builder = lower(p_wallet) then 'builder'
         end
  from public.projects p
  where p.id = p_project_id;
$$;

comment on function public.project_role(bigint, text) is
  'Returns ''client'', ''builder'' or null for a wallet on a project. SECURITY DEFINER so '
  'the INSERT policies do not depend on the caller''s grants on public.projects.';

-- ---- deliverables ----

drop policy if exists deliverables_select_parties on public.deliverables;
create policy deliverables_select_parties
  on public.deliverables for select
  using (public.is_project_party(project_id));

-- Only the builder submits work, and only as themselves.
drop policy if exists deliverables_insert_builder on public.deliverables;
create policy deliverables_insert_builder
  on public.deliverables for insert
  with check (
    builder = lower(coalesce(auth.jwt() ->> 'wallet', ''))
    and public.project_role(project_id, builder) = 'builder'
  );

-- ---- dispute_claims ----

drop policy if exists dispute_claims_select_parties on public.dispute_claims;
create policy dispute_claims_select_parties
  on public.dispute_claims for select
  using (public.is_project_party(project_id));

-- A party files their OWN argument. `role` must match which party they actually are, so a
-- client cannot file a claim attributed to the builder.
drop policy if exists dispute_claims_insert_party on public.dispute_claims;
create policy dispute_claims_insert_party
  on public.dispute_claims for insert
  with check (
    author = lower(coalesce(auth.jwt() ->> 'wallet', ''))
    -- `role` must be the side the author is actually on, so a client cannot file a
    -- statement attributed to the builder. A wallet that is neither gets null, which
    -- never equals `role`.
    and public.project_role(project_id, author) = role
  );

-- ---- dispute_resolutions ----

-- Read-only to the parties, and only once it is a real ruling. A `pending` row leaks the
-- fact that arbitration is mid-flight, which is a nudge to go tamper with the evidence.
drop policy if exists dispute_resolutions_select_parties on public.dispute_resolutions;
create policy dispute_resolutions_select_parties
  on public.dispute_resolutions for select
  using (status <> 'pending' and public.is_project_party(project_id));

-- Deliberately NO insert/update/delete policy. With RLS enabled and no permissive policy,
-- every write from an anon or authenticated session is refused. The service role bypasses
-- RLS and is the only writer. See the header for why a party-writable ruling row is a
-- denial-of-arbitration vector.

-- ---------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------

grant select on public.deliverables        to anon, authenticated;
grant select on public.dispute_claims      to anon, authenticated;
grant select on public.dispute_resolutions to anon, authenticated;

-- Column-level inserts, matching the style of migration 0001: a session may set only the
-- columns it has any business setting. Notably absent from both lists is anything the
-- resolver treats as authority — no timestamps a party could backdate.
grant insert (project_id, builder, title, description, artifact_urls, revision_index)
  on public.deliverables to authenticated;
grant insert (project_id, author, role, body, evidence_urls)
  on public.dispute_claims to authenticated;

commit;
