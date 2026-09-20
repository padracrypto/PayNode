#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';

// Next.js reads .env.local automatically; this standalone worker does not, so load it the
// same way scripts/check-arc-decimals.ts does.
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

/**
 * Standalone PayNode indexer daemon.
 *
 * Use this instead of the cron route when you want sub-minute latency, or when you would
 * rather not have a serverless timeout bounding a cold-start backfill. Same core logic —
 * it drives the same runIndexerOnce() the HTTP route does.
 *
 *   npm run indexer            # loop forever
 *   npm run indexer -- --once  # single pass, then exit (useful in CI or for a backfill)
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_ARC_RPC_URL,
 * NEXT_PUBLIC_ARC_CHAIN_ID, NEXT_PUBLIC_ESCROW_ADDRESS, and ideally
 * NEXT_PUBLIC_ESCROW_DEPLOY_BLOCK so a cold start does not scan from genesis.
 */

// The core is TypeScript and imports from lib/paynode.ts, so this must run under a TS
// loader. `npm run indexer` wires that up via tsx; running it with bare `node` will fail
// on the .ts import below.
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 15_000);
const ONCE = process.argv.includes('--once');

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[indexer] ${sig} received — finishing current pass, then exiting.`);
    stopping = true;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { runIndexerOnce } = await import('../lib/indexer/core.ts');

  console.log(`[indexer] starting (${ONCE ? 'single pass' : `polling every ${POLL_MS}ms`})`);

  // Back off on repeated failure rather than hammering a struggling RPC.
  let consecutiveFailures = 0;

  do {
    try {
      const r = await runIndexerOnce();
      consecutiveFailures = 0;

      if (r.lockedOut) {
        // Another run (a cron invocation, or a second daemon) holds the lease. Not an error.
        console.log('[indexer] another run holds the lease — skipping this pass.');
      } else if (r.logsSeen > 0 || r.tipsVerified > 0 || !r.caughtUp) {
        console.log(
          `[indexer] ${r.fromBlock}→${r.toBlock} | logs ${r.logsSeen} | applied ${r.eventsApplied} | ` +
            `skipped ${r.eventsSkipped} | deferred ${r.deferredRecorded} | ` +
            `notified ${r.notificationsCreated}${r.notificationsFailed ? ` (FAILED ${r.notificationsFailed})` : ''} | ` +
            `tips ${r.tipsVerified}` +
            (r.caughtUp ? '' : ' | MORE PENDING'),
        );
      }

      // While backfilling, do not wait — keep pulling until caught up.
      if (!ONCE && !r.caughtUp) continue;
    } catch (err) {
      consecutiveFailures++;
      const backoff = Math.min(POLL_MS * 2 ** Math.min(consecutiveFailures, 5), 5 * 60_000);
      console.error(`[indexer] pass failed (${consecutiveFailures}):`, err?.message ?? err);
      console.error(`[indexer] retrying in ${Math.round(backoff / 1000)}s. Cursor was not advanced.`);
      if (!ONCE) await sleep(backoff);
    }

    if (ONCE) break;
    await sleep(POLL_MS);
  } while (!stopping);

  console.log('[indexer] stopped.');
}

main().catch((err) => {
  console.error('[indexer] fatal:', err);
  process.exit(1);
});
