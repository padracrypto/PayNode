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
import { Handshake, Scale, Sparkles, type LucideIcon } from 'lucide-react';
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
        <PathIconTile id={path.id} muted={!open} />

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
 * One thin-line glyph per route, so the list is scannable before it is read: sparkles for the
 * AI arbitrator, scales for the named human arbitrator, a handshake for a mutual settlement.
 * Stroke 1.5 throughout, to sit with the page's hairline borders rather than shout over them.
 * Colour and size come from the caller (`currentColor`, `className`), so one glyph serves open,
 * closed and selected states. `aria-hidden`: it is redundant with the title beside it.
 */
const PATH_GLYPH: Record<ResolutionPathId, LucideIcon> = {
  arbitrator: Scale,
  resolver: Sparkles,
  settlement: Handshake,
};

export function PathIcon({ id, className = 'w-4 h-4' }: { id: ResolutionPathId; className?: string }) {
  const Glyph = PATH_GLYPH[id];
  return <Glyph aria-hidden="true" strokeWidth={1.5} className={`shrink-0 ${className}`} />;
}

/**
 * The glyph on a 36px tile, for card and panel headers. The AI route's tile carries the same
 * signature as its tab — dark violet/cyan glass under the drifting `.ai-ring` — so the
 * automatic path reads as a different kind of thing from the human ones before a word is read.
 */
export function PathIconTile({ id, muted = false }: { id: ResolutionPathId; muted?: boolean }) {
  const ai = id === 'resolver' && !muted;
  return (
    <span
      aria-hidden="true"
      className={`relative w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${
        ai
          ? 'bg-gradient-to-br from-violet-500/20 to-cyan-400/10 shadow-[0_0_18px_-4px_rgba(139,92,246,0.55)]'
          : muted
            ? 'border border-slate-800/60 bg-slate-500/5'
            : 'border border-slate-700/60 bg-slate-500/10'
      }`}
    >
      {ai && <span className="ai-ring" />}
      <PathIcon
        id={id}
        className={`w-[18px] h-[18px] ${ai ? 'text-cyan-200' : muted ? 'text-slate-600' : 'text-slate-300'}`}
      />
    </span>
  );
}
