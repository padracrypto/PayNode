import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { arbitrate, ArbitrationRefused } from './arbitrate';
import { signResolution, submissionCall, type Attestation } from './attest';
import { gatherCaseFile, Ineligible, loadProjectRow, preflight } from './evidence';
import { formatUSDC } from '../paynode';

/**
 * Orchestration, and the idempotency that makes this endpoint safe to call twice.
 *
 * THE THREAT THIS IS BUILT AROUND. On-chain, a submitted attestation cannot be replayed:
 * settling moves the project to a terminal status and nothing returns it to Disputed. What
 * the contract cannot see is two DIFFERENT attestations for the same project, both valid,
 * signed minutes apart. A party who could re-run arbitration until it produced a friendlier
 * split — and then submit only that one — would have converted arbitration into a re-roll.
 *
 * The defence is a claim-first write. Before a single token is spent, the pipeline inserts a
 * `pending` row keyed uniquely on the on-chain project id. Two concurrent requests race that
 * insert; exactly one wins, the loser is served the winner's outcome. A request for a project
 * that already ruled is served the ORIGINAL signature, byte for byte, forever.
 *
 * Note the ordering: claim, then call the model. Claiming afterwards would leave a window in
 * which two requests both arbitrate, and the one that loses the insert has already produced a
 * second ruling — which then exists in the logs, and in whatever the loser's caller does with
 * the response.
 */

/** Postgres unique_violation. The signal that another request already claimed this project. */
const PG_UNIQUE_VIOLATION = '23505';

export type ResolutionRecord = {
  status: 'pending' | 'signed' | 'failed';
  builder_bps: number | null;
  reasoning: string | null;
  analysis: unknown;
  signature: string | null;
  attestation_deadline: number | null;
  signer: string | null;
  resolver_epoch: number | null;
  model: string | null;
  error: string | null;
  created_at: string;
};

export type ResolveOutcome =
  | { kind: 'signed'; replayed: boolean; record: ResolutionRecord; submission: ReturnType<typeof submissionCall> }
  | { kind: 'pending'; record: ResolutionRecord }
  | { kind: 'failed'; replayed: boolean; record: ResolutionRecord }
  | { kind: 'ineligible'; reason: Ineligible['reason']; message: string };

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

const SELECT_COLUMNS =
  'status, builder_bps, reasoning, analysis, signature, attestation_deadline, signer, ' +
  'resolver_epoch, model, error, created_at';

async function readRecord(
  db: SupabaseClient,
  blockchainId: bigint,
): Promise<ResolutionRecord | null> {
  const { data, error } = await db
    .from('dispute_resolutions')
    .select(SELECT_COLUMNS)
    .eq('blockchain_id', Number(blockchainId))
    .maybeSingle();
  if (error) throw new Error(`[resolver] cannot read ruling ledger: ${error.message}`);
  // See the note in evidence.ts: SELECT_COLUMNS is concatenated, so inference falls back.
  return (data as unknown as ResolutionRecord | null) ?? null;
}

/**
 * A `pending` row older than this is treated as abandoned and may be retried.
 *
 * A crash between claiming the row and writing the ruling would otherwise wedge the project
 * permanently — no ruling, and no way to ask for one. The window has to exceed the worst-case
 * model latency by a wide margin, because reclaiming a row whose arbitration is still running
 * reintroduces exactly the double-ruling this design exists to prevent. Fifteen minutes
 * against a call that takes under two.
 */
const STALE_CLAIM_MS = 15 * 60 * 1000;

const isStale = (r: ResolutionRecord) =>
  r.status === 'pending' && Date.now() - new Date(r.created_at).getTime() > STALE_CLAIM_MS;

function rebuildAttestation(r: ResolutionRecord, blockchainId: bigint): Attestation {
  return {
    projectId: blockchainId,
    builderBps: r.builder_bps!,
    deadline: BigInt(r.attestation_deadline!),
    signature: r.signature as `0x${string}`,
    signer: r.signer as `0x${string}`,
    digest: '0x' as `0x${string}`, // not persisted; not needed to submit
  };
}

/* -------------------------------------------------------------------------- */
/*                                  PIPELINE                                  */
/* -------------------------------------------------------------------------- */

export async function resolveDispute(
  db: SupabaseClient,
  blockchainId: bigint,
): Promise<ResolveOutcome> {
  /* ---- 0. Serve an existing ruling without re-arbitrating. ---- */
  const existing = await readRecord(db, blockchainId);
  if (existing && !isStale(existing)) {
    return replay(existing, blockchainId);
  }

  /* ---- 1. Chain preflight, before spending anything. ---- */
  let project: Awaited<ReturnType<typeof loadProjectRow>>;
  let epoch: number;
  try {
    // preflight() reads the chain; loadProjectRow() confirms there is evidence to read.
    const pre = await preflight(blockchainId);
    epoch = pre.onChain.resolverEpoch;
    project = await loadProjectRow(db, blockchainId);
  } catch (err) {
    if (err instanceof Ineligible) {
      // Deliberately NOT persisted. Ineligibility is a property of the moment: a project that
      // is "not_disputed" now may be disputed in an hour, and writing a `failed` row would
      // permanently consume the project's one ruling slot over a transient state.
      return { kind: 'ineligible', reason: err.reason, message: err.message };
    }
    throw err;
  }

  /* ---- 2. Claim the slot. This is the replay guard. ---- */
  if (existing && isStale(existing)) {
    console.warn(
      `[resolver] Reclaiming a pending ruling for project ${blockchainId} abandoned at ` +
        `${existing.created_at}.`,
    );
    const { error } = await db
      .from('dispute_resolutions')
      .update({ created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('blockchain_id', Number(blockchainId))
      .eq('status', 'pending'); // no-op if another worker already finished it
    if (error) throw new Error(`[resolver] cannot reclaim stale ruling: ${error.message}`);
  } else {
    const { error } = await db.from('dispute_resolutions').insert({
      project_id: project.id,
      blockchain_id: Number(blockchainId),
      status: 'pending',
      resolver_epoch: epoch,
    });

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        // Lost the race. The winner's row is authoritative; serve it rather than ruling twice.
        const winner = await readRecord(db, blockchainId);
        if (winner) return replay(winner, blockchainId);
      }
      throw new Error(`[resolver] cannot claim ruling slot: ${error.message}`);
    }
  }

  /* ---- 3. Arbitrate and sign. ---- */
  try {
    const caseFile = await gatherCaseFile(db, blockchainId);
    const { ruling, model, inputTokens, outputTokens } = await arbitrate(caseFile);

    const attestation = await signResolution({
      projectId: blockchainId,
      builderBps: ruling.builderBps,
      nowSeconds: caseFile.nowSeconds,
    });

    const { data, error } = await db
      .from('dispute_resolutions')
      .update({
        status: 'signed',
        builder_bps: ruling.builderBps,
        reasoning: ruling.reasoning,
        analysis: {
          evidenceAnalysis: ruling.evidenceAnalysis,
          manipulationDetected: ruling.manipulationDetected,
          confidence: ruling.confidence,
        },
        signature: attestation.signature,
        attestation_deadline: Number(attestation.deadline),
        signer: attestation.signer.toLowerCase(),
        resolver_epoch: epoch,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        updated_at: new Date().toISOString(),
      })
      .eq('blockchain_id', Number(blockchainId))
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      // The signature exists but could not be stored. Log it — this is the one case where the
      // resolver has committed its key to a ruling that nothing has a record of.
      console.error(
        `[resolver] CRITICAL: signed project ${blockchainId} at ${ruling.builderBps} bps but ` +
          `could not persist it: ${error.message}. Signature: ${attestation.signature}`,
      );
      throw new Error(`[resolver] cannot persist ruling: ${error.message}`);
    }

    await notifyParties(db, project, ruling.builderBps, blockchainId);

    return {
      kind: 'signed',
      replayed: false,
      record: data as unknown as ResolutionRecord,
      submission: submissionCall(attestation),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    /**
     * A refusal is terminal and is recorded as such: the model will not rule on this dispute
     * and retrying spends money to be told so again. The project falls through to mutual
     * settlement or, after 30 days, `forceResolveStaleDispute`.
     *
     * Everything else — an RPC blip, a 429, a transport error — releases the claim so the
     * next call can retry. Persisting those as `failed` would consume the project's only
     * ruling slot over a network hiccup.
     */
    if (err instanceof ArbitrationRefused) {
      const { data } = await db
        .from('dispute_resolutions')
        .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
        .eq('blockchain_id', Number(blockchainId))
        .select(SELECT_COLUMNS)
        .single();
      return { kind: 'failed', replayed: false, record: data as unknown as ResolutionRecord };
    }

    await db
      .from('dispute_resolutions')
      .delete()
      .eq('blockchain_id', Number(blockchainId))
      .eq('status', 'pending');

    throw err;
  }
}

function replay(record: ResolutionRecord, blockchainId: bigint): ResolveOutcome {
  if (record.status === 'signed') {
    return {
      kind: 'signed',
      replayed: true,
      record,
      submission: submissionCall(rebuildAttestation(record, blockchainId)),
    };
  }
  if (record.status === 'failed') return { kind: 'failed', replayed: true, record };
  return { kind: 'pending', record };
}

/* -------------------------------------------------------------------------- */
/*                               NOTIFICATIONS                                */
/* -------------------------------------------------------------------------- */

/**
 * Tell both parties a ruling is ready to submit.
 *
 * Distinct from the indexer's DISPUTE_RESOLVED notification, which fires when the settlement
 * actually lands on-chain. This one fires when the attestation is issued — the point at which
 * someone has to go and relay it. Without it the signature sits in a table nobody looks at.
 *
 * `event_key` is `resolution:<projectId>`, which cannot collide with the indexer's
 * '<txHash>:<logIndex>' or the tip path's 'tip:<txHash>', and makes a retried pipeline run a
 * no-op rather than a second ping. Failure here is logged, never thrown: a notification that
 * did not send must not discard a signed ruling.
 */
async function notifyParties(
  db: SupabaseClient,
  project: { id: number; client: string; builder: string; amount_wei: string | null },
  builderBps: number,
  blockchainId: bigint,
) {
  const share =
    builderBps >= 10_000
      ? 'in full to the builder'
      : builderBps <= 0
        ? 'in full to the client'
        : `${builderBps / 100}% to the builder`;

  const amount = project.amount_wei ? ` of ${formatUSDC(BigInt(project.amount_wei))}` : '';
  const message =
    `A ruling has been issued on your dispute: the escrow${amount} is awarded ${share}. ` +
    `Open the project to submit it on-chain.`;

  const rows = [project.client, project.builder].map((wallet) => ({
    wallet_address: wallet.toLowerCase(),
    message,
    type: 'DISPUTE_RESOLVED' as const,
    link: `/project/${project.id}`,
    event_key: `resolution:${blockchainId}`,
  }));

  const { error } = await db
    .from('notifications')
    .upsert(rows, { onConflict: 'event_key,wallet_address', ignoreDuplicates: true });

  if (error) {
    console.error(`[resolver] ruling notification failed for ${blockchainId}: ${error.message}`);
  }
}
