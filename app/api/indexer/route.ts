import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { runIndexerOnce } from '@/lib/indexer/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds; raise on a plan that allows it

/** Stop starting new work well before the platform kills the function. */
const BUDGET_MS = (maxDuration - 15) * 1000;

/** Reject weak secrets outright. `openssl rand -hex 32` produces 64 characters. */
const MIN_SECRET_LENGTH = 32;

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/**
 * Cron entry point for the indexer.
 *
 * This endpoint writes authoritative project state with the service role, so it is NOT
 * public. It requires INDEXER_SECRET, presented as either:
 *
 *   x-indexer-secret: <secret>          (external schedulers, curl)
 *   Authorization: Bearer <secret>      (Vercel Cron — it sends CRON_SECRET this way, so
 *                                        CRON_SECRET must be set to the SAME value)
 *
 * The secret is never accepted in the query string, where it would land in access logs.
 *
 * Overlapping runs are prevented by a database lease (migration 0004); a second concurrent
 * call returns 200 with lockedOut:true and does nothing. Replays are additionally harmless
 * because of the ordering guard in apply_project_event.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.INDEXER_SECRET;
  if (!secret) return false; // fail closed
  if (secret.length < MIN_SECRET_LENGTH) {
    // Say so in the logs; otherwise a too-short secret looks identical to a wrong one.
    console.error(`[indexer] INDEXER_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; rejecting all requests.`);
    return false;
  }

  const presented =
    req.headers.get('x-indexer-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  // Hash both sides first: timingSafeEqual needs equal-length buffers, and comparing lengths
  // directly would leak the secret's length through response timing.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(presented), digest(secret));
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const startedAt = Date.now();
  try {
    const result = await runIndexerOnce({ budgetMs: BUDGET_MS });
    return NextResponse.json(
      { ok: true, durationMs: Date.now() - startedAt, ...result },
      { headers: NO_STORE },
    );
  } catch (err) {
    // Return 500 so the scheduler's own alerting fires. The cursor was not advanced past
    // the failure, so the next run resumes from the same place.
    console.error('[indexer] run failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Indexer failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}

export const GET = handle;
export const POST = handle;
