'use client';

/**
 * The settlement split, as a part-to-whole bar plus a hero figure.
 *
 * ── FORM ──────────────────────────────────────────────────────────────────────
 * The data's job is part-to-whole across two named entities, so this is a horizontal stacked
 * bar with both segments directly labelled — not a two-slice pie, and not a "meter", which is
 * the right form for one ratio against a limit rather than for a division between two parties.
 * The headline percentage is a hero figure above it; there is exactly one per view.
 *
 * ── COLOR ─────────────────────────────────────────────────────────────────────
 * Two categorical hues, because the two segments are IDENTITIES (which party) rather than
 * magnitudes or polarity. `#059669` (emerald-600) for the builder's share and `#2563eb`
 * (blue-600) for the client's — both already this design system's own button hues, and the
 * pair passes every check of the validator against this page's `#0f172a` surface:
 *
 *   lightness band   PASS  both inside L 0.48–0.67
 *   chroma floor     PASS
 *   CVD separation   PASS  ΔE 24.9 deutan, 6.6 tritan
 *   normal vision    PASS  ΔE 27.2
 *   contrast         PASS  both ≥ 3:1
 *
 * Tritan separation lands in the 6–8 floor band, which is permitted only with secondary
 * encoding — so both segments are direct-labelled and separated by a 2px surface gap, and the
 * key below the bar names each party in text. Identity is never carried by colour alone here.
 *
 * WHY THE CLIENT'S SHARE IS NOT RED. The rest of this page uses red for the client — "Refund to
 * Client", "Claim Full Refund" — and reaching for it here was the obvious move. It is wrong.
 * Red and emerald are this system's status colours, and status colours must not be reused as
 * categorical identity: a 25% refund is not a failure state, and painting it red editorialises
 * a ruling that is supposed to read as neutral to the party who lost. Blue is the app's
 * primary accent and carries no verdict.
 *
 * ── MARKS ─────────────────────────────────────────────────────────────────────
 * 20px track (under the ≤24px cap), 4px rounded outer data-ends with square inner ends at the
 * join, a 2px gap in the surface colour between the fills, and no borders on the marks. A
 * segment narrower than ~18% cannot hold a legible inline label, so labels move out to the key
 * rather than being clipped — a clipped label in a thin segment is a listed anti-pattern.
 */

import { bpsToPercent, splitEscrow } from '@/lib/dispute/types';
import { formatUSDC, PROTOCOL } from '@/lib/paynode';

/** The validated categorical pair. Kept as constants so the two views cannot drift. */
const BUILDER_FILL = '#059669';
const CLIENT_FILL = '#2563eb';

/** Below this share, an inline label would be clipped; it goes to the key instead. */
const INLINE_LABEL_MIN_PCT = 18;

export function SplitMeter({
  builderBps,
  /** Total escrowed amount in wei, from the chain. Omit to show percentages only. */
  totalWei,
  /** The project's SNAPSHOTTED fee, from `onchain.feeBps` — never the live global fee. */
  feeBps,
  builderLabel = 'Builder',
  clientLabel = 'Client',
}: {
  builderBps: number;
  totalWei?: bigint;
  feeBps?: number;
  builderLabel?: string;
  clientLabel?: string;
}) {
  const clientBps = PROTOCOL.BPS_DENOMINATOR - builderBps;

  // Percentages for geometry only. The MONEY below never goes through this — it is computed in
  // wei by splitEscrow, because a width can round and a payout cannot.
  const builderPct = (builderBps / PROTOCOL.BPS_DENOMINATOR) * 100;
  const clientPct = 100 - builderPct;

  const split =
    totalWei !== undefined ? splitEscrow(totalWei, builderBps, feeBps ?? 0) : null;

  // Which side the ruling actually favoured, for the hero figure's framing. A dead-even split
  // is stated as such rather than being attributed to whoever happens to sort first.
  const even = builderBps === clientBps;
  const favoursBuilder = builderBps > clientBps;

  return (
    <div>
      {/* ---- Hero figure. One per view, ≥48px, same sans, proportional figures. ---- */}
      <div className="mb-5">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
          Settlement split
        </p>
        <p className="text-5xl md:text-6xl font-black text-white leading-none">
          {bpsToPercent(builderBps)}%{' '}
          <span className="text-2xl md:text-3xl text-slate-500 font-bold align-middle">
            / {bpsToPercent(clientBps)}%
          </span>
        </p>
        <p className="mt-2 text-sm text-slate-400">
          {even ? (
            <>The escrow is divided evenly between both parties.</>
          ) : (
            <>
              {bpsToPercent(favoursBuilder ? builderBps : clientBps)}% of the escrow is awarded
              to the <span className="text-white font-bold">{favoursBuilder ? 'builder' : 'client'}</span>.
            </>
          )}
        </p>
      </div>

      {/* ---- The bar. role=img with a full text alternative: a screen reader gets the
             numbers as a sentence rather than two unlabelled divs. ---- */}
      <div
        role="img"
        aria-label={`${builderLabel} ${bpsToPercent(builderBps)} percent, ${clientLabel} ${bpsToPercent(clientBps)} percent of the escrow.`}
        className="flex h-5 w-full overflow-hidden rounded"
      >
        {builderBps > 0 && (
          <div
            className="h-full flex items-center justify-start overflow-hidden"
            style={{
              width: `${builderPct}%`,
              backgroundColor: BUILDER_FILL,
              // 4px on the outer end only; the inner end stays square at the join.
              borderRadius: clientBps > 0 ? '4px 0 0 4px' : '4px',
              // The 2px surface gap, as a margin in the surface colour — never a stroke.
              marginRight: clientBps > 0 ? 2 : 0,
            }}
          >
            {builderPct >= INLINE_LABEL_MIN_PCT && (
              <span className="px-2 text-[11px] font-black text-white/95 whitespace-nowrap">
                {bpsToPercent(builderBps)}%
              </span>
            )}
          </div>
        )}

        {clientBps > 0 && (
          <div
            className="h-full flex items-center justify-end overflow-hidden"
            style={{
              width: `${clientPct}%`,
              backgroundColor: CLIENT_FILL,
              borderRadius: builderBps > 0 ? '0 4px 4px 0' : '4px',
            }}
          >
            {clientPct >= INLINE_LABEL_MIN_PCT && (
              <span className="px-2 text-[11px] font-black text-white/95 whitespace-nowrap">
                {bpsToPercent(clientBps)}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* ---- Key. Always present for two series; the swatch carries identity and the
             numbers stay in text ink rather than wearing the series colour. ---- */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KeyRow
          fill={BUILDER_FILL}
          label={builderLabel}
          percent={bpsToPercent(builderBps)}
          amount={split ? formatUSDC(split.builderNet) : null}
          note={
            split && split.protocolFee > 0n
              ? `after ${formatUSDC(split.protocolFee)} protocol fee`
              : null
          }
        />
        <KeyRow
          fill={CLIENT_FILL}
          label={clientLabel}
          percent={bpsToPercent(clientBps)}
          amount={split ? formatUSDC(split.clientRefund) : null}
          note={split ? 'refunded in full, no fee' : null}
        />
      </div>

      {split && (
        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          Figures are computed in wei with the same integer arithmetic the contract uses, using
          this project&apos;s snapshotted fee of {bpsToPercent(feeBps ?? 0)}%. The refund is the
          remainder of the escrow rather than its own percentage, so the two shares always sum
          to exactly {formatUSDC(split.builderGross + split.clientRefund)}.
        </p>
      )}
    </div>
  );
}

function KeyRow({
  fill,
  label,
  percent,
  amount,
  note,
}: {
  fill: string;
  label: string;
  percent: string;
  amount: string | null;
  note: string | null;
}) {
  return (
    <div className="flex items-start gap-3 bg-[#0f172a] border border-slate-800/80 rounded-xl p-4">
      <span
        aria-hidden="true"
        className="mt-1 w-3 h-3 rounded-sm shrink-0"
        style={{ backgroundColor: fill }}
      />
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-white font-black text-lg leading-tight mt-0.5">
          {percent}%
          {amount && <span className="text-slate-400 font-bold text-sm"> · {amount}</span>}
        </p>
        {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
      </div>
    </div>
  );
}
