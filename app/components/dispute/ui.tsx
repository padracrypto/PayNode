'use client';

/**
 * Shared presentation primitives for the dispute-resolution surface.
 *
 * Every class string here is lifted from what app/project/[id]/page.tsx already uses, so the
 * new panels read as part of the same page rather than a bolted-on module: `#050B14` for an
 * inset card on the page's own `#0f172a`/60 shell, `rounded-2xl`/`rounded-3xl`,
 * `border-slate-800/80`, uppercase tracked micro-labels, `font-black` headings.
 *
 * These exist because the alternative — repeating a fourteen-class string in six components —
 * is how the fifth one ends up with `rounded-xl` and a slightly different border. There is no
 * component library in this project and this is not the commit to introduce one.
 */

import * as React from 'react';
import { safeHttpUrl } from '@/lib/dispute/types';

/* -------------------------------------------------------------------------- */
/*                               INPUT CLASSES                                */
/* -------------------------------------------------------------------------- */

/**
 * Exported as strings rather than wrapper components so a caller can still attach whatever a
 * native input needs — `maxLength`, `rows`, a ref — without this module having to re-export
 * the whole HTML surface.
 */
export const INPUT_CLASS =
  'w-full bg-[#0f172a] p-4 rounded-xl border border-slate-700/50 text-white text-sm ' +
  'placeholder:text-slate-600 outline-none focus:border-blue-500/50 focus:ring-1 ' +
  'focus:ring-blue-500/50 transition-all disabled:opacity-50';

export const TEXTAREA_CLASS = `${INPUT_CLASS} resize-none leading-relaxed`;

/* -------------------------------------------------------------------------- */
/*                                  LAYOUT                                    */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = '',
  tone = 'neutral',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'neutral' | 'dispute' | 'builder' | 'client' | 'danger';
}) {
  const border = {
    neutral: 'border-slate-800/80',
    dispute: 'border-amber-900/50',
    builder: 'border-emerald-900/40',
    client: 'border-blue-900/40',
    danger: 'border-red-900/50',
  }[tone];

  return (
    <div className={`bg-[#050B14] border ${border} rounded-3xl p-6 md:p-8 ${className}`}>
      {children}
    </div>
  );
}

/** The uppercase micro-label used above every stat on this page. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{children}</p>
  );
}

export function PanelHeading({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h2 className="text-xl font-black text-white leading-tight">{title}</h2>
        {subtitle && <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  BADGES                                    */
/* -------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'danger' | 'builder' | 'client';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  info: 'text-blue-300 bg-blue-500/10 border-blue-500/25',
  good: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  warn: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  danger: 'text-red-400 bg-red-500/10 border-red-500/25',
  builder: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  client: 'text-blue-300 bg-blue-500/10 border-blue-500/25',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider border px-2 py-0.5 rounded-md ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A message block. `tone` carries the meaning, but never alone: each tone ships a short
 * `label` that names what kind of message this is, so the distinction survives for a
 * colourblind reader and in a screenshot printed in greyscale.
 */
export function Alert({
  tone,
  label,
  children,
  onDismiss,
}: {
  tone: Tone;
  label: string;
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`rounded-xl border p-4 text-sm ${TONE_CLASS[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black uppercase tracking-wider text-[10px] mb-1 opacity-80">
            {label}
          </p>
          <div className="text-slate-300 leading-relaxed break-words">{children}</div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={`inline-block rounded-full border-2 border-slate-700 border-t-blue-400 animate-spin ${className}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*                                   TIME                                     */
/* -------------------------------------------------------------------------- */

/**
 * Absolute timestamp, in the reader's own locale and timezone.
 *
 * Deliberately absolute rather than "3 days ago". This is an evidentiary record that a
 * resolver has already weighed against a blockchain timeline; when a party is arguing about
 * whether something was submitted before a deadline, a rounded relative string is exactly the
 * wrong affordance. The relative form appears only as a `title` for quick scanning.
 */
export function Timestamp({ iso, className = '' }: { iso: string; className?: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return <span className={className}>unknown</span>;
  }
  return (
    <time dateTime={iso} title={iso} className={className}>
      {date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </time>
  );
}

/* -------------------------------------------------------------------------- */
/*                              EVIDENCE LINKS                                */
/* -------------------------------------------------------------------------- */

/**
 * Render a party's cited links.
 *
 * Two things this does that a plain `.map()` would not:
 *
 *   - Re-validates every URL through `safeHttpUrl` at RENDER time, not just at submit. The
 *     rows come out of Postgres, and the column has no protocol constraint — a row inserted
 *     by an older build, by a direct PostgREST call, or by a future migration that forgets the
 *     check would otherwise become a `javascript:` link in the counterparty's browser. A link
 *     that fails is shown as inert text so the reader still knows what was cited.
 *   - `rel="noopener noreferrer nofollow"`. `noopener` because the opened tab must not get a
 *     handle on this window; `nofollow` because these are adversarial submissions and we are
 *     not lending them ranking.
 */
export function EvidenceLinks({
  urls,
  emptyLabel = 'No links cited.',
}: {
  urls: string[] | null | undefined;
  emptyLabel?: string;
}) {
  if (!urls || urls.length === 0) {
    return <p className="text-slate-600 text-sm italic">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-1.5">
      {urls.map((raw, i) => {
        const href = safeHttpUrl(raw);
        return (
          <li key={`${i}-${raw}`} className="flex items-start gap-2 text-sm">
            <span className="text-slate-600 select-none mt-0.5 shrink-0">↗</span>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-blue-400 hover:text-blue-300 hover:underline break-all"
              >
                {raw}
              </a>
            ) : (
              <span
                className="text-slate-500 break-all line-through"
                title="This link was not a valid http(s) URL and has not been made clickable."
              >
                {raw}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  BUTTONS                                   */
/* -------------------------------------------------------------------------- */

const BUTTON_TONE = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_20px_-5px_rgba(37,99,235,0.4)]',
  builder:
    'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]',
  dispute: 'bg-amber-600 hover:bg-amber-500 text-white shadow-[0_0_15px_rgba(217,119,6,0.3)]',
  danger: 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.3)]',
  ghost: 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white',
} as const;

/**
 * The page's button, with a pending state that keeps its own width.
 *
 * `busy` renders a spinner AND keeps the label, rather than swapping the text for "Loading…".
 * Swapping is what the existing page does via `txStatus` and it makes the button jump width
 * mid-transaction; on a settlement button that a user is nervous about pressing, movement at
 * the moment of the click reads as something having gone wrong.
 */
export function Button({
  tone = 'primary',
  busy = false,
  busyLabel,
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: keyof typeof BUTTON_TONE;
  busy?: boolean;
  busyLabel?: string;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 py-3 px-5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none ${BUTTON_TONE[tone]} ${className}`}
    >
      {busy && <Spinner className="w-4 h-4 border-white/30 border-t-white" />}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </button>
  );
}

/** Low-emphasis inline action, matching the page's underlined text buttons. */
export function LinkButton({
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`text-xs font-bold text-slate-500 hover:text-white transition-colors underline decoration-slate-700 underline-offset-4 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*                               CHARACTER COUNT                              */
/* -------------------------------------------------------------------------- */

/**
 * Remaining-characters hint, shown only once it starts to matter.
 *
 * A permanent "0 / 20000" under every textarea is noise; the bound exists because the resolver
 * truncates at the same number, so the only moment it is worth mentioning is when a party is
 * approaching it and would otherwise lose the tail of their argument silently.
 */
export function CharCount({ value, max }: { value: string; max: number }) {
  const used = value.length;
  if (used < max * 0.8) return null;
  const over = used > max;
  return (
    <p className={`text-xs font-bold mt-1.5 ${over ? 'text-red-400' : 'text-amber-400'}`}>
      {used.toLocaleString()} / {max.toLocaleString()} characters
      {over && ' — the resolver will not read past the limit.'}
    </p>
  );
}
