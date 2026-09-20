import type { SupabaseClient } from '@supabase/supabase-js';
import { ResolutionPath } from '../paynode';

/**
 * Notifications derived from chain events.
 *
 * Browsers can only notify a counterparty about something they just did themselves. Events
 * nobody in a browser caused — an arbitrator's ruling, an automatic resolution, the 30-day
 * timeout — never reached the parties at all, and RLS (migration 0006) deliberately stops the
 * arbitrator from notifying anyone. The service-role indexer writes those instead.
 *
 * Idempotency: every row carries event_key = '<txHash>:<logIndex>', unique per recipient
 * (migration 0007). The indexer replays ranges, so an insert that already happened must be a
 * no-op rather than a duplicate — and a notification that failed the first time is retried by
 * the same replay.
 */

export type DisputeEventName = 'DisputeRaised' | 'DisputeResolved';

export type NotificationRow = {
  wallet_address: string;
  message: string;
  type: 'DISPUTE_RAISED' | 'DISPUTE_RESOLVED';
  link: string;
  event_key: string;
};

/** The columns of a projects row that notifications are addressed from. */
export type ProjectParties = {
  /** Supabase row id — what the /project/[id] route takes. NOT the on-chain project id. */
  id: string | number;
  title: string | null;
  client: string;
  builder: string;
  /** Null when no arbitrator was named (autonomous resolution). */
  arbitrator: string | null;
};

// Mirrors PATH_LABEL in app/project/[id]/page.tsx.
const PATH_LABEL: Record<number, string> = {
  [ResolutionPath.DesignatedArbitrator]: 'the designated arbitrator',
  [ResolutionPath.AutonomousResolver]: 'automatic resolution',
  [ResolutionPath.MutualSettlement]: 'mutual agreement',
  [ResolutionPath.StaleDisputeBreaker]: 'the 30-day timeout',
};

const lower = (a: unknown) => String(a ?? '').toLowerCase();

function describeOutcome(builderBps: number): string {
  if (builderBps >= 10_000) return 'paid in full to the builder';
  if (builderBps <= 0) return 'refunded in full to the client';
  return `${builderBps / 100}% to the builder, ${(10_000 - builderBps) / 100}% refunded to the client`;
}

/**
 * Build the notification rows for one DisputeRaised / DisputeResolved log.
 *
 * Every party gets one, worded for their role. A wallet that holds two roles (which the
 * contract should not allow, but the database does not enforce) gets a single row, with the
 * client/builder wording winning over the arbitrator's — the unique key would drop a second
 * row for the same log anyway, so this just makes the choice deliberate.
 */
export function buildDisputeNotifications(
  eventName: DisputeEventName,
  args: Record<string, unknown>,
  project: ProjectParties,
  eventKey: string,
): NotificationRow[] {
  const title = project.title ? `"${project.title}"` : 'your project';
  const link = `/project/${project.id}`;
  const client = lower(project.client);
  const builder = lower(project.builder);
  const arbitrator = project.arbitrator ? lower(project.arbitrator) : null;

  const messages = new Map<string, string>();
  let type: NotificationRow['type'];

  if (eventName === 'DisputeRaised') {
    type = 'DISPUTE_RAISED';
    const raiser = lower(args.raisedBy);
    const frozen = 'The escrowed funds are frozen until it is resolved.';

    if (arbitrator) messages.set(arbitrator, `Your ruling is needed on the dispute for ${title}.`);
    for (const party of [client, builder]) {
      messages.set(
        party,
        party === raiser
          ? `You opened a dispute on ${title}. ${frozen}`
          : `A dispute was opened on ${title}. ${frozen}`,
      );
    }
  } else {
    type = 'DISPUTE_RESOLVED';
    const path = Number(args.resolutionPath ?? 0);
    const outcome = describeOutcome(Number(args.builderBps ?? 0));
    const by = PATH_LABEL[path] ?? 'the contract';

    if (arbitrator) {
      messages.set(
        arbitrator,
        path === ResolutionPath.DesignatedArbitrator
          ? `Your ruling on ${title} is final: ${outcome}.`
          : `The dispute on ${title} was resolved by ${by}; no ruling is needed.`,
      );
    }
    for (const party of [client, builder]) {
      messages.set(party, `The dispute on ${title} was resolved by ${by}: ${outcome}.`);
    }
  }

  return [...messages].map(([wallet_address, message]) => ({
    wallet_address,
    message,
    type,
    link,
    event_key: eventKey,
  }));
}

/**
 * Notify the parties to a project about one dispute log.
 *
 * Returns how many notifications were newly created (0 on a replay). THROWS on a database
 * error so the caller can decide what a failed notification is worth — see the call site.
 * A project with no database row is not an error: there is nobody to address, exactly as
 * apply_project_event treats it.
 */
export async function notifyDisputeEvent(
  db: SupabaseClient,
  eventName: DisputeEventName,
  args: Record<string, unknown>,
  eventKey: string,
): Promise<number> {
  const { data: project, error: readErr } = await db
    .from('projects')
    .select('id, title, client, builder, arbitrator')
    .eq('blockchain_id', Number(args.projectId))
    .maybeSingle();
  if (readErr) throw new Error(`cannot read project ${String(args.projectId)}: ${readErr.message}`);
  if (!project) {
    console.warn(`[indexer] ${eventName} for project ${String(args.projectId)} has no database row; not notifying.`);
    return 0;
  }

  const rows = buildDisputeNotifications(eventName, args, project as ProjectParties, eventKey);

  // ignoreDuplicates makes this ON CONFLICT DO NOTHING, and `.select()` then returns only the
  // rows that were actually inserted — which is how a replay reports zero.
  const { data, error } = await db
    .from('notifications')
    .upsert(rows, { onConflict: 'event_key,wallet_address', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`cannot insert notifications: ${error.message}`);

  return data?.length ?? 0;
}
