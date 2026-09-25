'use client';

/**
 * The evidence claim centre: where each party files their argument and reads the other's.
 *
 * ── WHY BOTH SIDES ARE ALWAYS VISIBLE ────────────────────────────────────────
 * RLS makes every claim on a project readable by both parties (and by a designated
 * arbitrator), so there is no hidden-filing mode to build and no point pretending there is.
 * Showing it is the better design anyway: a party who can read the accusation against them can
 * answer it specifically, which is what produces a record worth ruling on. It also means
 * neither side can claim afterwards that they did not know what was alleged.
 *
 * Two views over the same rows. THREADED is chronological across both parties and reads as the
 * argument actually unfolded — it is the default because that is the order the resolver read
 * them in. SIDE BY SIDE groups by party, which is how you compare two positions on one point.
 * Neither is a different query.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
 * It never decides whether the viewer is the client or the builder. That comes in as `role`,
 * derived from the chain by the panel above. RLS re-derives it server-side with
 * `project_role()` and rejects a mismatch, so a client physically cannot file a statement
 * attributed to the builder — this component's `role` is a declaration the database checks,
 * not a claim it trusts.
 */

import * as React from 'react';
import { useDisputeClaims, useFileClaim } from '@/lib/dispute/hooks';
import {
  MAX_BODY_CHARS,
  MAX_URLS,
  parseUrlList,
  type DisputeClaimRow,
  type DisputeRole,
  type DisputeStage,
  type ViewerRole,
} from '@/lib/dispute/types';
import {
  Alert,
  Badge,
  Button,
  CharCount,
  EvidenceLinks,
  SectionLabel,
  Spinner,
  TEXTAREA_CLASS,
  Timestamp,
} from './ui';

type View = 'threaded' | 'sides';

export function ClaimCenter({
  projectRowId,
  stage,
  role,
  wallet,
  clientLabel,
  builderLabel,
  /** False once the dispute has been ruled on or settled — the record becomes read-only. */
  canFile,
}: {
  projectRowId: number;
  stage: DisputeStage;
  role: ViewerRole;
  wallet: string | undefined;
  clientLabel: string;
  builderLabel: string;
  canFile: boolean;
}) {
  const [view, setView] = React.useState<View>('threaded');
  const { data, isPending, isError, error } = useDisputeClaims(projectRowId, stage);

  const claims = data ?? [];
  const clientClaims = claims.filter((c) => c.role === 'client');
  const builderClaims = claims.filter((c) => c.role === 'builder');

  /** Only an actual party files. An arbitrator reads the record; they do not argue in it. */
  const filingRole: DisputeRole | null =
    role === 'client' || role === 'builder' ? role : null;

  const mine = filingRole ? claims.filter((c) => c.role === filingRole) : [];

  return (
    <div className="space-y-6">
      {/* ------------------------------- FILING ------------------------------- */}
      {canFile && filingRole && wallet && (
        <ClaimForm
          projectRowId={projectRowId}
          role={filingRole}
          wallet={wallet}
          alreadyFiled={mine.length}
        />
      )}

      {canFile && !filingRole && (
        <Alert tone="neutral" label="Read only">
          You can read this dispute&apos;s record but cannot file in it. Only the client and the
          builder file statements.
        </Alert>
      )}

      {/* ------------------------------- RECORD ------------------------------- */}
      <div>
        <div className="flex items-center justify-between gap-4 mb-4">
          <SectionLabel>
            The record · {claims.length} {claims.length === 1 ? 'statement' : 'statements'}
          </SectionLabel>

          {claims.length > 1 && (
            <div
              role="tablist"
              aria-label="Claim view"
              className="flex bg-[#0f172a] border border-slate-800 rounded-lg p-0.5"
            >
              <ViewTab active={view === 'threaded'} onClick={() => setView('threaded')}>
                Threaded
              </ViewTab>
              <ViewTab active={view === 'sides'} onClick={() => setView('sides')}>
                Side by side
              </ViewTab>
            </div>
          )}
        </div>

        {isPending ? (
          <div className="flex items-center gap-3 text-slate-500 text-sm">
            <Spinner /> Loading the record…
          </div>
        ) : isError ? (
          <p className="text-sm text-red-400">
            Could not load the dispute record
            {error instanceof Error ? `: ${error.message}` : '.'}
          </p>
        ) : claims.length === 0 ? (
          <div className="bg-[#0f172a] border border-slate-800/80 rounded-2xl p-6 text-center">
            <p className="text-sm text-slate-400 leading-relaxed">
              No statements have been filed yet. The arbitrator will rule on the brief, the
              deliverables and the blockchain timeline alone unless someone files.
            </p>
          </div>
        ) : view === 'threaded' || claims.length <= 1 ? (
          <ol className="space-y-3">
            {claims.map((claim) => (
              <ClaimEntry
                key={claim.id}
                claim={claim}
                isMine={!!wallet && claim.author.toLowerCase() === wallet.toLowerCase()}
                label={claim.role === 'client' ? clientLabel : builderLabel}
              />
            ))}
          </ol>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ClaimColumn
              heading="Client"
              label={clientLabel}
              tone="client"
              claims={clientClaims}
              wallet={wallet}
            />
            <ClaimColumn
              heading="Builder"
              label={builderLabel}
              tone="builder"
              claims={builderClaims}
              wallet={wallet}
            />
          </div>
        )}
      </div>

      {/* A one-sided record is the situation the evidence window exists to prevent, so say so
          where the gap is visible rather than only in the error from the request button. */}
      {claims.length > 0 && (clientClaims.length === 0 || builderClaims.length === 0) && canFile && (
        <Alert tone="info" label="One side only">
          {clientClaims.length === 0 ? 'The client' : 'The builder'} has not filed a statement yet.
          A ruling can be requested once both parties have filed, or after the evidence window
          closes — whichever comes first.
        </Alert>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   FILING                                   */
/* -------------------------------------------------------------------------- */

function ClaimForm({
  projectRowId,
  role,
  wallet,
  alreadyFiled,
}: {
  projectRowId: number;
  role: DisputeRole;
  wallet: string;
  alreadyFiled: number;
}) {
  // Collapsed once this party has already filed. Supplementing a statement is allowed — the
  // table takes any number of rows per party and the resolver reads them all in order — but it
  // should not be the default affordance, or a dispute turns into a thread of restatements.
  const [open, setOpen] = React.useState(alreadyFiled === 0);
  const [body, setBody] = React.useState('');
  const [urlsRaw, setUrlsRaw] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);

  const file = useFileClaim();
  const parsed = React.useMemo(() => parseUrlList(urlsRaw), [urlsRaw]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const trimmed = body.trim();
    if (trimmed.length < 40) {
      setLocalError(
        'Write at least a couple of sentences. A statement too short to explain your position ' +
          'is worth very little when the escrow is being divided.',
      );
      return;
    }
    if (trimmed.length > MAX_BODY_CHARS) {
      setLocalError('Your statement is longer than the arbitrator will read. Trim it first.');
      return;
    }
    if (parsed.rejected.length > 0) {
      setLocalError(
        `These lines are not valid http(s) links: ${parsed.rejected.join(', ')}. Remove or fix them.`,
      );
      return;
    }

    try {
      await file.mutateAsync({
        projectRowId,
        author: wallet,
        role,
        body: trimmed,
        evidenceUrls: parsed.urls,
      });
      setBody('');
      setUrlsRaw('');
      setOpen(false);
    } catch {
      // Rendered from `file.error` below.
    }
  };

  if (!open) {
    return (
      <div className="bg-[#0f172a] border border-slate-800/80 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-white font-bold text-sm">
            You have filed {alreadyFiled} {alreadyFiled === 1 ? 'statement' : 'statements'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Add another only if you have something new to put on the record.
          </p>
        </div>
        <Button tone="ghost" onClick={() => setOpen(true)} className="shrink-0">
          Add a statement
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-[#0f172a] border border-slate-800/80 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Badge tone={role === 'client' ? 'client' : 'builder'}>
          Filing as the {role}
        </Badge>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="claim-body" className="block mb-2">
            <SectionLabel>Your statement</SectionLabel>
          </label>
          <textarea
            id="claim-body"
            className={TEXTAREA_CLASS}
            rows={7}
            disabled={file.isPending}
            placeholder={
              role === 'client'
                ? 'What in the agreed brief was not delivered? Point at the specific requirement and at what was submitted against it.'
                : 'What did you deliver against the brief? Point at the specific requirement each artifact satisfies.'
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <CharCount value={body} max={MAX_BODY_CHARS} />
        </div>

        <div>
          <label htmlFor="claim-urls" className="block mb-2">
            <SectionLabel>Evidence links — one per line</SectionLabel>
          </label>
          <textarea
            id="claim-urls"
            className={`${TEXTAREA_CLASS} font-mono text-xs`}
            rows={3}
            disabled={file.isPending}
            placeholder={'https://github.com/acme/app/pull/42/files\nhttps://drive.example.com/screenshot.png'}
            value={urlsRaw}
            onChange={(e) => setUrlsRaw(e.target.value)}
          />
          <p className="text-xs text-slate-500 mt-2">
            {parsed.urls.length} of {MAX_URLS} accepted
            {parsed.rejected.length > 0 && (
              <span className="text-amber-400 font-bold">
                {' '}
                · {parsed.rejected.length} not a valid link
              </span>
            )}
          </p>
          {/* Screenshots are the commonest evidence in a delivery dispute and there is no
              upload path in this build, so say where to put them rather than leaving a user
              to discover that a file cannot be attached. */}
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            Screenshots need to be hosted somewhere the link resolves publicly — the arbitrator
            cannot open a file from your machine, and cannot open these links at all: it weighs a
            URL by what your statement says is at it. Describe each one.
          </p>
        </div>
      </div>

      {(localError || file.error) && (
        <div className="mt-4">
          <Alert tone="danger" label="Not filed" onDismiss={() => setLocalError(null)}>
            {localError ??
              (file.error instanceof Error ? file.error.message : 'Could not file this statement.')}
          </Alert>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-3 mt-5">
        {alreadyFiled > 0 && (
          <Button
            type="button"
            tone="ghost"
            onClick={() => setOpen(false)}
            disabled={file.isPending}
            className="sm:flex-1"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          tone="primary"
          busy={file.isPending}
          busyLabel="Filing…"
          className="sm:flex-[2]"
        >
          File statement
        </Button>
      </div>

      <p className="text-xs text-slate-600 mt-3 leading-relaxed">
        Filed statements are visible to the other party immediately and cannot be edited or
        withdrawn. Say what you mean the first time.
      </p>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  READING                                   */
/* -------------------------------------------------------------------------- */

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
        active ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function ClaimEntry({
  claim,
  isMine,
  label,
}: {
  claim: DisputeClaimRow;
  isMine: boolean;
  label: string;
}) {
  const tone = claim.role === 'client' ? 'client' : 'builder';
  // A left accent border keys the party without tinting the whole card, which would make a long
  // thread read as two competing background colours rather than one record.
  const accent = claim.role === 'client' ? 'border-l-blue-600' : 'border-l-emerald-600';

  return (
    <li
      className={`bg-[#0f172a] border border-slate-800/80 border-l-2 ${accent} rounded-2xl rounded-l-lg p-5`}
    >
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={tone}>{claim.role}</Badge>
          <span className="text-sm font-bold text-slate-300 truncate">{label}</span>
          {isMine && <Badge tone="neutral">You</Badge>}
        </div>
        <Timestamp iso={claim.created_at} className="text-xs text-slate-500" />
      </div>

      <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{claim.body}</p>

      {claim.evidence_urls && claim.evidence_urls.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-wider mb-2">
            Cited evidence
          </p>
          <EvidenceLinks urls={claim.evidence_urls} />
        </div>
      )}
    </li>
  );
}

function ClaimColumn({
  heading,
  label,
  tone,
  claims,
  wallet,
}: {
  heading: string;
  label: string;
  tone: 'client' | 'builder';
  claims: DisputeClaimRow[];
  wallet: string | undefined;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Badge tone={tone}>{heading}</Badge>
        <span className="text-xs text-slate-500 truncate">{label}</span>
      </div>

      {claims.length === 0 ? (
        <div className="bg-[#0f172a] border border-slate-800/80 border-dashed rounded-2xl p-5">
          <p className="text-sm text-slate-500 italic">
            This party has filed no statement.{' '}
            <span className="text-slate-600">
              That is not an automatic loss — the rest of the record is still ruled on.
            </span>
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {claims.map((claim) => (
            <ClaimEntry
              key={claim.id}
              claim={claim}
              isMine={!!wallet && claim.author.toLowerCase() === wallet.toLowerCase()}
              label={label}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
