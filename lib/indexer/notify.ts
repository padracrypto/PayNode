import type { SupabaseClient } from '@supabase/supabase-js';
import { ResolutionPath, formatUSDC } from '../paynode';

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
  type: 'DISPUTE_RAISED' | 'DISPUTE_RESOLVED' | 'NEW_TIP';
  link: string;
  event_key: string;
};

/** A tip this indexer has just confirmed against the chain. Amounts come from the transaction. */
export type VerifiedTip = {
  sender_wallet: string;
  receiver_wallet: string;
  tx_hash: string;
  /** Exact wei the transaction moved — never the sender's self-reported `tips.amount` float. */
  amount_wei: bigint;
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

// -------------------------------------------------------------------------------------
// TIPS
// -------------------------------------------------------------------------------------

/**
 * Event key for a tip. A tip is a bare native transfer and emits NO LOG, so it has no
 * logIndex to key on the way dispute notifications do. The transaction hash alone is
 * unique, and the `tip:` prefix keeps it from ever colliding with a '<txHash>:<logIndex>'
 * key from migration 0007.
 */
export const tipEventKey = (txHash: string) => `tip:${txHash.toLowerCase()}`;

const shortWallet = (w: string) => `${w.slice(0, 6)}...${w.slice(-4)}`;

/**
 * The recipient's "you were tipped" notification.
 *
 * Only the receiver is notified: the sender watched their own transaction confirm and needs
 * no telling. The amount is formatted from `amount_wei`, which came off the transaction —
 * `tips.amount` is a number the sender typed and is not authority for anything.
 */
export function buildTipNotification(tip: VerifiedTip): NotificationRow {
  return {
    wallet_address: lower(tip.receiver_wallet),
    message: `You received a ${formatUSDC(tip.amount_wei)} tip from ${shortWallet(lower(tip.sender_wallet))}!`,
    type: 'NEW_TIP',
    link: '/dashboard',
    event_key: tipEventKey(tip.tx_hash),
  };
}

/**
 * Tell a builder about a tip, once the transfer is confirmed on-chain.
 *
 * The browser cannot do this. notifications_insert_counterparty (migrations 0001/0006) only
 * accepts a recipient who shares a project with the sender, and a tipper usually shares
 * nothing with the person they are tipping — so the insert the tip page used to fire was
 * rejected by RLS every single time, silently, because its result was never checked.
 *
 * Widening that policy to "anyone who inserted a tip row naming you" was the tempting fix
 * and the wrong one: tips_insert_as_sender lets any signed-in wallet claim a tip to any
 * address with a junk tx_hash, so it would have turned `notifications` into exactly the
 * spam channel addressable at any wallet that 0001 was written to prevent. Sending from
 * here instead means a notification exists only where a real transfer does.
 *
 * Returns 1 when a row was created, 0 on a replay. THROWS on a database error; the caller
 * decides what that is worth.
 */
export async function notifyVerifiedTip(db: SupabaseClient, tip: VerifiedTip): Promise<number> {
  // Same ON CONFLICT DO NOTHING as the dispute path: the indexer retries tips it could not
  // reach an RPC for, and must not notify twice for one transfer.
  const { data, error } = await db
    .from('notifications')
    .upsert([buildTipNotification(tip)], {
      onConflict: 'event_key,wallet_address',
      ignoreDuplicates: true,
    })
    .select('id');
  if (error) throw new Error(`cannot insert tip notification: ${error.message}`);

  return data?.length ?? 0;
}
