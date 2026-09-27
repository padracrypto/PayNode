'use server';

import { cookies } from 'next/headers';
import { chainClient, serviceClient } from '@/lib/indexer/core';
import { SESSION_COOKIE, readSessionToken } from '@/lib/siwe-server';
import { escrowContract, parseProject, ProjectStatus } from '@/lib/paynode';

export type SubmitRatingResult = { ok: true; score: number } | { ok: false; message: string };

/** DB statuses a project may be rated in. Settlements and rulings land in one of these two. */
const CONCLUDED_DB = new Set(['Completed', 'Refunded']);
const CONCLUDED_CHAIN = new Set<number>([ProjectStatus.Completed, ProjectStatus.Refunded]);

/**
 * The client rates the builder of a concluded project, once, 1 to 5 stars.
 *
 * Same shape as /api/dispute/request-resolution: identity from the SIWE session cookie, then
 * standing checked against a service-role read of the project row. The service role bypasses
 * RLS, so every rule in the `ratings_insert_client` policy (supabase/migrations/0011) is
 * re-checked here — and the unique index on `ratings.project_id` is what actually makes the
 * rating one-shot under concurrency.
 *
 * `builder_address` is taken from the project row, never from the caller.
 */
export async function submitRating(projectId: number, score: number): Promise<SubmitRatingResult> {
  /* ---- 1. Identity. ---- */
  const session = await readSessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return { ok: false, message: 'Sign in with your wallet to rate this builder.' };

  /* ---- 2. Input. ---- */
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return { ok: false, message: 'A rating must be between 1 and 5 stars.' };
  }
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return { ok: false, message: 'That project reference was not valid.' };
  }

  const db = serviceClient();

  /* ---- 3. Standing. ---- */
  const { data: project, error: projectError } = await db
    .from('projects')
    .select('id, client, builder, status, blockchain_id')
    .eq('id', projectId)
    .maybeSingle();
  if (projectError) {
    console.error('[rating] project read failed:', projectError);
    return { ok: false, message: 'Could not load this project. Try again shortly.' };
  }
  if (!project || project.client.toLowerCase() !== session.wallet) {
    return { ok: false, message: 'Only the client of this project can rate its builder.' };
  }

  /* ---- 4. Concluded. ---- */
  //
  // The DB status is written by the indexer and can trail the chain by a few blocks — the page
  // shows the stars as soon as the CHAIN says Completed. Falling back to a chain read means a
  // client who rates straight after releasing funds is not told to come back later.
  let concluded = CONCLUDED_DB.has(project.status);
  if (!concluded && project.blockchain_id != null) {
    try {
      const raw = await chainClient.readContract({
        ...escrowContract,
        functionName: 'projects',
        args: [BigInt(project.blockchain_id)],
      });
      concluded = CONCLUDED_CHAIN.has(parseProject(raw as never).status);
    } catch (err) {
      console.error('[rating] chain status read failed:', err);
    }
  }
  if (!concluded) {
    return { ok: false, message: 'You can rate the builder once the project has concluded.' };
  }

  /* ---- 5. Once only. ---- */
  const { data: existing } = await db
    .from('ratings')
    .select('id')
    .eq('project_id', project.id)
    .maybeSingle();
  if (existing) return { ok: false, message: 'You have already rated this builder.' };

  const { error: insertError } = await db.from('ratings').insert({
    project_id: project.id,
    client_address: session.wallet,
    builder_address: project.builder.toLowerCase(),
    score,
  });
  if (insertError) {
    // Lost a race with a concurrent submission; the unique index refused the second one.
    if (insertError.code === '23505') {
      return { ok: false, message: 'You have already rated this builder.' };
    }
    console.error('[rating] insert failed:', insertError);
    return { ok: false, message: 'Could not save your rating. Try again shortly.' };
  }

  return { ok: true, score };
}
