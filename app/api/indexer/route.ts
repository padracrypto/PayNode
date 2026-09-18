import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runIndexerOnce } from '@/lib/indexer/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds; raise on a plan that allows it

/**
 * Cron entry point for the indexer.
 *
 * This endpoint writes authoritative project state with the service role, so it is NOT
 * public. It requires a shared secret, sent either as Vercel Cron's Authorization header or
 * as x-indexer-secret for other schedulers.
 *
 * Running twice concurrently is safe — the ordering guard in apply_project_event makes
 * duplicate application a no-op — but it wastes RPC quota, so prefer a single schedule.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.INDEXER_SECRET;
  if (!secret) return false; // fail closed: no secret configured means no access

  const presented =
    req.headers.get('x-indexer-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await runIndexerOnce();
    return NextResponse.json({ ok: true, durationMs: Date.now() - startedAt, ...result });
  } catch (err) {
    // Return 500 so the scheduler's own alerting fires. The cursor was not advanced past
    // the failure, so the next run resumes from the same place.
    console.error('[indexer] run failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Indexer failed' },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
