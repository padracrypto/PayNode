'use client';

/**
 * The three routes out of a dispute, rendered for one specific project.
 *
 * ── WHY A COMPONENT AND NOT PROSE ────────────────────────────────────────────
 * Two surfaces have to answer "who decides this, and how fast" about the same escrow: the
 * warning modal before a dispute exists, and <DisputeActionPanel />'s tabs once it does. Each
 * used to carry its own `hasArbitrator ? … : hasResolver ? … : …` paragraph, which is two
 * chances for one screen to offer a route another screen calls closed. `resolutionPaths()` in
 * lib/dispute/types.ts is now the single answer: this renders it as the modal's full cards,
 * and the action panel renders the same list as tabs.
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
import type { ResolutionPathId, ResolutionPathInfo } from '@/lib/dispute/types';
import { Badge } from './ui';

export type ResolutionPathsProps = {
  paths: ResolutionPathInfo[];
};

export function ResolutionPaths({ paths }: ResolutionPathsProps) {
  return (
    <ul className="space-y-2">
      {paths.map((path) => (
        <li key={path.id}>
          <PathCard path={path} />
        </li>
      ))}
    </ul>
  );
}

function PathCard({ path }: { path: ResolutionPathInfo }) {
  const open = path.available;

  return (
    <div
      className={`rounded-2xl border p-4 ${
        open
          ? 'bg-[#050B14] border-slate-800'
          : // Closed routes sit flatter and dimmer than open ones, so the difference survives a
            // greyscale screenshot and does not rely on the badge colour alone.
            'bg-[#050B14]/40 border-slate-800/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 pt-1">
          <PathTag
            id={path.id}
            className={!open ? 'text-slate-600' : path.id === 'resolver' ? 'text-cyan-300' : 'text-slate-300'}
          />
        </div>

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

            {open ? (
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
            <dl className="mt-3 grid gap-y-1.5 gap-x-4 sm:grid-cols-[auto_1fr] text-xs leading-relaxed">
              <Fact term="Who starts it">{path.facts.starts}</Fact>
              <Fact term="How fast">{path.facts.speed}</Fact>
              <Fact term="How binding">{path.facts.binding}</Fact>
            </dl>
          )}

          {/* The contract function, for a party who wants to check the claim rather than take
              it. Quiet by design: this is a receipt, not a feature. */}
          <p className="text-[10px] font-mono text-slate-600 mt-2">
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
 * Each route's mark is a code-style tag rather than a picture — `[ 3RD ]` for the named human
 * arbitrator, `[ AI ]` for the automatic one, `[ P2P ]` for a mutual settlement. Pictograms
 * (gavels, chips, handshakes) read as stickers on a screen that is moving money; a monospace
 * tag reads as a protocol label and still makes the list scannable before it is read. Colour
 * comes from the caller via `currentColor`, so one tag serves open, closed and selected states.
 * `aria-hidden`: it is redundant with the title beside it.
 */
const PATH_TAG: Record<ResolutionPathId, string> = {
  arbitrator: '3RD',
  resolver: 'AI',
  settlement: 'P2P',
};

export function PathTag({ id, className = '' }: { id: ResolutionPathId; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center whitespace-pre font-mono text-[10px] font-bold leading-none tracking-[0.12em] ${className}`}
    >
      <span className="opacity-40">[ </span>
      {PATH_TAG[id]}
      <span className="opacity-40"> ]</span>
    </span>
  );
}
