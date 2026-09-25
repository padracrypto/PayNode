'use client';

/**
 * The AI verdict, and the button that enforces it on-chain.
 *
 * ── WHAT IT RELAYS ───────────────────────────────────────────────────────────
 * `resolveDisputeWithAttestation(projectId, builderBps, deadline, signature)`. The contract
 * accepts this call from ANY address — that is the whole point of the attestation design, so
 * neither party depends on the resolver holding gas — which is why the button is offered to
 * both parties rather than only to whoever the ruling favoured. The resolver key itself never
 * transacts; a key that cannot transact is a smaller target.
 *
 * ── PRECISION ────────────────────────────────────────────────────────────────
 * `projectId` and `deadline` are converted to BigInt from whatever PostgREST handed back
 * (int8 arrives as a JSON number today, but the representation is not ours to rely on and both
 * values are inside a signed digest). `builderBps` stays a JS number because the parameter is a
 * uint16 and the column is a bounded integer. Every money figure on this card is computed in
 * wei by `splitEscrow`, using the project's SNAPSHOTTED `feeBps` — never a float, and never the
 * live global fee.
 *
 * ── THE PRE-FLIGHT CHECK ─────────────────────────────────────────────────────
 * Before enabling the button this card recovers the signer from the stored signature locally and
 * compares it with `resolverFor(projectId)` — the key the contract will actually verify against.
 * Pure local cryptography, no RPC, no key material. It exists because the one thing worse than
 * no ruling is a ruling that looks executable and reverts with `BadAttestation` after the user
 * has paid gas and believed the dispute was over. The commonest cause is not corruption but
 * epoch drift: the contract checks `resolverAt[p.resolverEpoch]`, the key live when the client
 * FUNDED, so a resolver rotation leaves older projects pinned to the previous key.
 *
 * ── THE EXPIRY DEAD END ──────────────────────────────────────────────────────
 * An attestation carries a deadline (7 days by default). Past it the contract reverts with
 * `AttestationExpired` — and the pipeline cannot issue a replacement, because its idempotency
 * is unconditional: `replay()` returns the stored `signed` row forever, so re-requesting hands
 * back the same expired signature. There is no refresh path in the backend today. The card
 * therefore does not offer a retry it cannot honour; it names the two routes that do still
 * work (mutual settlement, or the 30-day breaker) and starts warning while the deadline is
 * still days away.
 */

import * as React from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { recoverTypedDataAddress, zeroAddress } from 'viem';
import {
  escrowContract,
  formatCountdown,
  formatUSDC,
  resolutionTypedData,
  describeTxError,
  isUserRejection,
  txUrl,
} from '@/lib/paynode';
import {
  bpsToPercent,
  toBigInt,
  type DisputeResolutionRow,
  type EvidenceFinding,
} from '@/lib/dispute/types';
import { SplitMeter } from './SplitMeter';
import { Alert, Badge, Button, Card, SectionLabel, Spinner, Timestamp, type Tone } from './ui';

/** How long before the deadline to start warning. Below this, the countdown turns urgent. */
const EXPIRY_WARNING_SECONDS = 48 * 60 * 60;

type Verification =
  | { state: 'checking' }
  | { state: 'ok'; signer: string }
  | { state: 'mismatch'; recovered: string; expected: string }
  | { state: 'unverifiable'; detail: string };

export function VerdictCard({
  resolution,
  projectId,
  totalWei,
  feeBps,
  /** `resolverFor(projectId)` — the epoch key the contract verifies against. */
  expectedSigner,
  chainNow,
  clientLabel,
  builderLabel,
  guardNetwork,
  onSettled,
}: {
  resolution: DisputeResolutionRow;
  projectId: bigint;
  totalWei: bigint | undefined;
  feeBps: number | undefined;
  expectedSigner: string | undefined;
  chainNow: bigint;
  clientLabel: string;
  builderLabel: string;
  guardNetwork: () => Promise<boolean>;
  onSettled: () => void;
}) {
  const builderBps = resolution.builder_bps;
  const signature = resolution.signature;
  const deadline =
    resolution.attestation_deadline != null ? toBigInt(resolution.attestation_deadline) : null;

  const expired = deadline !== null && deadline <= chainNow;
  const secondsLeft = deadline !== null ? Number(deadline - chainNow) : 0;

  /* ---------------------------- local verification ---------------------------- */

  const [verification, setVerification] = React.useState<Verification>({ state: 'checking' });

  React.useEffect(() => {
    if (builderBps == null || !signature || deadline === null) {
      setVerification({ state: 'unverifiable', detail: 'The stored ruling is incomplete.' });
      return;
    }
    if (!expectedSigner || expectedSigner === zeroAddress) {
      // `resolverFor` has not resolved yet, or is zero. Zero means automatic resolution is off
      // for this epoch, in which case the contract would reject any attestation.
      setVerification({ state: 'checking' });
      return;
    }

    let cancelled = false;
    void recoverTypedDataAddress({
      ...resolutionTypedData(projectId, builderBps, deadline),
      signature,
    })
      .then((recovered) => {
        if (cancelled) return;
        setVerification(
          recovered.toLowerCase() === expectedSigner.toLowerCase()
            ? { state: 'ok', signer: recovered }
            : { state: 'mismatch', recovered, expected: expectedSigner },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setVerification({
          state: 'unverifiable',
          detail: err instanceof Error ? err.message : 'The signature could not be read.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [builderBps, signature, deadline, expectedSigner, projectId]);

  /* ------------------------------- transaction ------------------------------- */

  const { data: hash, error: writeError, writeContract, reset } = useWriteContract();
  const {
    data: receipt,
    isLoading: waiting,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash });

  // A fetched receipt is NOT a successful transaction — viem resolves for reverts too. The page
  // documents this trap; repeating the status check here keeps a revert from rendering as a
  // settlement, which on this card would tell a user their dispute is over when it is not.
  const mined = receipt?.status === 'success';
  const reverted = receipt?.status === 'reverted';
  const pending = (!!hash && waiting) || (!!hash && !receipt && !receiptError);

  const notifiedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (mined && hash && notifiedRef.current !== hash) {
      notifiedRef.current = hash;
      onSettled();
    }
  }, [mined, hash, onSettled]);

  const execute = async () => {
    if (builderBps == null || !signature || deadline === null) return;
    if (!(await guardNetwork())) return;
    reset();
    writeContract({
      ...escrowContract,
      functionName: 'resolveDisputeWithAttestation',
      // BigInt for both uint256 parameters; `builderBps` is a uint16 and stays a number.
      args: [projectId, builderBps, deadline, signature],
    });
  };

  const analysis = resolution.analysis;
  const confidence = analysis?.confidence;
  const manipulation = analysis?.manipulationDetected === true;

  const blocked =
    expired ||
    verification.state === 'mismatch' ||
    verification.state === 'unverifiable' ||
    builderBps == null ||
    !signature;

  return (
    <Card tone="dispute" className="space-y-7">
      {/* ------------------------------- header ------------------------------- */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge tone="warn">Arbitration ruling</Badge>
            {confidence && <ConfidenceBadge confidence={confidence} />}
            {resolution.status === 'signed' && !expired && <Badge tone="good">Signed</Badge>}
            {expired && <Badge tone="danger">Expired</Badge>}
          </div>
          <h2 className="text-xl font-black text-white leading-tight">
            The escrow has been divided
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Issued <Timestamp iso={resolution.updated_at || resolution.created_at} />. Binding and
            final — this ruling cannot be appealed or re-requested.
          </p>
        </div>
      </div>

      {/* ------------------------- manipulation alert ------------------------- */}
      {manipulation && (
        <Alert tone="danger" label="Manipulation detected">
          The arbitrator found text in the submitted evidence that tried to direct its reasoning,
          claim to speak for PayNode, or assert what the outcome should be. It did not comply, and
          it weighed the attempt against whoever was responsible under the good-faith criterion.
          The evidence analysis below records where.
        </Alert>
      )}

      {/* ------------------------------ the split ----------------------------- */}
      {builderBps != null && (
        <SplitMeter
          builderBps={builderBps}
          totalWei={totalWei}
          feeBps={feeBps}
          builderLabel={builderLabel}
          clientLabel={clientLabel}
        />
      )}

      {/* ----------------------------- reasoning ------------------------------ */}
      {resolution.reasoning && (
        <div>
          <SectionLabel>Reasoning</SectionLabel>
          <p className="mt-2 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
            {resolution.reasoning}
          </p>
        </div>
      )}

      {/* ------------------------- evidence analysis -------------------------- */}
      {analysis?.evidenceAnalysis && analysis.evidenceAnalysis.length > 0 && (
        <div>
          <SectionLabel>How each piece of evidence was weighed</SectionLabel>
          <ol className="mt-3 space-y-2">
            {analysis.evidenceAnalysis.map((finding, i) => (
              <FindingRow
                key={`${i}-${finding.source}`}
                finding={finding}
                index={i + 1}
                clientLabel={clientLabel}
                builderLabel={builderLabel}
              />
            ))}
          </ol>
        </div>
      )}

      {/* --------------------------- verification ---------------------------- */}
      <VerificationNotice verification={verification} />

      {/* ------------------------------ deadline ----------------------------- */}
      {deadline !== null && !expired && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            secondsLeft < EXPIRY_WARNING_SECONDS
              ? 'bg-red-500/10 border-red-500/25 text-red-300'
              : 'bg-slate-500/10 border-slate-500/20 text-slate-400'
          }`}
        >
          <p>
            <span className="font-bold">
              {formatCountdown(deadline, chainNow)} left to execute this ruling.
            </span>{' '}
            After that the contract will reject it, and{' '}
            <span className="text-white font-bold">no replacement can be issued</span> — the ruling
            is stored permanently and a new request returns this same signature. The dispute would
            then have to be settled between you, or left to the 30-day timeout.
          </p>
        </div>
      )}

      {expired && (
        <Alert tone="danger" label="This ruling can no longer be executed">
          Its deadline passed on{' '}
          {deadline !== null && (
            <Timestamp iso={new Date(Number(deadline) * 1000).toISOString()} className="font-bold" />
          )}
          . The contract will reject it, and the resolver cannot issue a replacement for a project
          it has already ruled on. Two routes remain: agree a settlement directly with the other
          party, or wait for the 30-day timeout, after which anyone can close the dispute.
        </Alert>
      )}

      {/* ---------------------------- transaction ---------------------------- */}
      <div className="border-t border-amber-900/30 pt-6">
        {mined ? (
          <Alert tone="good" label="Settled on-chain">
            The escrow has been paid out according to this ruling. The project is now closed.
            {hash && txUrl(hash) && (
              <>
                {' '}
                <a
                  href={txUrl(hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-white"
                >
                  View transaction
                </a>
              </>
            )}
          </Alert>
        ) : (
          <>
            <Button
              tone="dispute"
              className="w-full py-4"
              onClick={execute}
              disabled={blocked}
              busy={pending}
              busyLabel={waiting ? 'Settling on-chain…' : 'Confirm in your wallet…'}
            >
              Execute settlement
            </Button>

            <p className="text-xs text-slate-500 mt-3 text-center leading-relaxed">
              Either party can submit this ruling — the contract accepts it from any address, and
              it pays out the same split whoever sends it. You pay only the gas.
            </p>

            {reverted && (
              <div className="mt-4">
                <Alert tone="danger" label="Reverted">
                  The transaction reverted and nothing changed on-chain. The escrow is untouched.
                  {hash && txUrl(hash) && (
                    <>
                      {' '}
                      <a
                        href={txUrl(hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-4 hover:text-white"
                      >
                        View transaction
                      </a>
                    </>
                  )}
                </Alert>
              </div>
            )}

            {receiptError && (
              <div className="mt-4">
                <Alert tone="warn" label="Unconfirmed">
                  We could not confirm that transaction. Check it on the explorer — if it went
                  through, this page will catch up on its own.
                </Alert>
              </div>
            )}

            {/* A user who dismissed their own wallet prompt made a choice. Showing them a
                failure box for it is the commonest dApp papercut, so `describeTxError`
                returning null is respected as "say nothing". */}
            {writeError && !isUserRejection(writeError) && (
              <div className="mt-4">
                <Alert tone="danger" label="Not submitted">
                  {describeTxError(writeError) ?? 'The transaction could not be sent.'}
                </Alert>
              </div>
            )}
          </>
        )}
      </div>

      {/* ---------------------------- provenance ----------------------------- */}
      <div className="border-t border-slate-800/80 pt-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
        <Provenance label="Model" value={resolution.model ?? 'unknown'} mono />
        <Provenance
          label="Resolver epoch"
          value={resolution.resolver_epoch != null ? String(resolution.resolver_epoch) : '—'}
        />
        <Provenance
          label="Signer"
          value={resolution.signer ? `${resolution.signer.slice(0, 6)}…${resolution.signer.slice(-4)}` : '—'}
          mono
          title={resolution.signer ?? undefined}
        />
        <Provenance
          label="Escrow"
          value={totalWei !== undefined ? formatUSDC(totalWei) : '—'}
          mono
        />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 SUB-PARTS                                  */
/* -------------------------------------------------------------------------- */

/**
 * The model's own confidence in the ruling.
 *
 * Shown because a party is entitled to know it, and labelled in words as well as colour. `low`
 * is deliberately not dressed up: the honest reading is that the record was thin, which is
 * information a party can act on — by settling directly instead of executing.
 */
function ConfidenceBadge({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const tone: Tone = confidence === 'high' ? 'good' : confidence === 'medium' ? 'info' : 'warn';
  return <Badge tone={tone}>{confidence} confidence</Badge>;
}

const WEIGHT_LABEL: Record<EvidenceFinding['weight'], string> = {
  decisive: 'Decisive',
  strong: 'Strong',
  moderate: 'Moderate',
  slight: 'Slight',
};

function FindingRow({
  finding,
  index,
  clientLabel,
  builderLabel,
}: {
  finding: EvidenceFinding;
  index: number;
  clientLabel: string;
  builderLabel: string;
}) {
  // Same categorical pair as the split meter, and for the same reason: "weighs toward the
  // client" is an identity, not a good/bad judgement, so it must not borrow the status palette.
  const toward =
    finding.weighsToward === 'builder'
      ? { text: `Favours the builder`, tone: 'builder' as Tone, who: builderLabel }
      : finding.weighsToward === 'client'
        ? { text: `Favours the client`, tone: 'client' as Tone, who: clientLabel }
        : { text: 'Favours neither', tone: 'neutral' as Tone, who: null };

  return (
    <li className="bg-[#0f172a] border border-slate-800/80 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-5 h-5 mt-0.5 rounded-md bg-slate-800 text-slate-400 text-[10px] font-black flex items-center justify-center">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-xs font-bold text-slate-300">{finding.source}</span>
            <Badge tone={toward.tone}>{toward.text}</Badge>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">
              {WEIGHT_LABEL[finding.weight] ?? finding.weight}
            </span>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">{finding.finding}</p>
        </div>
      </div>
    </li>
  );
}

function VerificationNotice({ verification }: { verification: Verification }) {
  if (verification.state === 'checking') {
    return (
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <Spinner className="w-3.5 h-3.5" />
        Verifying this ruling&apos;s signature against the project&apos;s resolver key…
      </div>
    );
  }

  if (verification.state === 'ok') {
    return (
      <div className="flex items-start gap-2 text-xs text-emerald-400/90">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0 mt-px" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
            clipRule="evenodd"
          />
        </svg>
        <span className="leading-relaxed">
          Signature verified in your browser against this project&apos;s resolver key. The contract
          will accept it.
        </span>
      </div>
    );
  }

  if (verification.state === 'mismatch') {
    return (
      <Alert tone="danger" label="Signature does not match this project's resolver">
        This attestation recovers to{' '}
        <span className="font-mono break-all">{verification.recovered}</span>, but the contract
        verifies this project against{' '}
        <span className="font-mono break-all">{verification.expected}</span>. Submitting it would
        revert. The usual cause is a resolver key rotation: the contract checks the key that was
        live when this project was funded, so a project funded before a rotation stays pinned to
        the older key. Nothing you can do resolves this — settle directly with the other party, or
        wait for the 30-day timeout, and let the operators know.
      </Alert>
    );
  }

  return (
    <Alert tone="warn" label="Could not verify">
      This ruling&apos;s signature could not be checked in your browser ({verification.detail}).
      Executing it may revert and waste gas.
    </Alert>
  );
}

function Provenance({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-slate-400 truncate ${mono ? 'font-mono' : 'font-bold'}`} title={title}>
        {value}
      </p>
    </div>
  );
}
