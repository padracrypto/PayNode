/**
 * PayNode — dispute-resolution types, escrow arithmetic and the UI state machine.
 *
 * DELIBERATELY NOT `server-only`. The shapes here are the same rows the resolver writes in
 * lib/resolver/*, but those modules all `import 'server-only'` because they reach the signing
 * key and the Gemini client. A client component that imported them to get at a type would
 * fail the build, and the tempting fix — re-declaring the shapes inside the component — is
 * how a frontend drifts away from the ledger it renders. One copy, importable from both
 * sides, with no runtime dependency beyond lib/paynode.
 *
 * `lib/resolver/arbitrate.ts` owns `Ruling`; `lib/resolver/evidence.ts` owns the row types it
 * reads. If either changes, change this file in the same commit.
 */

import { ProjectStatus, PROTOCOL } from '../paynode';

/* -------------------------------------------------------------------------- */
/*                                  ROW SHAPES                                */
/* -------------------------------------------------------------------------- */

/**
 * A bigint Postgres column as it arrives over PostgREST.
 *
 * `dispute_resolutions.blockchain_id` and `attestation_deadline` are both int8. PostgREST
 * serialises int8 as a JSON number today, which is safe for a unix timestamp and for any
 * project id we will ever mint — but the representation is not ours to depend on, and one of
 * these values ends up inside an EIP-712 digest. Accept either form and convert through
 * BigInt at the point of use.
 */
export type PgBigInt = number | string;

export const toBigInt = (v: PgBigInt): bigint => BigInt(v);

/** `public.deliverables` — what the builder says they shipped. Evidence, never state. */
export type DeliverableRow = {
  id: string;
  project_id: number;
  builder: string;
  title: string | null;
  description: string | null;
  artifact_urls: string[] | null;
  /** Mirrors the on-chain `revisionsUsed` at the moment of submission. */
  revision_index: number | null;
  created_at: string;
};

export type DisputeRole = 'client' | 'builder';

/** `public.dispute_claims` — one party's written argument, with cited links. */
export type DisputeClaimRow = {
  id: string;
  project_id: number;
  author: string;
  role: DisputeRole;
  body: string;
  evidence_urls: string[] | null;
  created_at: string;
};

/** One line of the resolver's structured analysis. Mirrors `Ruling.evidenceAnalysis`. */
export type EvidenceFinding = {
  source: string;
  finding: string;
  weighsToward: 'client' | 'builder' | 'neither';
  weight: 'decisive' | 'strong' | 'moderate' | 'slight';
};

/**
 * The `analysis` jsonb column, written by lib/resolver/pipeline.ts as exactly these three
 * fields. `builderBps` and `reasoning` are columns of their own, not part of this blob.
 */
export type RulingAnalysis = {
  evidenceAnalysis: EvidenceFinding[];
  manipulationDetected: boolean;
  confidence: 'low' | 'medium' | 'high';
};

/**
 * `public.dispute_resolutions` — the ruling ledger, one row per project forever.
 *
 * `status: 'pending'` is in this union because the column permits it, NOT because a party will
 * ever read one. The RLS policy is `using (status <> 'pending' and is_project_party(...))`, so
 * a claimed-but-unfinished ruling is invisible to the browser and the query simply returns
 * null. The UI therefore cannot distinguish "never requested" from "mid-arbitration" out of
 * this table alone — see the note on the `arbitrating` stage below.
 */
export type DisputeResolutionRow = {
  id: string;
  project_id: number;
  blockchain_id: PgBigInt;
  status: 'pending' | 'signed' | 'failed';
  builder_bps: number | null;
  reasoning: string | null;
  analysis: RulingAnalysis | null;
  signature: `0x${string}` | null;
  attestation_deadline: PgBigInt | null;
  signer: string | null;
  resolver_epoch: number | null;
  model: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Column lists as single string literals.
 *
 * supabase-js only infers a row type when the select argument is one literal — a concatenated
 * string falls back to `any`, which is the trap lib/resolver/pipeline.ts documents around
 * `SELECT_COLUMNS`. Keeping these on one line each preserves inference at the call sites.
 */
export const RESOLUTION_COLUMNS =
  'id, project_id, blockchain_id, status, builder_bps, reasoning, analysis, signature, attestation_deadline, signer, resolver_epoch, model, error, created_at, updated_at';

export const DELIVERABLE_COLUMNS =
  'id, project_id, builder, title, description, artifact_urls, revision_index, created_at';

export const CLAIM_COLUMNS = 'id, project_id, author, role, body, evidence_urls, created_at';

/* -------------------------------------------------------------------------- */
/*                             ESCROW ARITHMETIC                              */
/* -------------------------------------------------------------------------- */

const BPS = BigInt(PROTOCOL.BPS_DENOMINATOR);

export type EscrowSplit = {
  /** The builder's share before the protocol fee. */
  builderGross: bigint;
  /** What the protocol takes. Charged on the builder's share only. */
  protocolFee: bigint;
  /** What actually reaches the builder. */
  builderNet: bigint;
  /** What is refunded to the client. Refunds are never charged a fee. */
  clientRefund: bigint;
};

/**
 * Reproduce the contract's settlement arithmetic exactly, in wei.
 *
 * Mirrors `_settle` and `_payBuilder` in PayNodeEscrowV2 step for step:
 *
 *     builderGross = (total * builderBps) / BPS_DENOMINATOR
 *     clientRefund = total - builderGross
 *     protocolFee  = (builderGross * feeBps) / BPS_DENOMINATOR
 *     builderNet   = builderGross - protocolFee
 *
 * All BigInt, all floor division, in Solidity's order. The ordering is load-bearing: deriving
 * `clientRefund` as its own percentage rather than as the remainder would round both shares
 * down and leave dust stranded, and a verdict card that quotes a figure the payout does not
 * match is worse than one that quotes nothing at all.
 *
 * `feeBps` MUST be the project's snapshotted `onchain.feeBps`, never the live global fee — the
 * contract charges what was snapshotted at funding and is immune to later changes.
 */
export function splitEscrow(total: bigint, builderBps: number, feeBps: number): EscrowSplit {
  const builderGross = (total * BigInt(builderBps)) / BPS;
  const clientRefund = total - builderGross;
  const protocolFee = (builderGross * BigInt(feeBps)) / BPS;
  return { builderGross, protocolFee, builderNet: builderGross - protocolFee, clientRefund };
}

/**
 * Basis points as a percentage string, without going through a float.
 *
 * Exact for every value the contract accepts (0..10000 over a power of ten), so this is
 * presentational rather than a precision guard — but it keeps trailing zeros tidy and puts the
 * conversion in one place instead of `bps / 100` scattered across six components.
 */
export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/* -------------------------------------------------------------------------- */
/*                                URL HANDLING                                */
/* -------------------------------------------------------------------------- */

/**
 * Party-supplied URLs are rendered as `<a href>` on the counterparty's screen, so a
 * `javascript:` or `data:` URL would execute in this origin on click. Only http(s) survives.
 *
 * The same guard exists inline in app/project/[id]/page.tsx as `safeHref`, for the single
 * legacy `delivery_links` field. Evidence lists are the much larger surface: a dispute is
 * precisely the situation in which one party is motivated to hand the other something hostile.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** How many links one submission may cite, and how long each may be. */
export const MAX_URLS = 10;
export const MAX_URL_LENGTH = 2_048;

/**
 * Turn a textarea of one-URL-per-line into the `text[]` the column expects.
 *
 * Returns accepted and rejected lines separately so the form can name the line it refused,
 * rather than dropping it silently. Silent dropping is how a builder ends up believing they
 * cited a repository that the arbitrator never saw.
 */
export function parseUrlList(raw: string): { urls: string[]; rejected: string[] } {
  const urls: string[] = [];
  const rejected: string[] = [];

  for (const line of raw.split(/[\r\n]+/)) {
    const candidate = line.trim();
    if (!candidate) continue;
    if (candidate.length > MAX_URL_LENGTH) {
      rejected.push(`${candidate.slice(0, 60)}…`);
      continue;
    }
    const safe = safeHttpUrl(candidate);
    if (safe) urls.push(safe);
    else rejected.push(candidate);
  }

  return { urls: urls.slice(0, MAX_URLS), rejected };
}

/**
 * Length bound on a free-text field, matching `MAX_FIELD_CHARS` in lib/resolver/evidence.ts.
 *
 * The resolver truncates anything longer when it renders the case file. Enforcing the same
 * bound in the form means a party finds out while they can still edit, instead of having their
 * closing argument cut off inside the prompt.
 */
export const MAX_BODY_CHARS = 20_000;

/* -------------------------------------------------------------------------- */
/*                              THE STATE MACHINE                             */
/* -------------------------------------------------------------------------- */

/**
 * Which party the viewer is. Derived from the CHAIN (`onchain.client`, `onchain.builder`,
 * `projectArbitrator`) and never from Supabase's client-written columns — the same rule the
 * rest of this page already follows.
 *
 * `observer` exists for completeness. In practice RLS denies the project row to a non-party,
 * so the page renders <AccessDenied /> long before this matters. A designated arbitrator is a
 * party who may read the evidence but has no role in PATH 2.
 */
export type ViewerRole = 'client' | 'builder' | 'arbitrator' | 'observer';

/**
 * Where a project sits in the delivery-to-settlement lifecycle.
 *
 * On-chain status is the spine; the ruling ledger only refines what happens once a dispute is
 * already open. Nothing here reads `projects.status`, which is a lagging mirror written by the
 * indexer.
 */
export type DisputeStage =
  /** Funded or InRevision. The builder is working; there is nothing to arbitrate. */
  | 'active'
  /** Delivered. The client's review window is open; after it the builder may claim. */
  | 'claim_window'
  /** Disputed, no ruling visible. Both sides may still file evidence. */
  | 'evidence_open'
  /**
   * Disputed, and this browser asked for a ruling that has not landed yet.
   *
   * NOT derivable from the ledger: RLS hides `status = 'pending'` from the parties, so the very
   * row a party is waiting on is invisible to them. The panel carries this stage from the
   * request mutation's own 202 response instead, which is why it is a client-side fact with a
   * lifetime of one page view.
   */
  | 'arbitrating'
  /** A signed attestation exists and is still inside its deadline. Ready to relay. */
  | 'ruling_ready'
  /**
   * Signed, but past `attestation_deadline`. The contract reverts with AttestationExpired, and
   * the pipeline is idempotent — re-requesting replays this same expired signature rather than
   * issuing a fresh one. Terminal for PATH 2.
   */
  | 'ruling_expired'
  /** The resolver refused to rule. Terminal for PATH 2; PATHS 3 and 4 remain open. */
  | 'ruling_failed'
  /** Completed or Refunded. The escrow has moved. */
  | 'settled'
  /** Cancelled, or AwaitingFunds — no escrow at risk either way. */
  | 'inert';

export type DisputeStageInput = {
  status: ProjectStatus | undefined;
  /** The ruling ledger row, or null when RLS returns nothing (including a pending claim). */
  resolution: DisputeResolutionRow | null | undefined;
  /** Latest block timestamp. The clock the contract compares `deadline` against. */
  nowSeconds: bigint;
  /** True while this page's own resolution request is outstanding. */
  requestInFlight?: boolean;
};

export function deriveDisputeStage(input: DisputeStageInput): DisputeStage {
  const { status, resolution, nowSeconds, requestInFlight } = input;

  if (status === undefined) return 'inert';
  if (status === ProjectStatus.Completed || status === ProjectStatus.Refunded) return 'settled';
  if (status === ProjectStatus.Cancelled || status === ProjectStatus.AwaitingFunds) return 'inert';
  if (status === ProjectStatus.Delivered) return 'claim_window';
  if (status !== ProjectStatus.Disputed) return 'active';

  // ---- Disputed. The ledger decides the rest. ----
  if (resolution?.status === 'failed') return 'ruling_failed';

  if (
    resolution?.status === 'signed' &&
    resolution.signature &&
    resolution.attestation_deadline != null
  ) {
    return toBigInt(resolution.attestation_deadline) > nowSeconds
      ? 'ruling_ready'
      : 'ruling_expired';
  }

  return requestInFlight ? 'arbitrating' : 'evidence_open';
}

/** Header label per stage. */
export const STAGE_LABEL: Record<DisputeStage, string> = {
  active: 'In progress',
  claim_window: 'Awaiting review',
  evidence_open: 'Evidence open',
  arbitrating: 'Arbitration in progress',
  ruling_ready: 'Ruling ready to execute',
  ruling_expired: 'Ruling expired',
  ruling_failed: 'No ruling issued',
  settled: 'Settled',
  inert: '—',
};

/* -------------------------------------------------------------------------- */
/*                        PATH 2 AVAILABILITY (CLIENT-SIDE)                   */
/* -------------------------------------------------------------------------- */

export type ResolverAvailability = { available: true } | { available: false; reason: string };

/**
 * Whether the autonomous resolver can rule on this project, as far as the browser can tell.
 *
 * Mirrors the first three gates of `preflight()` in lib/resolver/evidence.ts, so the UI does
 * not offer a button whose request is guaranteed to come back ineligible:
 *
 *   - status must be Disputed
 *   - `projectArbitrator` must be unset — PATHS 1 and 2 are mutually exclusive
 *   - `resolverFor(projectId)` must be non-zero, i.e. the project's own epoch has a key
 *
 * The FOURTH gate cannot be checked here. The contract verifies against the key that was live
 * when the client funded (`resolverAt[p.resolverEpoch]`), and whether the deployed service
 * still holds that key is a server-side fact: `resolverFor` returning non-zero proves a key
 * exists for the epoch, not that this deployment is it. An epoch mismatch therefore surfaces
 * as an `ineligible` response from the request route, which the panel renders verbatim.
 */
export function resolverAvailability(args: {
  status: ProjectStatus | undefined;
  hasArbitrator: boolean;
  hasResolver: boolean;
}): ResolverAvailability {
  if (args.status !== ProjectStatus.Disputed) {
    return { available: false, reason: 'This project is not in dispute.' };
  }
  if (args.hasArbitrator) {
    return {
      available: false,
      reason:
        'This project named a designated arbitrator, who rules on it instead. Automatic ' +
        'resolution is unavailable.',
    };
  }
  if (!args.hasResolver) {
    return {
      available: false,
      reason:
        'Automatic resolution was not enabled when this project was funded. Settle directly ' +
        'with the other party, or wait for the 30-day timeout.',
    };
  }
  return { available: true };
}

/* -------------------------------------------------------------------------- */
/*                         THE THREE RESOLUTION PATHS                         */
/* -------------------------------------------------------------------------- */

/**
 * PayNode gives a disputing party three ways out, and which of them are open is a property of
 * the PROJECT, decided before the dispute existed:
 *
 *   PATH 1  `resolveDispute`                        a human arbitrator named at creation
 *   PATH 2  `resolveDisputeWithAttestation`         the autonomous resolver, signed by the
 *                                                   key for the project's resolver epoch
 *   PATH 3  `proposeSettlement`/`acceptSettlement`  a 2-of-2 split between the parties
 *
 * PATHS 1 and 2 are MUTUALLY EXCLUSIVE. `resolveDispute` admits only `projectArbitrator`, and
 * `preflight()` in lib/resolver/evidence.ts refuses PATH 2 whenever that address is set. Exactly
 * one adjudicator governs any project and which one was fixed when the client funded. PATH 3 is
 * open at every funded status including Disputed, so it is the one route that never depends on
 * a third party.
 *
 * PATH 4, `forceResolveStaleDispute`, is deliberately NOT in this list. It is not a way to
 * resolve a dispute; it is the guarantee that no reachable state holds funds forever. It takes
 * 30 days and its outcome is fixed by the contract rather than chosen by anyone. Presenting it
 * as a fourth option would offer "wait a month and accept whatever the contract decides" as a
 * peer of three real choices. Every surface quotes it separately, as a deadline, from
 * `DISPUTE_WINDOWS.staleDays`.
 *
 * WHY THIS LIVES HERE. The warning modal, the dispute panel and the project page each have to
 * tell a party the same thing about the same project, and each carried its own
 * `hasArbitrator ? … : hasResolver ? … : …` ladder in prose. Three ladders is three chances for
 * one screen to promise a route another screen says is closed. One function, three renderers.
 */

export type ResolutionPathId = 'arbitrator' | 'resolver' | 'settlement';

export type ResolutionPathInfo = {
  id: ResolutionPathId;
  /**
   * The contract's own numbering, so a party can read this against PayNodeEscrowV2.sol.
   *
   * That NatSpec numbers the paths from 1 (`PATH 1 — the project's designated arbitrator…`).
   * `ResolutionPath` in lib/paynode.ts is the SAME list zero-indexed, because it mirrors the
   * `DisputeResolved` event field the indexer stores. Quoting the NatSpec numbers here is
   * deliberate: it is what a reader comparing the UI with the source sees. Do not renumber one
   * without the other, and note that this type is not that enum — hence `…Info`.
   */
  pathNumber: 1 | 2 | 3;
  title: string;
  /** The contract function behind it. A footnote for a party who wants to verify, not decoration. */
  onchain: string;
  /** What the route does, in one sentence, true whether or not it is open. */
  summary: string;
  /** Rendered monospace beside the title: the arbitrator's label, the signing epoch. */
  subject?: string;
  available: boolean;
  /**
   * Why it is closed. Set iff `available` is false — a closed path is still listed, because a
   * party who simply cannot see PATH 2 has no way to tell whether it is off for this project or
   * the app failed to offer it.
   */
  closedBecause?: string;
  /** The three facts that decide which route a party takes. Present iff `available`. */
  facts?: {
    /** Who can start it. */
    starts: string;
    /** How long it takes, in the terms a party cares about. */
    speed: string;
    /** What binds the outcome, and whether it can be undone. */
    binding: string;
  };
};

/**
 * Describe the routes out of a dispute for ONE project, open ones first.
 *
 * Every field is derived from chain reads the caller already holds — `projectArbitrator` for
 * PATH 1, `resolverFor(projectId)` for PATH 2 — so nothing here can advertise a capability the
 * contract would refuse. The one thing it cannot know is whether the deployed resolver service
 * still holds the key for this project's epoch: that is the server-side fourth gate documented
 * on `resolverAvailability` above. A non-zero `resolverFor` proves a key exists for the epoch,
 * which is what `available` claims and no more.
 */
export function resolutionPaths(args: {
  hasArbitrator: boolean;
  hasResolver: boolean;
  /** `@username` or a shortened address. Presentational; never used for a decision. */
  arbitratorLabel?: string;
  /** `onchain.resolverEpoch` — the resolver generation snapshotted when the client funded. */
  resolverEpoch?: number;
}): ResolutionPathInfo[] {
  const { hasArbitrator, hasResolver, arbitratorLabel, resolverEpoch } = args;

  const arbitrator: ResolutionPathInfo = {
    id: 'arbitrator',
    pathNumber: 1,
    title: 'Named human arbitrator',
    onchain: 'resolveDispute',
    subject: hasArbitrator ? arbitratorLabel : undefined,
    summary:
      'A third-party wallet, named when the project was created, reads the case and rules: ' +
      'release to the builder, refund the client, or any split between the two.',
    available: hasArbitrator,
    closedBecause: hasArbitrator
      ? undefined
      : 'No arbitrator wallet was specified when this project was created, and one cannot be ' +
        'added afterwards.',
    facts: hasArbitrator
      ? {
          starts: 'Only the arbitrator. Neither party can trigger a ruling or hurry one along.',
          speed: 'Whenever they rule — this path has no deadline of its own.',
          binding: 'Pays out the moment they submit it. It cannot be revised or appealed.',
        }
      : undefined,
  };

  const resolver: ResolutionPathInfo = {
    id: 'resolver',
    pathNumber: 2,
    title: 'Automatic AI arbitrator',
    onchain: 'resolveDisputeWithAttestation',
    // Only on the OPEN path. On a project with a named arbitrator `resolverFor` still returns a
    // key — the epoch exists, it just cannot be used here — and printing "signing epoch 1" under
    // a card badged "Not available" reads as a contradiction.
    subject:
      !hasArbitrator && hasResolver && resolverEpoch !== undefined
        ? `signing epoch ${resolverEpoch}`
        : undefined,
    summary:
      'PayNode’s resolver reads the brief, every deliverable on record, the verified blockchain ' +
      'timeline and both parties’ statements, then divides the escrow — anywhere from 0% to ' +
      '100% to the builder.',
    available: !hasArbitrator && hasResolver,
    closedBecause: hasArbitrator
      ? 'This project named its own arbitrator, who rules instead. A project has exactly one ' +
        'adjudicator, and the two are mutually exclusive.'
      : hasResolver
        ? undefined
        : 'Automatic resolution was not enabled for this project, so no key exists to sign a ' +
          'ruling with.',
    facts:
      !hasArbitrator && hasResolver
        ? {
            starts: 'Either party, once both have had a fair chance to file their evidence.',
            speed: 'Rules in about a minute. The signed ruling is then relayed on-chain.',
            binding:
              'Binding and final: one ruling per project, enforced by the contract, with no ' +
              'appeal and no second pass.',
          }
        : undefined,
  };

  /**
   * Always open while there is an escrow at all. `proposeSettlement` accepts every funded
   * status, Disputed included, and its own comment in the contract says why: so the parties can
   * always settle between themselves without waiting on an arbitrator, a resolver or the
   * timeout.
   */
  const settlement: ResolutionPathInfo = {
    id: 'settlement',
    pathNumber: 3,
    title: 'Mutual settlement',
    onchain: 'proposeSettlement / acceptSettlement',
    summary:
      'One of you proposes a percentage split and the other accepts it on-chain. No arbitrator, ' +
      'no AI, no waiting period — the escrow pays out on the second signature.',
    available: true,
    facts: {
      starts: 'Either party, at any time, including while another path is already under way.',
      speed: 'Immediate. It settles in the block the offer is accepted in.',
      binding:
        'Needs both of you. An offer binds nobody until it is accepted and can be withdrawn ' +
        'until then; accepting pays out at exactly the split shown.',
    },
  };

  // The adjudicator that actually governs this project leads, because it answers "who decides
  // if we cannot agree". Mutual settlement follows, since it is always open. The excluded
  // adjudicator comes last, present only so that its absence is explained rather than silent.
  const ordered: ResolutionPathInfo[] = hasArbitrator
    ? [arbitrator, settlement, resolver]
    : [resolver, settlement, arbitrator];

  return [...ordered.filter((p) => p.available), ...ordered.filter((p) => !p.available)];
}

/* -------------------------------------------------------------------------- */
/*                          WINDOWS QUOTED IN THE UI                          */
/* -------------------------------------------------------------------------- */

/**
 * The durations a disputing party needs to understand, each sourced from the constant that
 * actually enforces it.
 *
 * These are easy to conflate and two of them are seven days, so the warning modal quotes them
 * from here rather than hardcoding prose:
 *
 *   review   7d — PROTOCOL.REVIEW_PERIOD_SECONDS. After delivery the client has this long to
 *                 approve or dispute; then the builder may claim the escrow.
 *   stale   30d — PROTOCOL.DISPUTE_TIMEOUT_SECONDS. A dispute nobody resolves becomes
 *                 permissionlessly settleable: 50/50 if work had been delivered, otherwise a
 *                 full refund to the client.
 *
 * NOT included, deliberately: the 7-day RESOLVER_TIMELOCK. That governs rotation of the
 * resolver signing key and has no bearing on a party's dispute — surfacing it alongside these
 * would read as another deadline they have to track. The attestation's own 7-day TTL is not
 * here either, because it only begins once a ruling exists; the verdict card quotes it from
 * the stored `attestation_deadline`, which is the only authoritative copy.
 */
export const DISPUTE_WINDOWS = {
  reviewDays: PROTOCOL.REVIEW_PERIOD_SECONDS / 86_400,
  staleDays: PROTOCOL.DISPUTE_TIMEOUT_SECONDS / 86_400,
  staleBuilderBps: PROTOCOL.STALE_DISPUTE_BUILDER_BPS,
} as const;

/* -------------------------------------------------------------------------- */
/*                   /api/dispute/request-resolution CONTRACT                 */
/* -------------------------------------------------------------------------- */

/**
 * The wire contract between the party-facing trigger route and the hook that calls it.
 *
 * WHY A SECOND ROUTE EXISTS AT ALL. `/api/dispute/resolve` authenticates with
 * RESOLVER_SECRET and its own header says "WHO MAY CALL THIS. Not the parties." That is
 * correct and must stay that way: the secret authorises a signature that moves escrow, so a
 * browser holding it could re-trigger arbitration, and the whole claim-first design in
 * lib/resolver/pipeline.ts exists to stop exactly that. A party still needs *some* way to ask
 * for a ruling, so the request route is a thin, SIWE-authenticated, party-gated front door
 * that calls `resolveDispute()` in-process. The secret never leaves the server, and the
 * pipeline's idempotency remains the real guarantee.
 *
 * Declared here rather than in the route so both sides share one definition. This file has no
 * `'use client'` and no `'server-only'`, which is what makes that possible.
 */
export type ResolveRequestResponse =
  /** A signed attestation exists. Re-read the ledger; do not trust these fields for signing. */
  | { ok: true; status: 'signed'; replayed: boolean; builderBps: number }
  /** Claimed and mid-flight. RLS hides the pending row, so this response is the only signal. */
  | { ok: true; status: 'pending'; message: string }
  /** The resolver declined to rule. Terminal for PATH 2. */
  | { ok: false; status: 'failed'; message: string }
  /** A `preflight()` gate refused: not disputed, arbitrator assigned, resolver off, epoch drift. */
  | { ok: false; status: 'ineligible'; reason: string; message: string }
  /** The evidence window has not closed yet. `retryAfterSeconds` is chain-derived. */
  | { ok: false; status: 'too_early'; message: string; retryAfterSeconds: number }
  /** Not signed in, or not a party to this project. */
  | { ok: false; status: 'forbidden'; message: string }
  /** Anything else. The message is safe to show; the detail is in the server log. */
  | { ok: false; status: 'error'; message: string };

/**
 * How long after `raiseDispute` a party may ask for a ruling, when only one side has filed.
 *
 * A ruling is one-shot and unappealable, so the first party to file must not be able to have
 * the case decided before the other has answered. Once BOTH sides have filed a statement the
 * wait is pointless and the route skips it.
 *
 * The server owns the enforcement — this constant is exported for the copy in the UI, which
 * has to quote the same number. Overridable server-side via
 * DISPUTE_EVIDENCE_WINDOW_SECONDS; the UI reads the authoritative remainder off the
 * `too_early` response rather than computing it.
 */
export const DEFAULT_EVIDENCE_WINDOW_SECONDS = 72 * 60 * 60;
