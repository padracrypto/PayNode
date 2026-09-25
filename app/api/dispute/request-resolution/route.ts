import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/indexer/core';
import { SESSION_COOKIE, readSessionToken } from '@/lib/siwe-server';
import { Ineligible, loadProjectRow, preflight } from '@/lib/resolver/evidence';
import { resolveDispute } from '@/lib/resolver/pipeline';
import { DEFAULT_EVIDENCE_WINDOW_SECONDS, type ResolveRequestResponse } from '@/lib/dispute/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Arbitration at high thinking effort is not a fast call. Same budget as the operator route. */
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

const json = (body: ResolveRequestResponse, status: number) =>
  NextResponse.json(body, { status, headers: NO_STORE });

/**
 * POST /api/dispute/request-resolution — a PARTY asks for a ruling.
 *
 * Body: { "projectId": "<on-chain project id>" }
 *
 * WHY THIS EXISTS SEPARATELY FROM /api/dispute/resolve.
 *
 * That route authenticates with RESOLVER_SECRET and its header is explicit: "WHO MAY CALL
 * THIS. Not the parties." That judgement is right and this route does not weaken it. The
 * secret authorises a signature that moves escrow, so a browser holding it could re-trigger
 * arbitration until it produced a friendlier split — the precise attack the claim-first insert
 * in lib/resolver/pipeline.ts was built to defeat. It must stay a server-side operator
 * credential.
 *
 * But a party still needs a way to ask. Without one, a dispute in a project with no designated
 * arbitrator sits frozen until an operator notices or the 30-day breaker fires, and the
 * autonomous path might as well not exist from the user's side. So this route is the front
 * door: no shared secret, a SIWE session instead, three gates, and then the same
 * `resolveDispute()` call in-process.
 *
 * WHAT MAKES IT SAFE TO EXPOSE.
 *
 *   1. IDENTITY. The SIWE session cookie, verified with SUPABASE_JWT_SECRET. A wallet claim
 *      here was signed for; `useAccount().address` is not evidence of anything.
 *   2. STANDING. The caller must be the client or the builder of THIS project, checked against
 *      the service-role read of the project row. A designated arbitrator is deliberately not
 *      admitted: PATH 1 and PATH 2 are mutually exclusive and `preflight` refuses anyway.
 *   3. FAIRNESS. An evidence window, so the party who files first cannot have a one-shot,
 *      unappealable ruling issued before the other side has answered.
 *
 * And the guarantee that does the real work is not in this file: the unique index on
 * `dispute_resolutions.blockchain_id` means the FIRST request claims the project's one ruling
 * slot and every later one is served that same stored signature. A party who calls this a
 * hundred times gets one ruling, a hundred times. Rate limiting here would be politeness; the
 * ledger is the control.
 */
export async function POST(req: NextRequest) {
  /* ---- 1. Identity. ---- */
  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return json(
      {
        ok: false,
        status: 'forbidden',
        message: 'Sign in with your wallet to request a ruling.',
      },
      401,
    );
  }

  /* ---- 2. Input. ---- */
  let projectId: bigint;
  try {
    const body = (await req.json()) as { projectId?: unknown };
    const raw = body.projectId;
    // Same strictness as the operator route: this value ends up inside a signed digest, so a
    // silent coercion here is a signed lie. A float, a non-numeric string or a negative is
    // rejected rather than rounded.
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      throw new Error('projectId must be a number or a numeric string');
    }
    if (typeof raw === 'number' && !Number.isSafeInteger(raw)) {
      throw new Error('projectId is not a safe integer');
    }
    projectId = BigInt(raw);
    if (projectId < 0n) throw new Error('projectId must be non-negative');
  } catch {
    return json(
      { ok: false, status: 'error', message: 'That project reference was not valid.' },
      400,
    );
  }

  const db = serviceClient();

  try {
    /* ---- 3. Standing. ---- */
    //
    // Read with the service role, then compare in this process. Doing the membership check
    // here rather than leaning on RLS is deliberate: the pipeline below runs as the service
    // role and bypasses RLS entirely, so if this route did not check, nothing downstream
    // would.
    let project: Awaited<ReturnType<typeof loadProjectRow>>;
    try {
      project = await loadProjectRow(db, projectId);
    } catch (err) {
      if (err instanceof Ineligible) {
        // `unknown_project` from here means the escrow may exist on-chain but has no off-chain
        // record, so there is nothing to arbitrate. Returned as ineligible rather than 404 so
        // the caller renders the pipeline's own explanation.
        return json(
          { ok: false, status: 'ineligible', reason: err.reason, message: err.message },
          404,
        );
      }
      throw err;
    }

    const wallet = session.wallet; // already lowercased by readSessionToken
    const isParty =
      wallet === project.client.toLowerCase() || wallet === project.builder.toLowerCase();

    if (!isParty) {
      // Same copy whether the project is missing or simply not theirs — a non-party learns
      // nothing about which.
      return json(
        {
          ok: false,
          status: 'forbidden',
          message: 'Only the client or the builder of this project can request a ruling.',
        },
        403,
      );
    }

    /* ---- 4. Eligibility, from the chain. ---- */
    //
    // `preflight` is the same check the pipeline runs, and running it here too costs a handful
    // of eth_calls on a path that is hit rarely. The reason to duplicate it is the error
    // surface: called here, an ineligible project produces a specific sentence for the party
    // ("this project named an arbitrator", "automatic resolution is off for this epoch")
    // instead of a generic failure after the pipeline has already started.
    let onChain: Awaited<ReturnType<typeof preflight>>;
    try {
      onChain = await preflight(projectId);
    } catch (err) {
      if (err instanceof Ineligible) {
        return json(
          { ok: false, status: 'ineligible', reason: err.reason, message: err.message },
          409,
        );
      }
      throw err;
    }

    /* ---- 5. Fairness: has the other side had its turn? ---- */
    const gate = await evidenceWindow(db, project.id, onChain);
    if (!gate.open) {
      return json(
        {
          ok: false,
          status: 'too_early',
          message: gate.message,
          retryAfterSeconds: gate.retryAfterSeconds,
        },
        429,
      );
    }

    /* ---- 6. Rule. ---- */
    const outcome = await resolveDispute(db, projectId);

    switch (outcome.kind) {
      case 'signed':
        // Deliberately NOT returning the signature. The party reads the attestation from
        // `dispute_resolutions` through their own RLS-filtered session, which is the one copy
        // whose visibility is enforced by the database rather than by this handler getting an
        // `if` right. All this response carries is "go look".
        return json(
          {
            ok: true,
            status: 'signed',
            replayed: outcome.replayed,
            builderBps: outcome.record.builder_bps ?? 0,
          },
          200,
        );

      case 'pending':
        // Another request is mid-arbitration — possibly the operator cron, possibly the
        // counterparty. 202: the work is happening, come back. The party cannot see this row
        // (RLS hides `pending`), so this response is their only signal that it exists.
        return json(
          {
            ok: true,
            status: 'pending',
            message:
              'A ruling is being prepared. This usually takes under two minutes — this page ' +
              'will update on its own.',
          },
          202,
        );

      case 'failed':
        return json(
          {
            ok: false,
            status: 'failed',
            message:
              'The resolver declined to rule on this dispute. It stays open to a mutual ' +
              'settlement, or to the 30-day timeout.',
          },
          422,
        );

      case 'ineligible':
        return json(
          { ok: false, status: 'ineligible', reason: outcome.reason, message: outcome.message },
          409,
        );
    }
  } catch (err) {
    // The pipeline released its claim on the way out for anything transient, so a retry starts
    // from a clean slate. The detail stays in the log: it can name the resolver address, the
    // epoch and the contract, none of which belongs in a party's browser.
    console.error(`[dispute] resolution request for project ${projectId} failed:`, err);
    return json(
      {
        ok: false,
        status: 'error',
        message: 'Something went wrong preparing the ruling. Please try again in a few minutes.',
      },
      500,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                              THE EVIDENCE WINDOW                           */
/* -------------------------------------------------------------------------- */

/**
 * How long after `raiseDispute` a party must wait before a ruling can be requested.
 *
 * A ruling is one-shot, automatic and unappealable. Without a wait, whoever raises the dispute
 * could file their statement and immediately request arbitration, and the case would be decided
 * on a record containing one side only. The resolver handles that gracefully — its standard says
 * "a party who filed no statement has not thereby lost" — but gracefully is not the same as
 * fairly, and the losing party would be right to say they were never heard.
 *
 * Overridable for testing and for operators who want a different policy. Zero disables the wait.
 */
const EVIDENCE_WINDOW_SECONDS = (() => {
  const raw = process.env.DISPUTE_EVIDENCE_WINDOW_SECONDS;
  if (raw === undefined) return DEFAULT_EVIDENCE_WINDOW_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `[dispute] DISPUTE_EVIDENCE_WINDOW_SECONDS must be a non-negative number; got "${raw}".`,
    );
  }
  return n;
})();

type WindowVerdict =
  | { open: true }
  | { open: false; message: string; retryAfterSeconds: number };

/**
 * Open the gate when BOTH sides have filed, or when the window has elapsed.
 *
 * The both-filed shortcut is what keeps this from being pure friction. Once each party has put
 * a statement on the record there is nothing left to wait for, and making them sit out three
 * more days helps nobody — the escrow is frozen the whole time.
 *
 * Timed against CHAIN time, not `Date.now()`: `stateTimestamp` is a block timestamp, and the
 * page's countdown is derived from the same clock. Mixing the two would have the UI say the
 * window is closed while this check still says it is open.
 */
async function evidenceWindow(
  db: ReturnType<typeof serviceClient>,
  projectRowId: number,
  chain: Awaited<ReturnType<typeof preflight>>,
): Promise<WindowVerdict> {
  if (EVIDENCE_WINDOW_SECONDS === 0) return { open: true };

  const { data, error } = await db
    .from('dispute_claims')
    .select('role')
    .eq('project_id', projectRowId);

  if (error) throw new Error(`[dispute] cannot read dispute claims: ${error.message}`);

  const roles = new Set((data ?? []).map((r) => (r as { role: string }).role));
  if (roles.has('client') && roles.has('builder')) return { open: true };

  // `stateTimestamp` was set to block.timestamp by raiseDispute, so this is the age of the
  // dispute measured by the same clock the contract uses.
  const opensAt = chain.onChain.stateTimestamp + BigInt(EVIDENCE_WINDOW_SECONDS);
  if (chain.nowSeconds >= opensAt) return { open: true };

  const remaining = Number(opensAt - chain.nowSeconds);
  const hours = Math.ceil(remaining / 3600);

  return {
    open: false,
    retryAfterSeconds: remaining,
    message:
      `Only one side has filed a statement. A ruling can be requested once both parties have ` +
      `filed, or in about ${hours} hour${hours === 1 ? '' : 's'} — whichever comes first.`,
  };
}
