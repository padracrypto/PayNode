'use client';

/**
 * The full submission history, oldest first.
 *
 * Visible to BOTH parties and to a designated arbitrator — RLS decides that, not this
 * component. It is rendered in every stage from Delivered onward, including once a dispute is
 * open and after it has settled, because the record of what was shipped is the thing an
 * arbitration is about and blanking it at the moment of the dispute is the exact failure the
 * page's `deliveryOnRecord` comment already documents for the legacy single-delivery fields.
 *
 * Ordering is ascending to match the order the resolver read them in (`gatherCaseFile` orders
 * ascending too), so a party reading the reasoning can follow it down this list.
 */

import { useDeliverables } from '@/lib/dispute/hooks';
import type { DeliverableRow, DisputeStage } from '@/lib/dispute/types';
import { Badge, EvidenceLinks, SectionLabel, Spinner, Timestamp } from './ui';

export function DeliverableHistory({
  projectRowId,
  stage,
  /** Rendered when the builder has submitted nothing at all. */
  emptyHint,
}: {
  projectRowId: number | undefined;
  stage: DisputeStage;
  emptyHint?: string;
}) {
  const { data, isPending, isError, error } = useDeliverables(projectRowId, stage);

  if (isPending) {
    return (
      <div className="flex items-center gap-3 text-slate-500 text-sm">
        <Spinner /> Loading submissions…
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-red-400">
        Could not load the submission history
        {error instanceof Error ? `: ${error.message}` : '.'}
      </p>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic leading-relaxed">
        {emptyHint ?? 'No deliverables have been submitted for this project.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>
          Submission history · {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
        </SectionLabel>
      </div>

      <ol className="space-y-3">
        {rows.map((row, i) => (
          <DeliverableEntry key={row.id} row={row} index={i + 1} latest={i === rows.length - 1} />
        ))}
      </ol>
    </div>
  );
}

function DeliverableEntry({
  row,
  index,
  latest,
}: {
  row: DeliverableRow;
  index: number;
  latest: boolean;
}) {
  return (
    <li className="bg-[#0f172a] border border-slate-800/80 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-black text-slate-600">#{index}</span>
            <h4 className="text-white font-bold text-sm truncate">
              {row.title || 'Untitled submission'}
            </h4>
            {latest && <Badge tone="info">Latest</Badge>}
          </div>
          <Timestamp iso={row.created_at} className="text-xs text-slate-500" />
        </div>

        {/* Revision 0 is the original submission, so the chip is only informative from 1 up. */}
        {row.revision_index != null && row.revision_index > 0 && (
          <Badge tone="warn">Revision {row.revision_index}</Badge>
        )}
      </div>

      {row.description && (
        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap mb-4">
          {row.description}
        </p>
      )}

      <div>
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-wider mb-2">
          Artifacts
        </p>
        <EvidenceLinks urls={row.artifact_urls} emptyLabel="No artifacts were attached." />
      </div>
    </li>
  );
}
