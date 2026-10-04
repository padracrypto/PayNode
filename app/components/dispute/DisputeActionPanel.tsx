'use client';

/**
 * The right-hand column of an open dispute: one tab per open resolution path, one call to
 * action per tab.
 *
 * ── WHY TABS ─────────────────────────────────────────────────────────────────
 * A party in a dispute is choosing between routes, not reading about all of them. Stacking
 * every path's explanation one above the other put the button they came for below three
 * screens of prose. Each tab now shows the route's one-sentence summary, its control, and
 * nothing else by default — the facts and, for the AI route, the full rubric sit one click
 * away in an accordion, which is where a party who wants to check the claim will look for it.
 *
 * ── WHAT THIS DOES NOT OWN ───────────────────────────────────────────────────
 * Every control is a slot. The on-chain ones (the arbitrator's ruling, the settlement offer)
 * belong to the page's single guarded `send()`; the off-chain ruling request belongs to
 * <DisputePanel />. This component only decides layout and which tab is showing, and the tab
 * is controlled so the panel can switch to settlement from a declined ruling.
 *
 * Tabs come from `resolutionPaths()`, open ones only. A closed path is named in a footnote
 * with its reason on hover, for the same reason <ResolutionPaths /> keeps closed cards: a party
 * who heard PayNode has an AI arbitrator must be able to see it is off for this project.
 */

import * as React from 'react';
import type { ResolutionPathId, ResolutionPathInfo } from '@/lib/dispute/types';
import { PathIcon, PathIconTile } from './ResolutionPaths';
import { ResolverRubric } from './ResolverRubric';
import { Badge } from './ui';

export type DisputeActionPanelProps = {
  paths: ResolutionPathInfo[];
  tab: ResolutionPathId;
  onTabChange: (id: ResolutionPathId) => void;
  /** One line under the heading — e.g. "You are the designated arbitrator". */
  intro?: React.ReactNode;
  /** A pulsing dot on that tab: an offer on the table, a ruling being prepared. */
  liveTab?: ResolutionPathId;
  /** The control for each tab. A tab without one shows its summary and facts only. */
  content: Partial<Record<ResolutionPathId, React.ReactNode>>;
  /** Below the tabs, outside them — the 30-day backstop, which applies whichever is chosen. */
  footer?: React.ReactNode;
};

/** Short labels for the tab bar; the full title is the tab panel's heading. */
const TAB_LABEL: Record<ResolutionPathId, string> = {
  arbitrator: 'Arbitrator',
  resolver: 'AI Arbitrator',
  settlement: 'Settlement',
};

export function DisputeActionPanel({
  paths,
  tab,
  onTabChange,
  intro,
  liveTab,
  content,
  footer,
}: DisputeActionPanelProps) {
  const open = paths.filter((p) => p.available);
  const closed = paths.filter((p) => !p.available);
  const active = open.find((p) => p.id === tab) ?? open[0];
  const tabRefs = React.useRef<Partial<Record<ResolutionPathId, HTMLButtonElement | null>>>({});

  // Arrow keys move between tabs, per the WAI-ARIA tabs pattern. Focus follows selection,
  // since switching a tab is free — nothing is committed until a button inside is pressed.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = open.findIndex((p) => p.id === active?.id);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = open[(i + step + open.length) % open.length];
    onTabChange(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <section
      aria-label="Resolve this dispute"
      className="bg-[#050B14] border border-amber-900/50 rounded-3xl overflow-hidden"
    >
      <div className="p-5 md:p-6 pb-4 md:pb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 motion-safe:animate-pulse" aria-hidden />
          <h2 className="text-amber-400 font-black text-lg leading-tight">Dispute open</h2>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          {intro ?? 'The escrow is frozen until one of these resolves it.'}
        </p>
      </div>

      {open.length > 1 && (
        <div className="px-5 md:px-6">
          <div
            role="tablist"
            aria-label="Resolution path"
            onKeyDown={onKeyDown}
            className="grid gap-1 p-1 rounded-2xl bg-[#0f172a] border border-slate-800/80"
            style={{ gridTemplateColumns: `repeat(${open.length}, minmax(0, 1fr))` }}
          >
            {open.map((p) => {
              const selected = p.id === active?.id;
              const ai = p.id === 'resolver';
              return (
                <button
                  key={p.id}
                  ref={(el) => {
                    tabRefs.current[p.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`dispute-tab-${p.id}`}
                  aria-selected={selected}
                  aria-controls={`dispute-tabpanel-${p.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onTabChange(p.id)}
                  className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                    selected
                      ? ai
                        ? // Dark glass under the drifting ring: translucent tint, blur, a hairline
                          // top highlight, and a violet/cyan bloom outside.
                          'bg-gradient-to-br from-violet-500/[0.14] to-cyan-400/[0.06] backdrop-blur-md text-white shadow-[0_0_28px_-8px_rgba(139,92,246,0.6),0_0_18px_-10px_rgba(34,211,238,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]'
                        : 'bg-[#050B14] text-white ring-1 ring-slate-700'
                      : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  {ai && <span className={`ai-ring transition-opacity ${selected ? 'opacity-100' : 'opacity-25'}`} />}
                  <span className="flex items-center gap-1.5">
                    <PathIcon id={p.id} className={`w-4 h-4 ${ai ? (selected ? 'text-cyan-200' : 'text-cyan-400/60') : ''}`} />
                    {ai && <span className={`ai-dot ${selected ? '' : 'opacity-50'}`} aria-hidden />}
                  </span>
                  <span className="truncate max-w-full">{TAB_LABEL[p.id]}</span>
                  {/* A sharp hairline marks the selected human route; the AI route has its ring. */}
                  {selected && !ai && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-px w-8 bg-gradient-to-r from-transparent via-slate-300 to-transparent" aria-hidden />
                  )}
                  {liveTab === p.id && (
                    <span className="absolute top-1.5 right-1.5 flex w-2 h-2" aria-label="Activity">
                      <span className="absolute inset-0 rounded-full bg-amber-400 opacity-75 motion-safe:animate-ping" />
                      <span className="relative w-2 h-2 rounded-full bg-amber-400" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {active && (
        <div
          role={open.length > 1 ? 'tabpanel' : undefined}
          id={`dispute-tabpanel-${active.id}`}
          aria-labelledby={open.length > 1 ? `dispute-tab-${active.id}` : undefined}
          className="p-5 md:p-6 pt-5 md:pt-5 space-y-5"
        >
          <div className="flex items-start gap-3">
            <PathIconTile id={active.id} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-white font-black text-base leading-tight">{active.title}</h3>
                {active.id === 'resolver' && <Badge tone="info">Binding</Badge>}
              </div>
              {active.subject && (
                <p className="font-mono text-xs text-slate-500 mt-0.5 break-all">{active.subject}</p>
              )}
              <p className="text-sm text-slate-400 leading-relaxed mt-1.5">{TAGLINE[active.id]}</p>
            </div>
          </div>

          {content[active.id]}

          <Details title={active.id === 'resolver' ? 'How the AI decides' : 'How this path works'}>
            <p>{active.summary}</p>
            {active.id === 'resolver' && (
              <div className="mt-4">
                <p className="mb-3">It weighs, in this order:</p>
                <ResolverRubric />
              </div>
            )}
            {active.facts && (
              <dl className="mt-4 grid gap-y-1.5 gap-x-4 grid-cols-[auto_1fr] text-xs leading-relaxed">
                <Fact term="Who starts it">{active.facts.starts}</Fact>
                <Fact term="How fast">{active.facts.speed}</Fact>
                <Fact term="How binding">{active.facts.binding}</Fact>
              </dl>
            )}
            {/* The contract function, for a party who wants to check the claim rather than take it. */}
            <p className="text-[10px] font-mono text-slate-600 mt-4">
              Path {active.pathNumber} · {active.onchain}
            </p>
          </Details>
        </div>
      )}

      {(closed.length > 0 || footer) && (
        <div className="border-t border-amber-900/30 bg-[#0f172a]/40 p-5 md:px-6 space-y-3">
          {footer}
          {closed.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
              <span>Not available here:</span>
              {closed.map((p) => (
                <span key={p.id} title={p.closedBecause} className="cursor-help">
                  <Badge tone="neutral">{p.title}</Badge>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The one sentence a tab shows by default. Deliberately shorter than `summary`, which is the
 * full description and moves into the accordion — the visible text answers "what happens if
 * I press this", nothing more.
 */
const TAGLINE: Record<ResolutionPathId, string> = {
  arbitrator: 'The arbitrator named at creation reviews the case and splits the escrow.',
  resolver: 'An AI reviews the brief, deliverables and both statements, then issues one binding split.',
  settlement: 'Agree on a split with the other party. It pays out the moment they accept.',
};

/* -------------------------------------------------------------------------- */
/*                                 SUB-PARTS                                  */
/* -------------------------------------------------------------------------- */

/** Native <details>, so it is keyboard- and screen-reader-correct with no state of its own. */
function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-slate-800/80 bg-[#0f172a]/50">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3 text-xs font-bold text-slate-400 hover:text-white transition-colors [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          {title}
        </span>
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </summary>
      <div className="px-4 pb-4 text-sm text-slate-400 leading-relaxed">{children}</div>
    </details>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500 font-bold uppercase tracking-wider text-[10px] pt-px">{term}</dt>
      <dd className="text-slate-400">{children}</dd>
    </>
  );
}
