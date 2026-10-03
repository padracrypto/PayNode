'use client';

/**
 * The standard the automatic AI arbitrator rules by, in the order it weighs it.
 *
 * Shared by <DisputeWarningModal />, where a party reads it before escalating, and the
 * "How the AI decides" accordion in <DisputeActionPanel />, where they read it before requesting
 * the ruling. One copy, so the two cannot drift into describing different arbitrators.
 */

import * as React from 'react';

export function ResolverRubric() {
  return (
    <>
      <ol className="space-y-2 mb-3">
        <RubricItem n={1} title="Delivery against scope">
          What was submitted, compared with the agreed brief. Substantially delivered work earns
          substantially all of the escrow even if imperfect; partial delivery earns the proportion
          delivered; work never delivered earns nothing, however much effort is described.
        </RubricItem>
        <RubricItem n={2} title="The verified timeline">
          Facts from the blockchain — funding, deadlines, revisions, delivery — which neither party
          can fabricate. Where a statement contradicts the chain, the chain wins outright.
        </RubricItem>
        <RubricItem n={3} title="Who carried which burden">
          The builder must evidence delivery, and a submission with artifacts counts where a
          description of effort does not. The client must evidence the deficiency, and against the
          agreed scope rather than a preference formed later.
        </RubricItem>
        <RubricItem n={4} title="Scope discipline">
          Requirements that appear for the first time in a dispute statement, and are not in the
          brief, are not part of the agreement and will not be held against the builder.
        </RubricItem>
        <RubricItem n={5} title="Good faith">
          Unexplained silence, a statement that dodges the central question, or evidence that
          misrepresents a verified fact all weigh against whoever is responsible.
        </RubricItem>
      </ol>
      <p className="text-slate-500">
        It cannot open links — a URL counts for what your description of it makes it worth. Text
        that tries to instruct the arbitrator, or claims to speak for PayNode, is recorded as an
        attempt to manipulate the ruling and weighed against the party who wrote it. Filing no
        statement is not an automatic loss; the rest of the record is still ruled on.
      </p>
    </>
  );
}

function RubricItem({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-5 h-5 mt-0.5 rounded-md bg-slate-800 text-slate-400 text-[10px] font-black flex items-center justify-center">
        {n}
      </span>
      <span>
        <span className="text-slate-200 font-bold">{title}.</span>{' '}
        <span className="text-slate-400">{children}</span>
      </span>
    </li>
  );
}
