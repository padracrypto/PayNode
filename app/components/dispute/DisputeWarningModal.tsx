'use client';

/**
 * The confirmation a party sees before freezing an escrow.
 *
 * This replaces the `window.confirm()` in `raiseDispute()`. A native confirm cannot show the
 * arbitration standard, cannot require an acknowledgement, and renders as an unstyled browser
 * chrome dialog on the one action in this app that is genuinely irreversible.
 *
 * ── WHAT IT HAS TO GET RIGHT ─────────────────────────────────────────────────
 * Every number here is read from `PROTOCOL` via `DISPUTE_WINDOWS`, never typed as prose, and
 * the distinctions matter because three different seven-day windows exist in this protocol and
 * they are easy to conflate:
 *
 *   REVIEW PERIOD (7d)   after delivery, the client's window to approve or dispute; then the
 *                        builder may claim. This is the "claim window".
 *   DISPUTE TIMEOUT (30d) NOT seven days. A dispute nobody resolves becomes permissionlessly
 *                        settleable after thirty, and the outcome depends on whether work had
 *                        been delivered when the dispute was raised.
 *   ATTESTATION TTL (7d) once a ruling is signed it must be relayed on-chain within a week.
 *                        Quoted on the verdict card from the stored deadline, not here — it
 *                        does not start running until a ruling exists.
 *
 * Deliberately absent: the 7-day RESOLVER TIMELOCK. That governs rotation of the resolver
 * signing key and has nothing to do with a party's dispute. Listing it beside the others would
 * read as a fourth deadline they have to track.
 *
 * The rubric summary is a faithful condensation of `RESOLVER_SYSTEM_PROMPT` in
 * lib/resolver/arbitrate.ts, in the order that prompt weighs things. If that standard is
 * revised, revise this — a party who was shown a different standard than the one applied has a
 * fair complaint, and it is the kind of drift nothing else in the build would catch.
 *
 * ── WHICH ROUTES OUT EXIST ───────────────────────────────────────────────────
 * The routes come from `resolutionPaths()` rather than from a prose ladder in here, so this
 * dialog cannot promise a path the Disputed screen then refuses. It shows all three, closed ones
 * included and clearly marked: the decision a party is making is "is a dispute my best move",
 * and that depends on knowing they can still settle bilaterally in one transaction whatever the
 * adjudicator situation is. The rubric and the binding warning below then follow whichever
 * adjudicator actually governs this project.
 */

import * as React from 'react';
import { DISPUTE_WINDOWS, bpsToPercent, resolutionPaths } from '@/lib/dispute/types';
import type { ViewerRole } from '@/lib/dispute/types';
import { ResolutionPaths } from './ResolutionPaths';
import { Alert, Button, LinkButton } from './ui';

export function DisputeWarningModal({
  open,
  role,
  /** Whether the work had been marked delivered at the moment the dispute would be raised. */
  delivered,
  hasArbitrator,
  arbitratorLabel,
  hasResolver,
  resolverEpoch,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  role: ViewerRole;
  delivered: boolean;
  hasArbitrator: boolean;
  arbitratorLabel?: string;
  hasResolver: boolean;
  /** `onchain.resolverEpoch` — quoted so a party can see which signing key governs them. */
  resolverEpoch?: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [acknowledged, setAcknowledged] = React.useState(false);

  // Reset on every open, so a previous visit's tick is never inherited by a fresh decision.
  React.useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  // Escape closes, matching what a native confirm would do for a user who reflexively hits it.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  /**
   * The stale outcome is the contract's, and it is asymmetric.
   *
   * `forceResolveStaleDispute` splits 50/50 when the pre-dispute status was Delivered, and
   * refunds the client in full otherwise. A builder who disputes before delivering is therefore
   * risking everything on the 30-day path, and must be told so plainly — this is the single
   * most consequential sentence in this dialog for them.
   */
  const staleOutcome = delivered
    ? `split ${bpsToPercent(DISPUTE_WINDOWS.staleBuilderBps)}/${bpsToPercent(10_000 - DISPUTE_WINDOWS.staleBuilderBps)} between both parties`
    : 'refunded in full to the client, because the work was never marked delivered';

  // One source for the routes, shared with the Disputed screen this dialog leads to. The two
  // booleans below are read off the result rather than re-tested here, so "the rubric is shown"
  // and "the AI path is open" can never disagree.
  const paths = resolutionPaths({ hasArbitrator, hasResolver, arbitratorLabel, resolverEpoch });
  const resolverOpen = paths.some((p) => p.id === 'resolver' && p.available);
  const arbitratorOpen = paths.some((p) => p.id === 'arbitrator' && p.available);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispute-warning-title"
        className="bg-[#0f172a] border border-amber-900/50 rounded-3xl p-6 md:p-8 max-w-2xl w-full relative z-10 shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 shrink-0 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center">
            <svg
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6 text-amber-400"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 id="dispute-warning-title" className="text-2xl font-black text-white leading-tight">
              Open a dispute
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Read this before you continue. Raising a dispute cannot be undone.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* ---- 1. What happens immediately ---- */}
          <Alert tone="warn" label="The escrow freezes">
            Neither of you can release, refund or cancel while the dispute is open. The funds stay
            locked in the contract until it is resolved.
          </Alert>

          {/* ---- 2. Who decides: the three routes, for THIS project ----
                 Not wrapped in <Section />, unlike its neighbours: a Section's surface is the
                 same `#050B14` the path cards use, so nesting them would leave the cards
                 indistinguishable from their own container. The label and spacing are Section's;
                 only the surface is dropped. */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              How a dispute on this project ends
            </p>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              PayNode has three resolution paths. Which of them are open was fixed when this
              project was created and funded — they are listed here as they stand for this project,
              and a closed one cannot be opened later.
            </p>
            <ResolutionPaths paths={paths} />
            <p className="text-sm text-slate-500 leading-relaxed mt-4">
              None of the three has to be used. If nobody resolves it, the{' '}
              {DISPUTE_WINDOWS.staleDays}-day backstop below settles it on terms neither of you
              chooses.
            </p>
          </div>

          {/* ---- 3. The standard that will be applied ---- */}
          {resolverOpen && (
            <Section title="How the automatic AI arbitrator rules">
              <p className="mb-3">
                It reads the brief, every deliverable on record, the blockchain timeline and both
                parties&apos; statements, then outputs a single number: the builder&apos;s share of
                the escrow, anywhere from 0% to 100%. It weighs, in this order:
              </p>
              <ol className="space-y-2 mb-3">
                <RubricItem n={1} title="Delivery against scope">
                  What was submitted, compared with the agreed brief. Substantially delivered work
                  earns substantially all of the escrow even if imperfect; partial delivery earns
                  the proportion delivered; work never delivered earns nothing, however much
                  effort is described.
                </RubricItem>
                <RubricItem n={2} title="The verified timeline">
                  Facts from the blockchain — funding, deadlines, revisions, delivery — which
                  neither party can fabricate. Where a statement contradicts the chain, the chain
                  wins outright.
                </RubricItem>
                <RubricItem n={3} title="Who carried which burden">
                  The builder must evidence delivery, and a submission with artifacts counts where
                  a description of effort does not. The client must evidence the deficiency, and
                  against the agreed scope rather than a preference formed later.
                </RubricItem>
                <RubricItem n={4} title="Scope discipline">
                  Requirements that appear for the first time in a dispute statement, and are not
                  in the brief, are not part of the agreement and will not be held against the
                  builder.
                </RubricItem>
                <RubricItem n={5} title="Good faith">
                  Unexplained silence, a statement that dodges the central question, or evidence
                  that misrepresents a verified fact all weigh against whoever is responsible.
                </RubricItem>
              </ol>
              <p className="text-slate-500">
                It cannot open links — a URL counts for what your description of it makes it worth.
                Text that tries to instruct the arbitrator, or claims to speak for PayNode, is
                recorded as an attempt to manipulate the ruling and weighed against the party who
                wrote it. Filing no statement is not an automatic loss; the rest of the record is
                still ruled on.
              </p>
            </Section>
          )}

          {/* ---- 4. Binding. Stated for whichever adjudicator governs — an arbitrator's ruling
                 is every bit as final as the resolver's, and the previous copy only warned about
                 the automatic one. A mutual settlement needs no such warning: it cannot happen
                 without this party's own signature. ---- */}
          {resolverOpen && (
            <Alert tone="danger" label="Binding and final">
              The ruling is enforced by the smart contract. There is no appeal, no human review
              and no second pass — whatever split it reaches is what gets paid out. Once a ruling
              is issued it cannot be re-requested for a better number: the first one is stored
              permanently and every later request returns that same result.
            </Alert>
          )}

          {arbitratorOpen && (
            <Alert tone="danger" label="Binding and final">
              The arbitrator&apos;s ruling is enforced by the smart contract. It pays out the
              moment they submit it, there is no appeal and no second ruling, and neither of you
              can set a deadline for them. The one thing you both keep is the ability to settle
              between yourselves before they act.
            </Alert>
          )}

          {/* ---- 5. The 30-day fallback ---- */}
          <Section title={`If nobody resolves it within ${DISPUTE_WINDOWS.staleDays} days`}>
            <p>
              Anyone at all can then settle it, and the escrow is{' '}
              <span className="text-white font-bold">{staleOutcome}</span>.
            </p>
            {role === 'builder' && !delivered && (
              <p className="mt-2 text-red-400 font-bold">
                You have not marked this work delivered. If this dispute goes unresolved for{' '}
                {DISPUTE_WINDOWS.staleDays} days you receive nothing. Consider submitting your
                deliverable first.
              </p>
            )}
          </Section>

          {/* ---- 6. What to do next ---- */}
          <Section title="What happens after you confirm">
            <p>
              You will be asked to file a statement with your evidence. So will the other party.
              Both statements and all cited links are visible to each of you throughout — nothing
              is filed in secret.
            </p>
          </Section>
        </div>

        {/* ---- Acknowledgement. An explicit tick rather than a bare button: this is the one
               irreversible action in the app, and the cost of a misclick is the whole escrow. ---- */}
        <label className="flex items-start gap-3 mt-6 p-4 bg-[#050B14] border border-slate-800 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-amber-500 cursor-pointer"
          />
          <span className="text-sm text-slate-300 leading-relaxed">
            I understand the escrow will be frozen, that the outcome may be binding and final, and
            that this cannot be undone.
          </span>
        </label>

        <div className="flex flex-col-reverse sm:flex-row gap-3 mt-6">
          <LinkButton
            onClick={onCancel}
            disabled={busy}
            className="sm:flex-1 py-3 text-center no-underline hover:text-white"
          >
            Cancel
          </LinkButton>
          <Button
            tone="dispute"
            className="sm:flex-[2] py-4"
            disabled={!acknowledged}
            busy={busy}
            busyLabel="Confirm in your wallet…"
            onClick={onConfirm}
          >
            Open the dispute
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{title}</p>
      <div className="text-sm text-slate-400 leading-relaxed">{children}</div>
    </div>
  );
}

function RubricItem({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-5 h-5 mt-0.5 rounded-md bg-slate-800 text-slate-400 text-[10px] font-black flex items-center justify-center">
        {n}
      </span>
      <span>
        <span className="text-slate-200 font-bold">{title}.</span>{' '}
        <span className="text-slate-400">{children}</span>
      </span>
    </li>
  );
}
