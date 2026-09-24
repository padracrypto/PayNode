import { randomUUID } from 'node:crypto';
import { createClient, type RealtimeClientOptions, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { createPublicClient, decodeEventLog, http, fallback, type Log } from 'viem';
import { arc, ARC_RPC_URLS, ESCROW_ADDRESS, PAYNODE_ESCROW_ABI } from '../paynode';
import { notifyDisputeEvent, notifyVerifiedTip, type DisputeEventName } from './notify';

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

/**
 * Lease length for the run lock (migration 0004). Must exceed the route's maxDuration, so a
 * function killed mid-run has its lease expire rather than block the schedule indefinitely.
 * Every cursor advance renews it, so a healthy long backfill never loses it.
 */
const LOCK_TTL_SECONDS = 75;

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
  //
  // This client never opens a realtime channel, but supabase-js's constructor still probes
  // for a global WebSocket and throws immediately on Node < 22 if it can't find one. `ws`
  // supplies that constructor so createClient() doesn't hard-fail on older Node runtimes.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as RealtimeClientOptions['transport'] },
  });
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
  /** Notifications newly written for dispute events. A replayed event contributes 0. */
  notificationsCreated: number;
  /** Dispute events whose notifications could not be written. Logged, never fatal. */
  notificationsFailed: number;
  tipsVerified: number;
  caughtUp: boolean;
  /** True when another run held the lease, so this invocation did nothing. Not an error. */
  lockedOut: boolean;
};

export type IndexerOptions = {
  /** Stop starting new work after this many ms. The cursor is saved per range, so stopping
   *  early is safe — the next run resumes exactly where this one left off. */
  budgetMs?: number;
};

const emptyResult = (over: Partial<IndexerResult> = {}): IndexerResult => ({
  fromBlock: '0',
  toBlock: '0',
  logsSeen: 0,
  eventsApplied: 0,
  eventsSkipped: 0,
  deferredRecorded: 0,
  notificationsCreated: 0,
  notificationsFailed: 0,
  tipsVerified: 0,
  caughtUp: true,
  lockedOut: false,
  ...over,
});

/**
 * One indexer pass, guarded by a lease so overlapping invocations cannot both run.
 *
 * Vercel cron delivery is best-effort and can fire the same schedule twice, and a run that
 * outlives its interval overlaps the next one. Without the lease, both would fetch and
 * re-apply the same blocks, and a slow run could write an older cursor over a newer one.
 */
export async function runIndexerOnce(opts: IndexerOptions = {}): Promise<IndexerResult> {
  const db = serviceClient();
  const owner = randomUUID();
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;

  const { data: acquired, error: lockErr } = await db.rpc('acquire_indexer_lock', {
    p_id: STREAM_ID,
    p_owner: owner,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });
  // Fail loudly rather than silently run unlocked if migration 0004 is missing.
  if (lockErr) {
    throw new Error(`[indexer] cannot acquire lock (has migration 0004 been applied?): ${lockErr.message}`);
  }
  if (!acquired) return emptyResult({ lockedOut: true });

  try {
    return await runLocked(db, owner, deadline);
  } finally {
    try {
      await db.rpc('release_indexer_lock', { p_id: STREAM_ID, p_owner: owner });
    } catch {
      // A failed release only means the lease runs out on its own.
    }
  }
}

async function runLocked(db: SupabaseClient, owner: string, deadline: number): Promise<IndexerResult> {
  // Read the cursor only AFTER the lease is held; reading it first would let two runs start
  // from the same value.
  const { data: state, error: stateErr } = await db
    .from('indexer_state')
    .select('last_indexed_block')
    .eq('id', STREAM_ID)
    .single();
  if (stateErr) throw new Error(`[indexer] cannot read cursor: ${stateErr.message}`);

  const head = await chainClient.getBlockNumber();
  const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;

  const cursor = BigInt(state?.last_indexed_block ?? 0);
  const fromBlock = cursor > 0n ? cursor + 1n : DEPLOY_BLOCK;
  if (fromBlock > safeHead) {
    // Nothing new to read, but tips are verified by tx hash and need no logs.
    const tipsVerified = await verifyPendingTips(db, safeHead, deadline);
    return emptyResult({ fromBlock: fromBlock.toString(), toBlock: safeHead.toString(), tipsVerified });
  }

  const ceiling = safeHead - fromBlock > MAX_BLOCKS_PER_RUN ? fromBlock + MAX_BLOCKS_PER_RUN : safeHead;

  let logsSeen = 0;
  let applied = 0;
  let skipped = 0;
  let deferred = 0;
  let notified = 0;
  let notifyFailed = 0;
  let highestDone = cursor;

  for (let start = fromBlock; start <= ceiling; start += MAX_RANGE) {
    // Out of time budget: stop cleanly. Ranges completed so far are already saved.
    if (Date.now() > deadline) break;

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
        // Throw, don't swallow: the cursor advances past this range once the pass completes,
        // so a dropped write here would lose the record of a user's claimable funds for good.
        if (error) {
          throw new Error(`[indexer] deferred_payments upsert failed at ${log.blockNumber}/${log.logIndex}: ${error.message}`);
        }
        deferred++;
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

      // Runs whether or not the status write was applied: the (tx, log, wallet) key makes a
      // replay a no-op, and it lets a replay repair a notification that failed the first time.
      //
      // Best-effort on purpose. Unlike the writes above, a failure here must NOT abort the
      // pass: the cursor would never advance, and one bad notification would freeze project
      // status sync for every user. It is logged and counted in the result instead.
      if (eventName === 'DisputeRaised' || eventName === 'DisputeResolved') {
        try {
          notified += await notifyDisputeEvent(
            db,
            eventName as DisputeEventName,
            args,
            `${log.transactionHash}:${log.logIndex}`,
          );
        } catch (err) {
          notifyFailed++;
          console.error(
            `[indexer] notification failed for ${eventName} at ${log.blockNumber}/${log.logIndex}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    highestDone = end;

    // Advance AND renew the lease in one atomic call. The database only moves the cursor
    // forward, and only for the current lease holder.
    const { data: advanced, error: cursorErr } = await db.rpc('advance_indexer_cursor', {
      p_id: STREAM_ID,
      p_owner: owner,
      p_block: Number(highestDone),
      p_ttl_seconds: LOCK_TTL_SECONDS,
    });
    if (cursorErr) throw new Error(`[indexer] cannot advance cursor: ${cursorErr.message}`);
    if (!advanced) {
      // The lease expired and another run took over. Stop at once; carrying on would apply
      // logs concurrently with the run that replaced us.
      throw new Error('[indexer] lost the run lease mid-pass; aborting so the new holder continues.');
    }
  }

  const tipsVerified = await verifyPendingTips(db, safeHead, deadline);

  return {
    fromBlock: fromBlock.toString(),
    toBlock: highestDone.toString(),
    logsSeen,
    eventsApplied: applied,
    eventsSkipped: skipped,
    deferredRecorded: deferred,
    notificationsCreated: notified,
    notificationsFailed: notifyFailed,
    tipsVerified,
    caughtUp: highestDone >= safeHead,
    lockedOut: false,
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
async function verifyPendingTips(db: SupabaseClient, safeHead: bigint, deadline: number): Promise<number> {
  // Never-attempted rows first, then least-recently-attempted. Any signed-in wallet can insert
  // tips with junk tx hashes; an unordered LIMIT would let 50 unverifiable rows starve every
  // real tip forever. Needs migration 0004's last_verify_attempt_at column.
  const { data: pending, error } = await db
    .from('tips')
    .select('id, sender_wallet, receiver_wallet, tx_hash')
    .eq('verified', false)
    .not('tx_hash', 'is', null)
    .order('last_verify_attempt_at', { ascending: true, nullsFirst: true })
    .limit(50);

  if (error) {
    console.error('[indexer] cannot read pending tips:', error.message);
    return 0;
  }
  if (!pending?.length) return 0;

  let verified = 0;
  const attempted: (string | number)[] = [];

  for (const tip of pending) {
    if (Date.now() > deadline) break;
    attempted.push(tip.id);

    try {
      const receipt = await chainClient.getTransactionReceipt({ hash: tip.tx_hash as `0x${string}` });
      if (receipt.status !== 'success') continue;
      if (receipt.blockNumber > safeHead) continue; // not yet deep enough to trust

      const tx = await chainClient.getTransaction({ hash: tip.tx_hash as `0x${string}` });

      const toMatches = tx.to?.toLowerCase() === String(tip.receiver_wallet).toLowerCase();
      const fromMatches = tx.from.toLowerCase() === String(tip.sender_wallet).toLowerCase();

      // A claimed tip whose transaction paid someone else is not a tip.
      if (!toMatches || !fromMatches || tx.value === 0n) continue;

      // Only promote a row that is still unverified. Two overlapping runs would otherwise
      // both "succeed" here and both go on to notify — harmless for the row, but the
      // notification count would double-report work only one of them really did.
      const { data: promoted, error: upErr } = await db
        .from('tips')
        .update({
          verified: true,
          verified_at: new Date().toISOString(),
          amount_wei: tx.value.toString(),
          block_number: Number(receipt.blockNumber),
        })
        .eq('id', tip.id)
        .eq('verified', false)
        .select('id');

      if (upErr || !promoted?.length) continue;
      verified++;

      // Tell the recipient. The tip page cannot: RLS only lets a browser notify someone it
      // shares a project with, so its insert was rejected for every tip ever sent. Only now
      // is the transfer known to be real, which is the right moment to say so anyway.
      //
      // Best-effort, exactly like the dispute path: the row is already correct, and a failed
      // notification must not stop the remaining tips in this batch from being verified.
      try {
        await notifyVerifiedTip(db, {
          sender_wallet: String(tip.sender_wallet),
          receiver_wallet: String(tip.receiver_wallet),
          tx_hash: String(tip.tx_hash),
          amount_wei: tx.value,
        });
      } catch (err) {
        console.error(
          `[indexer] tip verified but notification failed for ${tip.tx_hash}:`,
          err instanceof Error ? err.message : err,
        );
      }
    } catch {
      // Unknown hash, dropped transaction, or RPC blip. Leave it unverified and retry later.
    }
  }

  // Stamp every row we tried so it goes to the back of the queue behind untried ones.
  if (attempted.length) {
    const { error: stampErr } = await db
      .from('tips')
      .update({ last_verify_attempt_at: new Date().toISOString() })
      .in('id', attempted);
    if (stampErr) console.error('[indexer] cannot stamp tip attempts:', stampErr.message);
  }

  return verified;
}
