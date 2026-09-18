import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createPublicClient, decodeEventLog, http, fallback, type Log } from 'viem';
import { arc, ARC_RPC_URLS, ESCROW_ADDRESS, PAYNODE_ESCROW_ABI } from '../paynode';

/**
 * PayNode event indexer.
 *
 * Migration 0001 revoked the UPDATE grant on projects.status from browser sessions, so this
 * is now the ONLY writer of authoritative project state. It reads confirmed logs from
 * PayNodeEscrowV2 and applies them through the apply_project_event RPC, which enforces the
 * (block, log_index) ordering guard described in supabase/migrations/0002_indexer.sql.
 *
 * DESIGN NOTES
 * ------------
 * Confirmations — logs are only read up to `head - CONFIRMATIONS`. A reorg that unwinds a
 * block we already applied would otherwise leave a project permanently marked Completed
 * against a transaction that no longer exists.
 *
 * Idempotency — the cursor advances only after an entire range is applied. A crash
 * mid-range replays that range on the next pass, which is harmless because every write goes
 * through the ordering guard. This is deliberately "at least once", not "exactly once":
 * the database enforces correctness, not the worker's bookkeeping.
 *
 * Ranges — getLogs is chunked, because public RPCs cap block spans and a cold start may
 * need to cover the entire deployment history.
 */

// -------------------------------------------------------------------------------------
// CONFIG
// -------------------------------------------------------------------------------------

/** Blocks to stay behind head. Raise on a chain with deeper reorgs. */
const CONFIRMATIONS = BigInt(process.env.INDEXER_CONFIRMATIONS ?? 5);

/** Max span per getLogs call. Most public RPCs reject more than a few thousand. */
const MAX_RANGE = BigInt(process.env.INDEXER_MAX_RANGE ?? 2_000);

/** Highest number of blocks to cover in one invocation, so a cron run stays bounded. */
const MAX_BLOCKS_PER_RUN = BigInt(process.env.INDEXER_MAX_BLOCKS_PER_RUN ?? 20_000);

/** Block the escrow was deployed in. Starting from 0 wastes a very long cold start. */
const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_ESCROW_DEPLOY_BLOCK ?? 0);

const STREAM_ID = 'escrow';

/** DB status strings. These are the values the UI reads; keep them stable. */
const Status = {
  AwaitingFunds: 'AwaitingFunds',
  Funded: 'Funded',
  Revision: 'Revision',
  Delivered: 'Delivered',
  Disputed: 'Disputed',
  Completed: 'Completed',
  Refunded: 'Refunded',
  Cancelled: 'Cancelled',
} as const;

// -------------------------------------------------------------------------------------
// CLIENTS
// -------------------------------------------------------------------------------------

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('[indexer] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
  // The service role bypasses RLS entirely. This key must never reach a browser.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const chainClient = createPublicClient({
  chain: arc,
  transport: fallback(ARC_RPC_URLS.map((u) => http(u))),
});

const ts = (seconds: bigint | number) => new Date(Number(seconds) * 1000).toISOString();

// -------------------------------------------------------------------------------------
// EVENT -> DATABASE MAPPING
// -------------------------------------------------------------------------------------

type Applied = { status: string | null; fields: Record<string, unknown> };

/**
 * Translate one decoded log into a status transition plus column updates.
 *
 * Returns `null` for logs that are not project-scoped (handled separately).
 *
 * NOTE ON EVENT NAMES: PayNodeEscrowV2 emits `FundsLocked`, not `ProjectFunded`, and has no
 * `StaleDisputeResolved` — a timeout settlement is a `DisputeResolved` with
 * `resolutionPath === 3`. Those two are the only names that differ from the usual guess.
 */
function mapEvent(eventName: string, args: Record<string, unknown>, txHash: string): Applied | null {
  switch (eventName) {
    case 'ProjectCreated':
      return {
        status: Status.AwaitingFunds,
        fields: {
          amount_wei: String(args.amount),
          deadline: ts(args.deadline as bigint),
          arbitrator:
            args.arbitrator && args.arbitrator !== '0x0000000000000000000000000000000000000000'
              ? String(args.arbitrator).toLowerCase()
              : null,
          tx_hash: txHash,
        },
      };

    case 'FundsLocked':
      return { status: Status.Funded, fields: { funded_at: new Date().toISOString(), amount_wei: String(args.amount) } };

    case 'WorkDelivered':
      // Authoritative delivery time. The app previously wrote this from the CLIENT'S clock,
      // then gated the 7-day claim on it — a skewed clock showed "Claim Now" on a tx that
      // reverts. This value is the one the contract itself will compare against.
      return { status: Status.Delivered, fields: { delivered_at: ts(args.deliveredAt as bigint) } };

    case 'RevisionRequested':
      // Legal backwards transition: Delivered -> Revision. The ordering guard permits it;
      // a rank-based "forward only" guard would have silently dropped it.
      return { status: Status.Revision, fields: { deadline: ts(args.newDeadline as bigint) } };

    case 'FundsReleased':
      return { status: Status.Completed, fields: { settled_at: new Date().toISOString() } };

    case 'ProjectRefunded':
      return { status: Status.Refunded, fields: { settled_at: new Date().toISOString() } };

    case 'ProjectCancelled':
      return { status: Status.Cancelled, fields: {} };

    case 'DisputeRaised':
      return { status: Status.Disputed, fields: { disputed_at: ts(args.raisedAt as bigint) } };

    case 'DisputeResolved': {
      // Emitted FIRST in _settle, before FundsReleased / ProjectRefunded. Because it carries
      // the authoritative split, setting the terminal status here means the payout logs that
      // follow in the same transaction hit the terminal guard and are ignored — which is how
      // a 50/50 settlement is recorded as Completed rather than as whichever log came last.
      const bps = Number(args.builderBps ?? 0);
      return {
        status: bps > 0 ? Status.Completed : Status.Refunded,
        fields: {
          settled_at: new Date().toISOString(),
          resolution_path: Number(args.resolutionPath ?? 0),
          resolution_builder_bps: bps,
        },
      };
    }

    default:
      return null;
  }
}

const PROJECT_EVENTS = [
  'ProjectCreated',
  'FundsLocked',
  'WorkDelivered',
  'RevisionRequested',
  'FundsReleased',
  'ProjectRefunded',
  'ProjectCancelled',
  'DisputeRaised',
  'DisputeResolved',
] as const;

// -------------------------------------------------------------------------------------
// MAIN PASS
// -------------------------------------------------------------------------------------

export type IndexerResult = {
  fromBlock: string;
  toBlock: string;
  logsSeen: number;
  eventsApplied: number;
  eventsSkipped: number;
  deferredRecorded: number;
  tipsVerified: number;
  caughtUp: boolean;
};

export async function runIndexerOnce(): Promise<IndexerResult> {
  const db = serviceClient();

  const { data: state, error: stateErr } = await db
    .from('indexer_state')
    .select('last_indexed_block')
    .eq('id', STREAM_ID)
    .single();
  if (stateErr) throw new Error(`[indexer] cannot read cursor: ${stateErr.message}`);

  const head = await chainClient.getBlockNumber();
  const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;

  const cursor = BigInt(state?.last_indexed_block ?? 0);
  let fromBlock = cursor > 0n ? cursor + 1n : DEPLOY_BLOCK;
  if (fromBlock > safeHead) {
    return {
      fromBlock: fromBlock.toString(),
      toBlock: safeHead.toString(),
      logsSeen: 0,
      eventsApplied: 0,
      eventsSkipped: 0,
      deferredRecorded: 0,
      tipsVerified: 0,
      caughtUp: true,
    };
  }

  const ceiling = safeHead - fromBlock > MAX_BLOCKS_PER_RUN ? fromBlock + MAX_BLOCKS_PER_RUN : safeHead;

  let logsSeen = 0;
  let applied = 0;
  let skipped = 0;
  let deferred = 0;
  let highestDone = cursor;

  for (let start = fromBlock; start <= ceiling; start += MAX_RANGE) {
    const end = start + MAX_RANGE - 1n > ceiling ? ceiling : start + MAX_RANGE - 1n;

    const logs = await chainClient.getLogs({
      address: ESCROW_ADDRESS,
      fromBlock: start,
      toBlock: end,
    });
    logsSeen += logs.length;

    // Chain order is the only correct application order.
    const ordered = [...logs].sort((a, b) => {
      const bd = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
      return bd !== 0 ? bd : (a.logIndex ?? 0) - (b.logIndex ?? 0);
    });

    for (const log of ordered) {
      const decoded = decodeSafely(log);
      if (!decoded) continue;

      const { eventName, args } = decoded;

      if (eventName === 'PaymentDeferred') {
        // A push payout failed and the contract credited withdrawable[]. Nobody finds that
        // money unless we surface it, so it gets its own table with a (tx, log) unique key.
        const { error } = await db.from('deferred_payments').upsert(
          {
            wallet_address: String(args.to).toLowerCase(),
            amount_wei: String(args.amount),
            tx_hash: log.transactionHash!,
            block_number: Number(log.blockNumber),
            log_index: log.logIndex!,
          },
          { onConflict: 'tx_hash,log_index', ignoreDuplicates: true },
        );
        if (!error) deferred++;
        continue;
      }

      if (!(PROJECT_EVENTS as readonly string[]).includes(eventName)) continue;

      const mapped = mapEvent(eventName, args, log.transactionHash ?? '');
      if (!mapped) continue;

      const { data: ok, error } = await db.rpc('apply_project_event', {
        p_blockchain_id: Number(args.projectId),
        p_block: Number(log.blockNumber),
        p_log_index: log.logIndex,
        p_status: mapped.status,
        p_fields: mapped.fields,
      });

      if (error) {
        // Abort the whole pass without advancing the cursor. Re-running replays this range,
        // which the ordering guard makes safe. Advancing past a failed write would silently
        // lose the event forever.
        throw new Error(`[indexer] apply_project_event failed at ${log.blockNumber}/${log.logIndex}: ${error.message}`);
      }

      if (ok) applied++;
      else skipped++;
    }

    highestDone = end;

    const { error: cursorErr } = await db
      .from('indexer_state')
      .update({ last_indexed_block: Number(highestDone), updated_at: new Date().toISOString() })
      .eq('id', STREAM_ID);
    if (cursorErr) throw new Error(`[indexer] cannot advance cursor: ${cursorErr.message}`);
  }

  const tipsVerified = await verifyPendingTips(db, safeHead);

  return {
    fromBlock: fromBlock.toString(),
    toBlock: highestDone.toString(),
    logsSeen,
    eventsApplied: applied,
    eventsSkipped: skipped,
    deferredRecorded: deferred,
    tipsVerified,
    caughtUp: highestDone >= safeHead,
  };
}

function decodeSafely(log: Log): { eventName: string; args: Record<string, unknown> } | null {
  try {
    // Decode defensively: a contract upgrade, or any log whose topic0 is not in our ABI,
    // would otherwise throw and abort the whole pass.
    const d = decodeEventLog({ abi: PAYNODE_ESCROW_ABI, data: log.data, topics: log.topics });
    return { eventName: d.eventName as string, args: (d.args ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------------------
// TIP VERIFICATION
// -------------------------------------------------------------------------------------

/**
 * Confirm self-reported tips against the chain.
 *
 * A tip is a plain native transfer to an EOA, which emits NO LOG — there is no Transfer
 * event to watch for, so getLogs cannot see it. The only way to verify one is to fetch the
 * transaction the sender claimed and check it actually does what they said.
 *
 * The amount is taken FROM THE TRANSACTION, never from the row. tips.amount is a
 * sender-supplied float; tips.amount_wei is what really moved.
 */
async function verifyPendingTips(db: SupabaseClient, safeHead: bigint): Promise<number> {
  const { data: pending, error } = await db
    .from('tips')
    .select('id, sender_wallet, receiver_wallet, tx_hash')
    .eq('verified', false)
    .not('tx_hash', 'is', null)
    .limit(50);

  if (error || !pending?.length) return 0;

  let verified = 0;

  for (const tip of pending) {
    try {
      const receipt = await chainClient.getTransactionReceipt({ hash: tip.tx_hash as `0x${string}` });
      if (receipt.status !== 'success') continue;
      if (receipt.blockNumber > safeHead) continue; // not yet deep enough to trust

      const tx = await chainClient.getTransaction({ hash: tip.tx_hash as `0x${string}` });

      const toMatches = tx.to?.toLowerCase() === String(tip.receiver_wallet).toLowerCase();
      const fromMatches = tx.from.toLowerCase() === String(tip.sender_wallet).toLowerCase();

      // A claimed tip whose transaction paid someone else is not a tip.
      if (!toMatches || !fromMatches || tx.value === 0n) continue;

      await db
        .from('tips')
        .update({
          verified: true,
          verified_at: new Date().toISOString(),
          amount_wei: tx.value.toString(),
          block_number: Number(receipt.blockNumber),
        })
        .eq('id', tip.id);

      verified++;
    } catch {
      // Unknown hash, dropped transaction, or RPC blip. Leave it unverified and retry later.
    }
  }

  return verified;
}
