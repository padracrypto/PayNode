'use client';

/**
 * React Query data layer for dispute resolution.
 *
 * Three read hooks over the tables migration 0010 added, three mutations, and one
 * invalidation helper the page calls when the chain moves. All of it goes through the
 * SIWE-authenticated `supabase` client in lib/supabase.ts, so every query is filtered by the
 * RLS policies rather than by anything decided here.
 *
 * TWO RULES THIS FILE FOLLOWS THROUGHOUT.
 *
 * 1. EVERY QUERY KEY CARRIES THE AUTHED WALLET. Not for cache efficiency — for correctness.
 *    These rows are visible only to the project's parties, and the visible set changes the
 *    instant the user switches accounts in their wallet. Keyed by wallet, React Query treats a
 *    switch as a different cache entry; unkeyed, the new account briefly renders the previous
 *    account's dispute evidence. app/dashboard/page.tsx documents the same reasoning.
 *
 * 2. `enabled` REQUIRES A SESSION. An anonymous PostgREST request against these tables returns
 *    an empty array, not an error, which is indistinguishable from "this project has no
 *    evidence". Gating on `authedWallet` means an unauthenticated page shows a sign-in prompt
 *    instead of confidently claiming the record is empty.
 *
 * ON "REAL-TIME": these tables are not in the `supabase_realtime` publication, and this
 * project's Supabase client authenticates with a self-minted JWT through the `accessToken`
 * hook rather than a Supabase Auth session — so a postgres_changes channel would need both a
 * migration and a realtime auth path that does not exist yet. What is here instead is
 * reactive polling whose interval is driven by the stage: seconds while a ruling is being
 * waited on, minutes once nothing is expected to change, and off entirely once settled. The
 * page additionally invalidates on `DisputeResolved` via the existing `useWatchContractEvent`,
 * so the settlement itself lands immediately rather than on the next poll.
 */

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useSiwe } from '../../app/providers/SiweProvider';
import {
  CLAIM_COLUMNS,
  DELIVERABLE_COLUMNS,
  RESOLUTION_COLUMNS,
  type DeliverableRow,
  type DisputeClaimRow,
  type DisputeResolutionRow,
  type DisputeRole,
  type DisputeStage,
  type ResolveRequestResponse,
} from './types';

/* -------------------------------------------------------------------------- */
/*                                 QUERY KEYS                                 */
/* -------------------------------------------------------------------------- */

/**
 * One factory so the mutations and the page's chain-event handler invalidate exactly what the
 * read hooks populate. A hand-written key that disagrees by one element is a cache that never
 * refreshes, and the symptom — a submitted deliverable that does not appear until reload —
 * looks like a failed write rather than a stale key.
 */
export const disputeKeys = {
  all: (wallet: string | null) => ['dispute', wallet] as const,
  deliverables: (wallet: string | null, projectRowId: number | undefined) =>
    ['dispute', wallet, 'deliverables', projectRowId] as const,
  claims: (wallet: string | null, projectRowId: number | undefined) =>
    ['dispute', wallet, 'claims', projectRowId] as const,
  resolution: (wallet: string | null, blockchainId: string | undefined) =>
    ['dispute', wallet, 'resolution', blockchainId] as const,
};

/* -------------------------------------------------------------------------- */
/*                              POLLING CADENCE                               */
/* -------------------------------------------------------------------------- */

/**
 * How often to re-read, by stage.
 *
 * `false` means stop: a settled project's evidence is immutable, and a page left open on one
 * should not poll a database forever. `arbitrating` is the only fast cadence, because that is
 * the one stage where the user is actively waiting for a row to appear — and it is the stage
 * RLS makes invisible, so polling is the only way the ruling ever shows up.
 */
const POLL_MS: Record<DisputeStage, number | false> = {
  active: 60_000,
  claim_window: 30_000,
  evidence_open: 15_000,
  arbitrating: 5_000,
  ruling_ready: 30_000,
  ruling_expired: false,
  ruling_failed: false,
  settled: false,
  inert: false,
};

export const pollIntervalFor = (stage: DisputeStage) => POLL_MS[stage];

/* -------------------------------------------------------------------------- */
/*                                   READS                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every deliverable the builder has submitted, oldest first.
 *
 * Keyed on `projects.id` (the Supabase surrogate key), which is what `deliverables.project_id`
 * references — NOT the on-chain id. lib/resolver/evidence.ts calls out how easy those two are
 * to swap now that both are numeric; the resolution hook below takes the other one.
 */
export function useDeliverables(projectRowId: number | undefined, stage: DisputeStage) {
  const { authedWallet } = useSiwe();

  return useQuery({
    queryKey: disputeKeys.deliverables(authedWallet, projectRowId),
    enabled: !!authedWallet && projectRowId !== undefined,
    placeholderData: keepPreviousData,
    refetchInterval: pollIntervalFor(stage),
    queryFn: async (): Promise<DeliverableRow[]> => {
      const { data, error } = await supabase
        .from('deliverables')
        .select(DELIVERABLE_COLUMNS)
        .eq('project_id', projectRowId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as DeliverableRow[];
    },
  });
}

/**
 * Both parties' filed statements, oldest first.
 *
 * Ordered ascending and returned whole rather than grouped by role: the threaded view needs
 * chronology across both sides to read as a conversation, and the side-by-side view can group
 * in the component. Sorting server-side keeps the two views consistent with the order the
 * resolver itself read them in (`gatherCaseFile` also orders ascending).
 */
export function useDisputeClaims(projectRowId: number | undefined, stage: DisputeStage) {
  const { authedWallet } = useSiwe();

  return useQuery({
    queryKey: disputeKeys.claims(authedWallet, projectRowId),
    enabled: !!authedWallet && projectRowId !== undefined,
    placeholderData: keepPreviousData,
    refetchInterval: pollIntervalFor(stage),
    queryFn: async (): Promise<DisputeClaimRow[]> => {
      const { data, error } = await supabase
        .from('dispute_claims')
        .select(CLAIM_COLUMNS)
        .eq('project_id', projectRowId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as DisputeClaimRow[];
    },
  });
}

/**
 * The ruling, if one is visible.
 *
 * Keyed on `blockchain_id` — the ON-CHAIN project id — because that is the ledger's identity
 * and its unique constraint. Passed as a decimal string so a bigint never round-trips through
 * a query key.
 *
 * `null` is an ordinary, expected result and means one of three different things: no ruling was
 * ever requested, a ruling is mid-flight (RLS hides `status = 'pending'` from parties), or the
 * session cannot see the project. The caller cannot distinguish them from this hook alone —
 * `deriveDisputeStage` takes the request mutation's own response to tell the second case apart.
 *
 * `maybeSingle()`, not `single()`: `single()` treats zero rows as a PostgREST error, which would
 * make the ordinary no-ruling-yet case render as a failure.
 */
export function useDisputeResolution(blockchainId: bigint | undefined, stage: DisputeStage) {
  const { authedWallet } = useSiwe();
  const key = blockchainId?.toString();

  return useQuery({
    queryKey: disputeKeys.resolution(authedWallet, key),
    enabled: !!authedWallet && key !== undefined,
    placeholderData: keepPreviousData,
    /**
     * Stop as soon as a terminal row is in hand.
     *
     * The function form rather than a plain interval, because the caller cannot pass an accurate
     * stage: it needs this query's result to compute one, so the `stage` it hands in is derived
     * from chain status alone and reads `evidence_open` even once a ruling has landed. Left as a
     * fixed interval, a page open on an expired or declined ruling would re-poll every fifteen
     * seconds forever for a row that can never change again. A `signed` or `failed` row is
     * immutable — the ledger keeps one per project, permanently — so there is nothing to watch
     * for, and the chain half of the story arrives through `DisputeResolved` instead.
     */
    refetchInterval: (query) => {
      const row = query.state.data;
      if (row && (row.status === 'signed' || row.status === 'failed')) return false;
      return pollIntervalFor(stage);
    },
    queryFn: async (): Promise<DisputeResolutionRow | null> => {
      const { data, error } = await supabase
        .from('dispute_resolutions')
        .select(RESOLUTION_COLUMNS)
        .eq('blockchain_id', key!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as DisputeResolutionRow | null;
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                               INVALIDATION                                 */
/* -------------------------------------------------------------------------- */

/**
 * Drop every dispute query for the current session.
 *
 * Called by the page when the chain reports something that invalidates the off-chain view —
 * `DisputeResolved`, or a status transition — so the panel does not sit on stale evidence until
 * the next poll tick. Scoped to `['dispute', wallet]` so it cannot clear another account's
 * entries out from under a concurrent render.
 */
export function useInvalidateDispute() {
  const queryClient = useQueryClient();
  const { authedWallet } = useSiwe();

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: disputeKeys.all(authedWallet) });
  }, [queryClient, authedWallet]);
}

/* -------------------------------------------------------------------------- */
/*                                 MUTATIONS                                  */
/* -------------------------------------------------------------------------- */

/**
 * Re-read the session from the server before a write, and return the wallet it belongs to.
 *
 * `authedWallet` is read once at mount and not re-validated, so a token that expired while the
 * page sat open leaves it holding a wallet the server no longer recognises — the exact hazard
 * SiweProvider's own `refresh()` docs describe. Every mutation below calls this first, so a
 * stale session produces a legible error here instead of an opaque RLS rejection at PostgREST.
 */
function useFreshSession() {
  const { refresh } = useSiwe();
  return useCallback(async (): Promise<string> => {
    const wallet = await refresh();
    if (!wallet) {
      throw new Error('Your session has expired. Sign in with your wallet again to continue.');
    }
    return wallet;
  }, [refresh]);
}

export type SubmitDeliverableInput = {
  projectRowId: number;
  /** The builder's wallet. Must equal the session wallet, or the RLS check rejects the insert. */
  builder: string;
  title: string;
  description: string;
  artifactUrls: string[];
  /**
   * The on-chain `revisionsUsed` at submission time, which is what the column is defined to
   * mirror. `projects` has no such column — the revision counter lives only in the contract —
   * so this has to be read from the chain and passed in.
   */
  revisionIndex: number;
};

/**
 * Record a deliverable.
 *
 * EVIDENCE ONLY. This does not touch project status: `markDelivered` on-chain remains the sole
 * thing that moves a project to Delivered, exactly as migration 0010's header states. The
 * caller is responsible for sending that transaction, and should do so only after this
 * resolves — a chain status of Delivered with no submission row behind it is the failure the
 * existing `deliverWork()` ordering already guards against.
 */
export function useSubmitDeliverable() {
  const queryClient = useQueryClient();
  const requireSession = useFreshSession();
  const { authedWallet } = useSiwe();

  return useMutation({
    mutationFn: async (input: SubmitDeliverableInput) => {
      const wallet = await requireSession();
      if (wallet !== input.builder.toLowerCase()) {
        throw new Error(
          'The signed-in wallet is not this project’s builder, so this submission would be rejected.',
        );
      }

      // Column list matches the INSERT grant in migration 0010 exactly. Sending anything else —
      // `created_at`, say — fails with a column-level permission error, which is the point:
      // a party must not be able to backdate their own evidence.
      const { data, error } = await supabase
        .from('deliverables')
        .insert({
          project_id: input.projectRowId,
          builder: wallet,
          title: input.title.trim() || null,
          description: input.description.trim() || null,
          artifact_urls: input.artifactUrls,
          revision_index: input.revisionIndex,
        })
        .select(DELIVERABLE_COLUMNS)
        .single();

      if (error) throw error;
      return data as unknown as DeliverableRow;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: disputeKeys.all(authedWallet),
      });
    },
  });
}

export type FileClaimInput = {
  projectRowId: number;
  /** The author's wallet. Must equal the session wallet. */
  author: string;
  /**
   * Which side the author is on, decided from the CHAIN by the caller. RLS re-derives it with
   * `project_role()` and rejects a mismatch, so a client cannot file a statement attributed to
   * the builder — this field is a declaration the server checks, not a claim it trusts.
   */
  role: DisputeRole;
  body: string;
  evidenceUrls: string[];
};

/** File one party's statement and its cited links. */
export function useFileClaim() {
  const queryClient = useQueryClient();
  const requireSession = useFreshSession();
  const { authedWallet } = useSiwe();

  return useMutation({
    mutationFn: async (input: FileClaimInput) => {
      const wallet = await requireSession();
      if (wallet !== input.author.toLowerCase()) {
        throw new Error(
          'The signed-in wallet does not match the account filing this statement. Reconnect and try again.',
        );
      }

      const { data, error } = await supabase
        .from('dispute_claims')
        .insert({
          project_id: input.projectRowId,
          author: wallet,
          role: input.role,
          body: input.body.trim(),
          evidence_urls: input.evidenceUrls,
        })
        .select(CLAIM_COLUMNS)
        .single();

      if (error) throw error;
      return data as unknown as DisputeClaimRow;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: disputeKeys.all(authedWallet) });
    },
  });
}

/**
 * Ask the resolver for a ruling.
 *
 * Posts to `/api/dispute/request-resolution`, NOT to `/api/dispute/resolve`. The latter
 * authenticates with RESOLVER_SECRET and is documented as operator-only; a browser cannot hold
 * that secret, and giving it one would let a party re-trigger arbitration until they liked the
 * split. The request route authenticates with the SIWE session cookie, confirms the caller is a
 * party, enforces the evidence window, and only then calls the same pipeline server-side.
 *
 * Every outcome resolves rather than throws, except a genuinely malformed response. The
 * caller renders `ineligible`, `too_early` and `failed` as information, not as errors — each is
 * a legitimate answer with something specific to tell the user, and routing them through
 * `onError` would flatten all three into one red box.
 */
export function useRequestResolution() {
  const queryClient = useQueryClient();
  const { authedWallet } = useSiwe();

  return useMutation({
    mutationFn: async (blockchainId: bigint): Promise<ResolveRequestResponse> => {
      const res = await fetch('/api/dispute/request-resolution', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        // A decimal string, never a JS number: the value the route feeds into a signed digest
        // must survive JSON without a lossy float conversion.
        body: JSON.stringify({ projectId: blockchainId.toString() }),
      });

      const body = (await res.json().catch(() => null)) as ResolveRequestResponse | null;
      if (!body || typeof body !== 'object' || !('status' in body)) {
        throw new Error(
          `The resolver service returned an unreadable response (HTTP ${res.status}). Try again in a moment.`,
        );
      }
      return body;
    },
    onSettled: () => {
      // Re-read the ledger whatever the answer was. A `signed` response means a row is now
      // visible; a `pending` one means polling should pick it up; and re-reading after an
      // `ineligible` costs one query and rules out a stale cached null.
      void queryClient.invalidateQueries({ queryKey: disputeKeys.all(authedWallet) });
    },
  });
}
