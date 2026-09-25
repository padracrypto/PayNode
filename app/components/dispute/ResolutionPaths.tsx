'use client';

/**
 * The three routes out of a dispute, rendered for one specific project.
 *
 * ── WHY A COMPONENT AND NOT PROSE ────────────────────────────────────────────
 * Three surfaces have to answer "who decides this, and how fast" about the same escrow: the
 * warning modal before a dispute exists, the page's Disputed block once it does, and the
 * panel's ruling request inside it. Each of them used to carry its own
 * `hasArbitrator ? … : hasResolver ? … : …` paragraph, which is three chances for one screen to
 * offer a route another screen calls closed. `resolutionPaths()` in lib/dispute/types.ts is now
 * the single answer and this is its only renderer.
 *
 * ── CLOSED PATHS ARE STILL SHOWN ─────────────────────────────────────────────
 * A project has exactly one adjudicator, so on every project one of PATH 1 / PATH 2 is closed,
 * and hiding it is the worse option: a party who has heard PayNode has an AI arbitrator and
 * cannot find it has no way to tell whether it is off for their project or the page failed to
 * offer it. The closed card names the reason and drops the three facts, which keeps the open
 * routes visually dominant without pretending the other does not exist.
 *
 * PATH 4 — the 30-day permissionless breaker — is not here, for the reason documented on
 * `resolutionPaths()`: it is a deadline, not a choice. Each caller quotes it in its own terms
 * from `DISPUTE_WINDOWS.staleDays`, next to the countdown or the button that fires it.
 */

import * as React from 'react';
import type { ResolutionPathInfo, ResolutionPathId } from '@/lib/dispute/types';
import { Badge } from './ui';

export type ResolutionPathsProps = {
  paths: ResolutionPathInfo[];
  /**
   * The route this dispute is actually travelling right now, if any — a ruling requested, an
   * offer on the table. Marked "In progress" so the overview agrees with the controls beside
   * it instead of reading as a menu of things nobody has started.
   */
  activePathId?: ResolutionPathId;
  /** Per-path pointer to where the control for it lives, e.g. "Propose a split below". */
  hints?: Partial<Record<ResolutionPathId, React.ReactNode>>;
};

export function ResolutionPaths({ paths, activePathId, hints }: ResolutionPathsProps) {
  return (
    <ul className="space-y-3">
      {paths.map((path) => (
        <li key={path.id}>
          <PathCard path={path} inProgress={path.id === activePathId} hint={hints?.[path.id]} />
        </li>
      ))}
    </ul>
  );
}

function PathCard({
  path,
  inProgress,
  hint,
}: {
  path: ResolutionPathInfo;
  inProgress: boolean;
  hint: React.ReactNode;
}) {
  const open = path.available;

  return (
    <div
      className={`rounded-2xl border p-4 md:p-5 ${
        open
          ? 'bg-[#050B14] border-slate-800'
          : // Closed routes sit flatter and dimmer than open ones, so the difference survives a
            // greyscale screenshot and does not rely on the badge colour alone.
            'bg-[#050B14]/40 border-slate-800/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <PathIcon id={path.id} muted={!open} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className={`font-bold text-sm ${open ? 'text-white' : 'text-slate-500'}`}>
                {path.title}
              </p>
              {path.subject && (
                <p className="font-mono text-xs text-slate-500 mt-0.5 break-all">{path.subject}</p>
              )}
            </div>

            {inProgress ? (
              <Badge tone="warn">In progress</Badge>
            ) : open ? (
              <Badge tone="good">Available</Badge>
            ) : (
              <Badge tone="neutral">Not available</Badge>
            )}
          </div>

          <p
            className={`text-sm leading-relaxed mt-2 ${open ? 'text-slate-400' : 'text-slate-600'}`}
          >
            {path.summary}
          </p>

          {!open && path.closedBecause && (
            <p className="text-xs text-slate-500 leading-relaxed mt-2">
              <span className="font-bold text-slate-400">Why not: </span>
              {path.closedBecause}
            </p>
          )}

          {open && path.facts && (
            <dl className="mt-4 grid gap-y-2 gap-x-4 sm:grid-cols-[auto_1fr] text-xs leading-relaxed">
              <Fact term="Who starts it">{path.facts.starts}</Fact>
              <Fact term="How fast">{path.facts.speed}</Fact>
              <Fact term="How binding">{path.facts.binding}</Fact>
            </dl>
          )}

          {open && hint && (
            <p className="text-xs text-blue-300/90 leading-relaxed mt-3">{hint}</p>
          )}

          {/* The contract function, for a party who wants to check the claim rather than take
              it. Quiet by design: this is a receipt, not a feature. */}
          <p className="text-[10px] font-mono text-slate-600 mt-3">
            Path {path.pathNumber} · {path.onchain}
          </p>
        </div>
      </div>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500 font-bold uppercase tracking-wider text-[10px] sm:pt-px">
        {term}
      </dt>
      <dd className="text-slate-400 sm:mt-0 -mt-1.5">{children}</dd>
    </>
  );
}

/**
 * One glyph per route, so the list is scannable before it is read: a gavel-ish scale for the
 * human arbitrator, a chip for the automatic one, a handshake-ish pair of arrows for a mutual
 * settlement. `aria-hidden` throughout — every one of them is redundant with the title beside
 * it, and announcing "icon" three times adds nothing for a screen reader.
 */
function PathIcon({ id, muted }: { id: ResolutionPathId; muted: boolean }) {
  const d = {
    arbitrator:
      'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z',
    resolver:
      'M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z',
    settlement:
      'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  }[id];

  return (
    <div
      className={`w-9 h-9 shrink-0 rounded-xl border flex items-center justify-center ${
        muted ? 'bg-slate-500/5 border-slate-800/60' : 'bg-slate-500/10 border-slate-700/60'
      }`}
    >
      <svg
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
        className={`w-5 h-5 ${muted ? 'text-slate-600' : 'text-slate-300'}`}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </div>
  );
}
