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
  DISPUTE_WINDOWS,
  deriveDisputeStage,
  resolverAvailability,
  STAGE_LABEL,
  type DeliverableRow,
  type DisputeStage,
  type ResolveRequestResponse,
  type ViewerRole,
} from '@/lib/dispute/types';
import { ProjectStatus } from '@/lib/paynode';
import { ClaimCenter } from './ClaimCenter';
import { DeliverableForm } from './DeliverableForm';
import { DeliverableHistory } from './DeliverableHistory';
import { SplitMeter } from './SplitMeter';
import { VerdictCard } from './VerdictCard';
import { Alert, Badge, Button, Card, PanelHeading, SectionLabel, Spinner } from './ui';

export type DisputePanelProps = {
  /** `projects.id` — the Supabase surrogate key the evidence tables reference. */
  projectRowId: number | undefined;
  /** The ON-CHAIN project id. What the ruling ledger and the attestation are keyed on. */
  projectId: bigint | undefined;

  status: ProjectStatus | undefined;
  /** The status captured at `raiseDispute`, for the asymmetric stale outcome. */
  preDisputeStatus: ProjectStatus | undefined;
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
  arbitratorLabel?: string;
  hasResolver: boolean;
  /** `resolverFor(projectId)` — the epoch key the contract will verify against. */
  expectedSigner: string | undefined;

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

export function DisputePanel(props: DisputePanelProps) {
  const {
    projectRowId,
    projectId,
    status,
    preDisputeStatus,
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

  const availability = resolverAvailability({ status, hasArbitrator, hasResolver });

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
  const deliveredBeforeDispute = preDisputeStatus === ProjectStatus.Delivered;

  return (
    <div className="space-y-6">
      {/* ===================== 1. DELIVERABLES ===================== */}
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

      {/* The history is shown from the first submission onward and never hidden again — not when
          a dispute opens, not after it settles. Blanking the record of the work at the moment
          it is being judged is the failure the page already documents for the legacy fields. */}
      {stage !== 'active' && (
        <Card>
          {/* "Submission record", not "Delivered work" — the page keeps its own "Delivered Work"
              card below, which holds the client's approve/revise actions and the builder's force
              release. Two headings with the same words, one above the other, read as a bug. */}
          <PanelHeading
            title="Submission record"
            subtitle="Every deliverable on record, oldest first — the same order the arbitrator reads them in."
            right={<Badge tone="neutral">{STAGE_LABEL[stage]}</Badge>}
          />
          <DeliverableHistory
            projectRowId={projectRowId}
            stage={stage}
            emptyHint={
              disputed
                ? 'The builder submitted no deliverables. The arbitrator will weigh that against them under delivery-against-scope — work never delivered earns nothing, however much effort is described.'
                : 'Nothing has been submitted yet.'
            }
          />
        </Card>
      )}

      {/* ===================== 2. THE DISPUTE ===================== */}
      {disputed && (
        <Card tone="dispute" className="space-y-6">
          <PanelHeading
            title="Evidence and claims"
            subtitle={
              <>
                Both parties&apos; statements are visible to each other throughout. The escrow stays
                frozen until this is resolved.
              </>
            }
            right={<Badge tone="warn">{STAGE_LABEL[stage]}</Badge>}
          />

          <ClaimCenter
            projectRowId={projectRowId}
            stage={stage}
            role={role}
            wallet={wallet}
            clientLabel={clientLabel}
            builderLabel={builderLabel}
            // The record closes once a ruling exists. Filing after the arbitrator has already read
            // the case file would put a statement on the record that demonstrably did not inform
            // the outcome, which is worse than not offering it.
            canFile={stage === 'evidence_open' || stage === 'arbitrating'}
          />

          {/* ---- Requesting a ruling (PATH 2) ---- */}
          {(stage === 'evidence_open' || stage === 'arbitrating') && (
            <div className="border-t border-amber-900/30 pt-6">
              {!availability.available ? (
                <Alert tone="neutral" label="Automatic resolution unavailable">
                  {availability.reason}
                </Alert>
              ) : stage === 'arbitrating' ? (
                <div className="bg-[#0f172a] border border-amber-900/40 rounded-2xl p-5">
                  <div className="flex items-center gap-3">
                    <Spinner className="w-5 h-5" />
                    <div>
                      <p className="text-white font-bold text-sm">Arbitration in progress</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        This usually takes under two minutes. The ruling will appear here on its
                        own — you can close this page.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-[#0f172a] border border-slate-800/80 rounded-2xl p-5">
                  <SectionLabel>Ask for a ruling</SectionLabel>
                  <p className="text-sm text-slate-400 leading-relaxed mt-2 mb-4">
                    The arbitrator will read the brief, every deliverable, the blockchain timeline
                    and both statements, then divide the escrow. It rules{' '}
                    <span className="text-white font-bold">once</span> — the result is stored
                    permanently, is binding, and cannot be re-requested for a different number.
                  </p>

                  {(role === 'client' || role === 'builder') && (
                    <Button
                      tone="dispute"
                      className="w-full"
                      busy={request.isPending}
                      busyLabel="Preparing the ruling…"
                      onClick={requestRuling}
                    >
                      Request a binding ruling
                    </Button>
                  )}

                  {requestOutcome && (
                    <div className="mt-4">
                      <RequestOutcomeNotice
                        outcome={requestOutcome}
                        onDismiss={() => setRequestOutcome(null)}
                      />
                    </div>
                  )}

                  {request.error && (
                    <div className="mt-4">
                      <Alert tone="danger" label="Request failed">
                        {request.error instanceof Error
                          ? request.error.message
                          : 'Could not reach the resolver service.'}
                      </Alert>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* The 30-day breaker (PATH 4) is deliberately NOT restated here. The page's own
              resolution block above already counts it down and owns the button that fires it,
              and a second near-identical sentence about thirty days on the same screen just
              makes both look less authoritative. The verdict card's expiry copy is about the
              attestation's own deadline, which is a different clock entirely. */}
        </Card>
      )}

      {/* ===================== 3. THE VERDICT ===================== */}
      {(stage === 'ruling_ready' || stage === 'ruling_expired') && resolution && projectId !== undefined && (
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
      )}

      {stage === 'ruling_failed' && resolution && (
        <Card tone="danger">
          <PanelHeading
            title="No ruling was issued"
            subtitle="The arbitrator declined to rule on this dispute."
            right={<Badge tone="danger">Declined</Badge>}
          />
          <Alert tone="danger" label="Why">
            {resolution.error ??
              'The resolver could not reach a ruling it was willing to sign on this record.'}
          </Alert>
          <p className="text-sm text-slate-400 leading-relaxed mt-4">
            Retrying will not help — a declined ruling is recorded permanently and re-requesting
            returns the same answer. Two routes remain open: agree a settlement directly with the
            other party, or wait out the {DISPUTE_WINDOWS.staleDays}-day timeout, after which
            anyone can close the dispute{' '}
            {deliveredBeforeDispute ? 'with a 50/50 split' : 'with a full refund to the client'}.
          </p>
        </Card>
      )}

      {/* ===================== 4. SETTLED, VIA ARBITRATION ===================== */}
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

      {/* ===================== 5. ESCALATION ===================== */}
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

