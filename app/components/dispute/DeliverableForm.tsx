'use client';

/**
 * Deliverable submission — builder only.
 *
 * WHAT THIS IS AND IS NOT. It writes a row to `public.deliverables`, which is EVIDENCE. It does
 * not move the project: `markDelivered` on-chain remains the only thing that does, exactly as
 * migration 0010's header states. So this form owns the evidence write and then hands control
 * back to the page, which owns the transaction — `onRecorded` fires once the row is committed,
 * and the page sends `markDelivered` through its existing guarded `send()` helper.
 *
 * THE ORDERING IS DELIBERATE AND IT IS A BUG FIX PRESERVED FROM `deliverWork()`. Evidence
 * first, transaction second. The reverse order means a closed tab, a refresh or a failed
 * insert leaves the chain saying Delivered with nothing behind it for the client to review —
 * and, once a dispute opens, nothing for the resolver to weigh either. If the insert fails, the
 * builder has not yet spent gas.
 *
 * `revision_index` comes from the chain's `revisionsUsed`, not from a count of previous rows.
 * `projects` has no revision column; the counter lives only in the contract, and a row whose
 * revision_index disagrees with the chain would misrepresent the timeline the resolver reads.
 */

import * as React from 'react';
import { useSubmitDeliverable } from '@/lib/dispute/hooks';
import { MAX_BODY_CHARS, MAX_URLS, parseUrlList, type DeliverableRow } from '@/lib/dispute/types';
import { Alert, Button, CharCount, INPUT_CLASS, SectionLabel, TEXTAREA_CLASS } from './ui';

export function DeliverableForm({
  projectRowId,
  builder,
  revisionIndex,
  /** True while the page's `markDelivered` transaction is in flight. */
  txPending,
  onRecorded,
}: {
  projectRowId: number;
  builder: string;
  revisionIndex: number;
  txPending: boolean;
  /**
   * Called with the committed row once the evidence write succeeds. The page sends
   * `markDelivered` from here, and mirrors the row into the legacy `delivery_notes` /
   * `delivery_links` columns that older readers still render.
   */
  onRecorded: (row: DeliverableRow) => void;
}) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [urlsRaw, setUrlsRaw] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);

  const submit = useSubmitDeliverable();
  const parsed = React.useMemo(() => parseUrlList(urlsRaw), [urlsRaw]);
  const busy = submit.isPending || txPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    // At least one artifact. A submission with no artifact is the single weakest thing a
    // builder can put on the record — the resolver's standard says in as many words that "a
    // submission record with artifacts is evidence, a description of effort is not" — so the
    // form refuses it rather than letting someone lose a dispute to an omission.
    if (parsed.urls.length === 0) {
      setLocalError(
        'Add at least one artifact link — a pull request, a live preview, a design file. ' +
          'A description of the work without anything to inspect carries very little weight if ' +
          'this is ever disputed.',
      );
      return;
    }
    if (parsed.rejected.length > 0) {
      setLocalError(
        `These lines are not valid http(s) links and would not be shown to the other party: ` +
          `${parsed.rejected.join(', ')}`,
      );
      return;
    }
    if (description.length > MAX_BODY_CHARS) {
      setLocalError('The description is longer than the resolver will read. Trim it first.');
      return;
    }

    try {
      const row = await submit.mutateAsync({
        projectRowId,
        builder,
        title,
        description,
        artifactUrls: parsed.urls,
        revisionIndex,
      });
      // Committed. The page now sends markDelivered; the fields stay filled until the
      // transaction resolves, so a wallet rejection does not also lose the typing.
      onRecorded(row);
    } catch {
      // Surfaced from `submit.error` below — swallowed here so a rejected promise does not
      // reach the console as an unhandled rejection.
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-black text-white">Submit deliverable</h2>
        <span className="bg-blue-950/30 text-blue-400 px-3 py-1 rounded-lg text-xs font-bold border border-blue-900/50 flex items-center gap-2">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
              clipRule="evenodd"
            />
          </svg>
          Escrow secured
        </span>
      </div>

      {revisionIndex > 0 && (
        <div className="mb-5">
          <Alert tone="info" label="Revision round">
            This is revision {revisionIndex}. Earlier submissions stay on the record below —
            nothing is replaced, and the resolver reads the whole history in order.
          </Alert>
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label htmlFor="deliverable-title" className="block mb-2">
            <SectionLabel>Title</SectionLabel>
          </label>
          <input
            id="deliverable-title"
            className={INPUT_CLASS}
            placeholder="Checkout flow — final build"
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="deliverable-description" className="block mb-2">
            <SectionLabel>What you delivered</SectionLabel>
          </label>
          <textarea
            id="deliverable-description"
            className={TEXTAREA_CLASS}
            rows={5}
            placeholder="Describe what you built against the brief. Be specific about which requirements each artifact covers — that mapping is what a dispute turns on."
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
          <CharCount value={description} max={MAX_BODY_CHARS} />
        </div>

        <div>
          <label htmlFor="deliverable-urls" className="block mb-2">
            <SectionLabel>Artifact links — one per line</SectionLabel>
          </label>
          <textarea
            id="deliverable-urls"
            className={`${TEXTAREA_CLASS} font-mono text-xs`}
            rows={4}
            placeholder={'https://github.com/acme/app/pull/42\nhttps://preview.acme.dev\nhttps://figma.com/file/…'}
            value={urlsRaw}
            disabled={busy}
            onChange={(e) => setUrlsRaw(e.target.value)}
          />
          <div className="flex items-center justify-between mt-2 gap-3">
            <p className="text-xs text-slate-500">
              {parsed.urls.length} of {MAX_URLS} accepted
              {parsed.rejected.length > 0 && (
                <span className="text-amber-400 font-bold">
                  {' '}
                  · {parsed.rejected.length} not a valid link
                </span>
              )}
            </p>
          </div>
          {/* The resolver cannot open these. Saying so here changes what a builder writes:
              it is the difference between pasting a URL and explaining what is at it. */}
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            The arbitrator cannot open links. A URL is treated as a claim that something exists
            at that address, worth what your description makes it worth — so describe what each
            one contains.
          </p>
        </div>
      </div>

      {(localError || submit.error) && (
        <div className="mt-5">
          <Alert tone="danger" label="Not submitted" onDismiss={() => setLocalError(null)}>
            {localError ??
              (submit.error instanceof Error
                ? submit.error.message
                : 'Could not record this submission.')}
          </Alert>
        </div>
      )}

      <Button type="submit" tone="builder" busy={busy} busyLabel={submit.isPending ? 'Recording…' : 'Confirm in your wallet…'} className="w-full mt-6 py-4">
        Submit and mark delivered
      </Button>

      <p className="text-xs text-slate-600 mt-3 text-center leading-relaxed">
        Your submission is saved first, then a transaction marks the work delivered on-chain.
        Nothing is sent to the chain if saving fails.
      </p>
    </form>
  );
}
