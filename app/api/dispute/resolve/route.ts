import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { serviceClient } from '@/lib/indexer/core';
import { resolveDispute, type ResolveOutcome } from '@/lib/resolver/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // seconds; arbitration at high effort is not a fast call

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/** Reject weak secrets outright. `openssl rand -hex 32` produces 64 characters. */
const MIN_SECRET_LENGTH = 32;

/**
 * POST /api/dispute/resolve  — issue an autonomous resolver ruling.
 *
 * Body: { "projectId": <on-chain project id> }
 *
 * WHO MAY CALL THIS. Not the parties. This endpoint signs with a key that moves escrow, and
 * a dispute's outcome is exactly the thing both parties have an incentive to influence, so
 * the trigger is an operator/cron concern rather than a user action. Authentication is the
 * same shared-secret scheme as /api/indexer:
 *
 *   x-resolver-secret: <secret>       (external schedulers, curl)
 *   Authorization: Bearer <secret>    (Vercel Cron sends CRON_SECRET this way)
 *
 * Never accepted in the query string, where it would land in access logs.
 *
 * Parties read the resulting ruling through their SIWE session — RLS on dispute_resolutions
 * (migration 0010) exposes a `signed` row to the project's client, builder and arbitrator,
 * and to nobody else. They then relay it themselves; the contract accepts the attestation
 * from any address.
 *
 * IDEMPOTENT. Calling twice for the same project returns the same signature, not a second
 * ruling. See the header of lib/resolver/pipeline.ts for why that is a security property and
 * not a convenience.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.RESOLVER_SECRET;
  if (!secret) return false; // fail closed
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(
      `[resolver] RESOLVER_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; rejecting all requests.`,
    );
    return false;
  }

  const presented =
    req.headers.get('x-resolver-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  // Hash both sides first: timingSafeEqual needs equal-length buffers, and comparing lengths
  // directly would leak the secret's length through response timing.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(presented), digest(secret));
}

/** Ineligibility maps to a status the caller can act on without parsing prose. */
const INELIGIBLE_STATUS: Record<string, number> = {
  unknown_project: 404,
  not_disputed: 409,
  arbitrator_assigned: 409,
  resolver_disabled: 409,
  epoch_mismatch: 409,
};

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let projectId: bigint;
  try {
    const body = (await req.json()) as { projectId?: unknown };
    // Accept a number or a string; reject anything that is not a non-negative integer. This
    // value ends up inside a signed digest, so a silent coercion here is a signed lie.
    const raw = body.projectId;
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      throw new Error('projectId must be a number or a numeric string');
    }
    if (typeof raw === 'number' && !Number.isSafeInteger(raw)) {
      throw new Error('projectId is not a safe integer');
    }
    projectId = BigInt(raw);
    if (projectId < 0n) throw new Error('projectId must be non-negative');
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid body: ${err instanceof Error ? err.message : 'expected { projectId }'}` },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const outcome = await resolveDispute(serviceClient(), projectId);
    return respond(outcome);
  } catch (err) {
    // 500 so a scheduler's alerting fires. The pipeline released its claim on the way out for
    // anything transient, so the next run retries from a clean slate.
    console.error(`[resolver] arbitration of project ${projectId} failed:`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Arbitration failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}

function respond(outcome: ResolveOutcome) {
  switch (outcome.kind) {
    case 'signed':
      return NextResponse.json(
        {
          ok: true,
          replayed: outcome.replayed,
          projectId: outcome.submission.args[0],
          builderBps: outcome.record.builder_bps,
          reasoning: outcome.record.reasoning,
          analysis: outcome.record.analysis,
          attestation: {
            deadline: outcome.record.attestation_deadline,
            signature: outcome.record.signature,
            signer: outcome.record.signer,
            resolverEpoch: outcome.record.resolver_epoch,
          },
          // Everything needed to relay the ruling. Any address may submit it.
          submission: outcome.submission,
        },
        { status: 200, headers: NO_STORE },
      );

    case 'pending':
      // Another request is mid-arbitration. 202 rather than 409: the work is happening, the
      // caller should come back, and a scheduler should not treat it as an error.
      return NextResponse.json(
        { ok: true, status: 'pending', message: 'Arbitration is already in progress.' },
        { status: 202, headers: NO_STORE },
      );

    case 'failed':
      return NextResponse.json(
        {
          ok: false,
          status: 'failed',
          replayed: outcome.replayed,
          error: outcome.record.error,
          message:
            'The resolver declined to rule on this dispute. It remains open to mutual ' +
            'settlement, or to forceResolveStaleDispute after 30 days.',
        },
        { status: 422, headers: NO_STORE },
      );

    case 'ineligible':
      return NextResponse.json(
        { ok: false, status: 'ineligible', reason: outcome.reason, message: outcome.message },
        { status: INELIGIBLE_STATUS[outcome.reason] ?? 409, headers: NO_STORE },
      );
  }
}
