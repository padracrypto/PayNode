'use client';

/**
 * The dispute surface, and the one place the lifecycle is decided.
 *
 * ── DIVISION OF LABOUR WITH THE PAGE ─────────────────────────────────────────
 * This panel owns everything OFF-chain: the evidence queries, the claim and deliverable writes,
 * and the request for a ruling. The page keeps everything ON-chain — it already has a single
 * guarded `send()` helper, one `useWriteContract`, the network guard and the post-transaction
 * Supabase sync, and splitting that machinery in two would give the page two sources of truth
 * for "is a transaction in flight".
 *
 * So chain actions arrive as callbacks (`onRaiseDispute`, `onMarkDelivered`) and chain state
 * arrives as props. The one exception is the settlement relay inside <VerdictCard />, which owns
 * its own write hook: it needs independent pending/success/revert states on a single button, and
 * routing it through the page's shared `txStatus` string would make those states global.
 *
 * ── WHY THE STAGE IS COMPUTED HERE AND NOWHERE ELSE ──────────────────────────
 * `deriveDisputeStage` takes on-chain status, the ruling ledger and chain time, and every child
 * renders from its answer. The alternative — each card testing `status === Disputed &&
 * resolution?.status === 'signed' && ...` for itself — is how two cards end up on screen
 * contradicting each other. The stage also drives the polling cadence, so a settled project
 * stops querying and a page waiting on a ruling polls every five seconds.
 */

import * as React from 'react';
import {
  useDisputeResolution,
  useInvalidateDispute,
  useRequestResolution,
} from '@/lib/dispute/hooks';
import {
  deriveDisputeStage,
  STAGE_LABEL,
  type DeliverableRow,
  type DisputeStage,
  type ResolutionPathId,
  type ResolutionPathInfo,
  type ResolveRequestResponse,
  type ViewerRole,
} from '@/lib/dispute/types';
import { ProjectStatus } from '@/lib/paynode';
import { ClaimCenter } from './ClaimCenter';
import { DeliverableForm } from './DeliverableForm';
import { DeliverableHistory } from './DeliverableHistory';
import { DisputeActionPanel } from './DisputeActionPanel';
import { SplitMeter } from './SplitMeter';
import { VerdictCard } from './VerdictCard';
import { Alert, Badge, Button, Card, PanelHeading, Spinner } from './ui';

export type DisputePanelProps = {
  /** `projects.id` — the Supabase surrogate key the evidence tables reference. */
  projectRowId: number | undefined;
  /** The ON-CHAIN project id. What the ruling ledger and the attestation are keyed on. */
  projectId: bigint | undefined;

  status: ProjectStatus | undefined;
  totalWei: bigint | undefined;
  /** The project's SNAPSHOTTED fee. Never the live global fee. */
  feeBps: number | undefined;
  revisionsUsed: number;
  /** Latest block timestamp — the clock the contract compares against. */
  chainNow: bigint;

  role: ViewerRole;
  wallet: string | undefined;
  clientLabel: string;
  builderLabel: string;

  hasArbitrator: boolean;
  hasResolver: boolean;
  /** `resolverFor(projectId)` — the epoch key the contract will verify against. */
  expectedSigner: string | undefined;
  /** `deriveActions().canProposeSettlement` — whether PATH 3 is this viewer's to start. */
  canProposeSettlement: boolean;

  /**
   * The page's half of the disputed layout. While the project is Disputed the panel renders two
   * columns, and everything on-chain in them arrives here as a slot.
   */
  dispute?: DisputeSlots;

  /** True when `deriveActions().canDeliver` — the builder may submit right now. */
  canDeliver: boolean;
  /** True when `deriveActions().canRaiseDispute`. */
  canRaiseDispute: boolean;
  /** True while the PAGE has a transaction in flight. */
  txPending: boolean;

  /** Fires with the committed evidence row; the page sends `markDelivered` from there. */
  onMarkDelivered: (row: DeliverableRow) => void;
  onOpenDisputeModal: () => void;
  guardNetwork: () => Promise<boolean>;
  /** Re-read the chain. Called after a settlement lands. */
  onChainChanged: () => void;
};

/**
 * The ON-CHAIN pieces of an open dispute, built by the page because the page owns the one
 * guarded `send()` they all go through. The panel only decides where they sit.
 */
export type DisputeSlots = {
  /** Left column, top: the project brief and its key facts. */
  brief: React.ReactNode;
  /** Above the action panel: transaction status, the wrong-network guard. */
  notices?: React.ReactNode;
  /** `resolutionPaths()` for this project — one tab per open path. */
  paths: ResolutionPathInfo[];
  intro?: React.ReactNode;
  /** An unanswered settlement offer exists. Opens on that tab and marks it live. */
  offerPending: boolean;
  /** PATH 1 — the arbitrator's ruling controls, or a waiting note for the parties. */
  arbitratorControls?: React.ReactNode;
  /** PATH 3 — propose, accept, counter, withdraw. */
  settlementControls?: React.ReactNode;
  /** PATH 4 — the 30-day countdown, or the button once it has passed. */
  backstop?: React.ReactNode;
};

export function DisputePanel(props: DisputePanelProps) {
  const {
    projectRowId,
    projectId,
    status,
    totalWei,
    feeBps,
    revisionsUsed,
    chainNow,
    role,
    wallet,
    clientLabel,
    builderLabel,
    hasArbitrator,
    hasResolver,
    expectedSigner,
    canProposeSettlement,
    dispute,
    canDeliver,
    canRaiseDispute,
    txPending,
    onMarkDelivered,
    onOpenDisputeModal,
    guardNetwork,
    onChainChanged,
  } = props;

  /**
   * Whether THIS page view has a resolution request outstanding.
   *
   * It cannot come from the database: RLS hides `status = 'pending'` from the parties, so the row
   * a user is waiting on is invisible to them. It is set from the request's own 202 and cleared
   * when a ruling becomes visible, which makes it a client-side fact with a one-page-view
   * lifetime — a reload during arbitration drops back to `evidence_open` until the row lands.
   * That is the honest failure mode: the alternative is persisting a claim the user cannot read.
   */
  const [requestInFlight, setRequestInFlight] = React.useState(false);
  const [requestOutcome, setRequestOutcome] = React.useState<ResolveRequestResponse | null>(null);

  // A first pass with `requestInFlight` folded in, so the poll cadence is already fast while
  // waiting. The resolution query then feeds the authoritative second pass below.
  const provisionalStage = deriveDisputeStage({
    status,
    resolution: null,
    nowSeconds: chainNow,
    requestInFlight,
  });

  const resolutionQuery = useDisputeResolution(projectId, provisionalStage);
  const resolution = resolutionQuery.data ?? null;

  const stage: DisputeStage = deriveDisputeStage({
    status,
    resolution,
    nowSeconds: chainNow,
    requestInFlight,
  });

  const invalidate = useInvalidateDispute();
  const request = useRequestResolution();

  // The ruling arrived — stop claiming a request is in flight, or the panel would show both the
  // verdict and an "in progress" spinner.
  React.useEffect(() => {
    if (resolution && resolution.status !== 'pending') setRequestInFlight(false);
  }, [resolution]);

  // The tab the viewer picked. Null until they pick one, so the default can follow the dispute:
  // an offer arriving moves an untouched panel to the settlement tab, but never pulls a viewer
  // away from a tab they chose.
  const [tab, setTab] = React.useState<ResolutionPathId | null>(null);

  const requestRuling = async () => {
    if (projectId === undefined) return;
    setRequestOutcome(null);
    try {
      const outcome = await request.mutateAsync(projectId);
      setRequestOutcome(outcome);
      // 'pending' is the only answer that means "keep waiting". A 'signed' answer means the row
      // is now readable, and the mutation's own onSettled has already invalidated it.
      setRequestInFlight(outcome.status === 'pending');
    } catch {
      // `mutateAsync` rejects only when the response was unreadable — every legitimate outcome,
      // including ineligible and too_early, resolves. Swallowed here because `request.error`
      // already renders it; without the catch this handler would surface as an unhandled
      // rejection in the console on a transport failure.
    }
  };

  /* -------------------------------------------------------------------------- */

  if (projectRowId === undefined || stage === 'inert') {
    // Nothing is escrowed and nothing is in dispute. The page's own cards cover these states.
    return null;
  }

  const settled = stage === 'settled';
  const disputed = status === ProjectStatus.Disputed;
  // Someone who will actually read the case file: the named arbitrator (PATH 1) or the AI
  // resolver (PATH 2). With neither, mutual settlement is the only route and a statement has no
  // reader, so the evidence box is not offered at all.
  const hasAdjudicator = hasArbitrator || hasResolver;

  const openPaths = dispute?.paths.filter((p) => p.available) ?? [];
  const activeTab: ResolutionPathId =
    (tab && openPaths.some((p) => p.id === tab) ? tab : null) ??
    (dispute?.offerPending ? 'settlement' : (openPaths[0]?.id ?? 'settlement'));

  const resolverControls = (
    <ResolverControls
      stage={stage}
      role={role}
      requesting={request.isPending}
      onRequest={requestRuling}
      outcome={requestOutcome}
      onDismissOutcome={() => setRequestOutcome(null)}
      error={request.error}
      declinedReason={resolution?.error ?? null}
      canSettleInstead={canProposeSettlement}
      onSettleInstead={() => setTab('settlement')}
      verdict={
        resolution &&
        projectId !== undefined && (
          <VerdictCard
            resolution={resolution}
            projectId={projectId}
            totalWei={totalWei}
            feeBps={feeBps}
            expectedSigner={expectedSigner}
            chainNow={chainNow}
            clientLabel={clientLabel}
            builderLabel={builderLabel}
            guardNetwork={guardNetwork}
            onSettled={() => {
              invalidate();
              onChainChanged();
            }}
          />
        )
      }
    />
  );

  /* ---- Pieces shared by both layouts ---- */

  // The history is shown from the first submission onward and never hidden again — not when a
  // dispute opens, not after it settles. Blanking the record of the work at the moment it is
  // being judged is the failure the page already documents for the legacy fields.
  //
  // "Submission record", not "Delivered work" — the page keeps its own "Delivered Work" card,
  // which holds the client's approve/revise actions and the builder's force release. Two
  // headings with the same words, one above the other, read as a bug.
  const submissionRecord = stage !== 'active' && (
    <Card>
      <PanelHeading
        title="Submission record"
        subtitle="Every deliverable, oldest first."
        right={<Badge tone="neutral">{STAGE_LABEL[stage]}</Badge>}
      />
      <DeliverableHistory
        projectRowId={projectRowId}
        stage={stage}
        emptyHint={
          disputed && hasAdjudicator
            ? 'The builder submitted no deliverables. Work never delivered earns nothing under delivery-against-scope, however much effort is described.'
            : 'Nothing has been submitted yet.'
        }
      />
    </Card>
  );

  /* ===================== DISPUTED: TWO COLUMNS ===================== */
  // Left: what is being judged — the brief, the submissions, the statements. Right: what the
  // viewer can do about it, sticky so the call to action stays in view while they read the
  // record. On a phone the action panel slots in straight after the brief, before the long
  // record, so the reader learns what is at stake and what they can do before scrolling.
  if (disputed && dispute) {
    return (
      <div className="grid gap-y-4 gap-x-8 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-[auto_auto_1fr]">
        <div className="min-w-0 lg:col-start-1 self-start">{dispute.brief}</div>

        <aside className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-3">
          <div className="space-y-4 lg:sticky lg:top-6">
            {dispute.notices}
            <DisputeActionPanel
              paths={dispute.paths}
              tab={activeTab}
              onTabChange={setTab}
              intro={dispute.intro}
              liveTab={dispute.offerPending ? 'settlement' : stage === 'arbitrating' ? 'resolver' : undefined}
              content={{
                arbitrator: dispute.arbitratorControls,
                resolver: resolverControls,
                settlement: dispute.settlementControls,
              }}
              footer={dispute.backstop}
            />
          </div>
        </aside>

        <div className="min-w-0 lg:col-start-1 self-start">{submissionRecord}</div>

        {hasAdjudicator && (
          <div className="min-w-0 lg:col-start-1 self-start">
            <Card tone="dispute">
              <PanelHeading
                title="Evidence and claims"
                subtitle="Optional. The brief, timeline and deliverables carry the most weight; statements cannot change the original scope."
                right={<Badge tone="warn">{STAGE_LABEL[stage]}</Badge>}
              />
              <ClaimCenter
                projectRowId={projectRowId}
                stage={stage}
                role={role}
                wallet={wallet}
                clientLabel={clientLabel}
                builderLabel={builderLabel}
                // The record closes once a ruling exists. Filing after the arbitrator has
                // already read the case file would put a statement on the record that
                // demonstrably did not inform the outcome, which is worse than not offering it.
                canFile={stage === 'evidence_open' || stage === 'arbitrating'}
              />
            </Card>
          </div>
        )}
      </div>
    );
  }

  /* ===================== EVERY OTHER STAGE: ONE COLUMN ===================== */
  return (
    <div className="space-y-4">
      {canDeliver && role === 'builder' && wallet && (
        <Card>
          <DeliverableForm
            projectRowId={projectRowId}
            builder={wallet}
            revisionIndex={revisionsUsed}
            txPending={txPending}
            onRecorded={onMarkDelivered}
          />
        </Card>
      )}

      {submissionRecord}

      {/* Only when there IS a stored ruling. A project settled by mutual agreement or by the
          30-day breaker has no attestation behind it, and the page's own "Dispute resolved"
          card — driven by the indexer's `resolution_path` — is the right place for those. */}
      {settled && resolution?.status === 'signed' && resolution.builder_bps != null && (
        <Card tone="dispute">
          <PanelHeading
            title="Settled by arbitration"
            subtitle="The record of how this dispute was decided, kept permanently."
            right={<Badge tone="good">Closed</Badge>}
          />
          <SettledSummary
            builderBps={resolution.builder_bps}
            reasoning={resolution.reasoning}
            clientLabel={clientLabel}
            builderLabel={builderLabel}
            totalWei={totalWei}
            feeBps={feeBps}
          />
        </Card>
      )}

      {canRaiseDispute && !disputed && !settled && (
        <div className="text-center">
          <button
            type="button"
            onClick={onOpenDisputeModal}
            disabled={txPending}
            className="text-slate-500 hover:text-amber-400 text-xs font-bold transition-colors underline decoration-slate-700 underline-offset-4 disabled:opacity-50"
          >
            Something wrong? Open a dispute
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              THE AI TAB'S BODY                             */
/* -------------------------------------------------------------------------- */

/**
 * What the AI Arbitrator tab shows at each stage of PATH 2. One component so the tab has
 * exactly one body at a time: the request button, the wait, the verdict, or the refusal.
 */
function ResolverControls({
  stage,
  role,
  requesting,
  onRequest,
  outcome,
  onDismissOutcome,
  error,
  verdict,
  declinedReason,
  canSettleInstead,
  onSettleInstead,
}: {
  stage: DisputeStage;
  role: ViewerRole;
  requesting: boolean;
  onRequest: () => void;
  outcome: ResolveRequestResponse | null;
  onDismissOutcome: () => void;
  error: unknown;
  verdict: React.ReactNode;
  declinedReason: string | null;
  canSettleInstead: boolean;
  onSettleInstead: () => void;
}) {
  if (stage === 'ruling_ready' || stage === 'ruling_expired') return <>{verdict}</>;

  if (stage === 'ruling_failed') {
    return (
      <div className="space-y-4">
        <Alert tone="danger" label="No ruling issued">
          {declinedReason ??
            'The resolver could not reach a ruling it was willing to sign on this record.'}
        </Alert>
        <p className="text-xs text-slate-500 leading-relaxed">
          A declined ruling is permanent — retrying returns the same answer.
        </p>
        {canSettleInstead && (
          <Button tone="primary" className="w-full" onClick={onSettleInstead}>
            Propose a split instead
          </Button>
        )}
      </div>
    );
  }

  if (stage === 'arbitrating') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
        <Spinner className="w-5 h-5" />
        <div>
          <p className="text-white font-bold text-sm">Arbitration in progress</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Usually under two minutes. The ruling appears here on its own — you can close this page.
          </p>
        </div>
      </div>
    );
  }

  const isParty = role === 'client' || role === 'builder';

  return (
    <div className="space-y-3">
      {isParty ? (
        <button
          type="button"
          onClick={onRequest}
          disabled={requesting}
          aria-busy={requesting || undefined}
          className="group relative w-full overflow-hidden rounded-2xl px-5 py-4 text-base font-black text-white transition-all bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-[0_0_32px_-8px_rgba(139,92,246,0.7)] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className="relative flex items-center justify-center gap-2">
            {requesting && <Spinner className="w-4 h-4 border-white/30 border-t-white" />}
            {requesting ? 'Preparing the ruling…' : 'Request a binding ruling'}
          </span>
        </button>
      ) : (
        <p className="text-sm text-slate-500">Only the client or the builder can request a ruling.</p>
      )}

      {isParty && (
        <p className="text-xs text-slate-500 leading-relaxed text-center">
          One ruling per project. It cannot be appealed or re-requested.
        </p>
      )}

      {outcome && <RequestOutcomeNotice outcome={outcome} onDismiss={onDismissOutcome} />}

      {error != null && (
        <Alert tone="danger" label="Request failed">
          {error instanceof Error ? error.message : 'Could not reach the resolver service.'}
        </Alert>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 SUB-PARTS                                  */
/* -------------------------------------------------------------------------- */

/**
 * Render the request route's answer.
 *
 * Every branch except `error` is information rather than failure, and each says something
 * different a user can act on — which is why the mutation resolves these instead of throwing.
 * Flattening them into one red box would tell a party whose only problem is that the other side
 * has not filed yet that something is broken.
 */
function RequestOutcomeNotice({
  outcome,
  onDismiss,
}: {
  outcome: ResolveRequestResponse;
  onDismiss: () => void;
}) {
  switch (outcome.status) {
    case 'signed':
      return (
        <Alert tone="good" label={outcome.replayed ? 'Already ruled' : 'Ruling issued'} onDismiss={onDismiss}>
          {outcome.replayed
            ? 'This dispute had already been ruled on. The original ruling is shown below — it is the only one that will ever exist for this project.'
            : 'The arbitrator has ruled. The verdict is below, ready to execute on-chain.'}
        </Alert>
      );

    case 'pending':
      return (
        <Alert tone="info" label="In progress" onDismiss={onDismiss}>
          {outcome.message}
        </Alert>
      );

    case 'too_early':
      return (
        <Alert tone="warn" label="Not yet" onDismiss={onDismiss}>
          {outcome.message}
        </Alert>
      );

    case 'ineligible':
      return (
        <Alert tone="neutral" label="Cannot be arbitrated" onDismiss={onDismiss}>
          {outcome.message}
        </Alert>
      );

    case 'failed':
      return (
        <Alert tone="danger" label="Declined" onDismiss={onDismiss}>
          {outcome.message}
        </Alert>
      );

    case 'forbidden':
    case 'error':
      return (
        <Alert tone="danger" label="Could not request a ruling" onDismiss={onDismiss}>
          {outcome.message}
        </Alert>
      );
  }
}

function SettledSummary({
  builderBps,
  reasoning,
  clientLabel,
  builderLabel,
  totalWei,
  feeBps,
}: {
  builderBps: number;
  reasoning: string | null;
  clientLabel: string;
  builderLabel: string;
  totalWei: bigint | undefined;
  feeBps: number | undefined;
}) {
  const [showReasoning, setShowReasoning] = React.useState(false);

  return (
    <div className="space-y-5">
      {/* The same meter the live verdict uses, so a settled dispute is described in exactly the
          terms it was decided in rather than re-summarised into prose. */}
      <SplitMeter
        builderBps={builderBps}
        totalWei={totalWei}
        feeBps={feeBps}
        clientLabel={clientLabel}
        builderLabel={builderLabel}
      />

      {reasoning && (
        <div>
          <button
            type="button"
            onClick={() => setShowReasoning((v) => !v)}
            className="text-xs font-bold text-slate-500 hover:text-white transition-colors underline decoration-slate-700 underline-offset-4"
          >
            {showReasoning ? 'Hide' : 'Read'} the arbitrator&apos;s reasoning
          </button>
          {showReasoning && (
            <p className="mt-3 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              {reasoning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

