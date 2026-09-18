/**
 * PayNode — single source of truth for chain, contract and protocol constants.
 *
 * This module replaces `lib/contract.ts`, `app/lib/contract.ts`, and the two ABI blocks
 * copy-pasted into `app/project/new/page.tsx` and `app/project/[id]/page.tsx`. Those four
 * disagreed with each other AND with the deployed contract (audit finding C-2). Delete them.
 *
 * Nothing here may be hardcoded per-page. Import from this file only.
 */

import { type Chain, BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';
import { PAYNODE_ESCROW_ABI } from './paynode.abi';

export { PAYNODE_ESCROW_ABI };

/* -------------------------------------------------------------------------- */
/*                                   CHAIN                                    */
/* -------------------------------------------------------------------------- */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[paynode] Missing required env var ${name}. ` +
        `Set it in .env.local (dev) and in your Vercel project settings (prod).`,
    );
  }
  return value;
}

/**
 * Native-unit decimals for the Arc chain.
 *
 * AUDIT C-5 — VERIFY THIS AGAINST ARC'S OWN CHAIN SPEC BEFORE MAINNET.
 * The app previously hardcoded `18` in three separate places. Arc is USDC-native; if its
 * native unit is 6-decimal at the RPC boundary, every amount in the app is wrong by 1e12
 * and every transaction either reverts or moves a fortune. One constant, one place to fix.
 */
export const ARC_DECIMALS = Number(process.env.NEXT_PUBLIC_ARC_DECIMALS ?? 18);

export const ARC_CHAIN_ID = Number(required('NEXT_PUBLIC_ARC_CHAIN_ID', process.env.NEXT_PUBLIC_ARC_CHAIN_ID));

const PRIMARY_RPC = required('NEXT_PUBLIC_ARC_RPC_URL', process.env.NEXT_PUBLIC_ARC_RPC_URL);
/** Optional but strongly recommended: a single RPC endpoint is a single point of failure. */
const BACKUP_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL_BACKUP;

export const ARC_RPC_URLS: readonly string[] = BACKUP_RPC ? [PRIMARY_RPC, BACKUP_RPC] : [PRIMARY_RPC];

export const ARC_EXPLORER_URL = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? '';

export const arc = {
  id: ARC_CHAIN_ID,
  name: process.env.NEXT_PUBLIC_ARC_CHAIN_NAME ?? 'Arc',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: ARC_DECIMALS },
  rpcUrls: { default: { http: ARC_RPC_URLS as string[] } },
  blockExplorers: ARC_EXPLORER_URL
    ? { default: { name: 'ArcScan', url: ARC_EXPLORER_URL } }
    : undefined,
} as const satisfies Chain;

/**
 * @dev `satisfies` rather than `as unknown as Chain`. The old cast in app/Providers.tsx
 *      disabled the exact type check that would have caught a malformed chain object.
 */

/* -------------------------------------------------------------------------- */
/*                                  CONTRACT                                  */
/* -------------------------------------------------------------------------- */

export const ESCROW_ADDRESS = required(
  'NEXT_PUBLIC_ESCROW_ADDRESS',
  process.env.NEXT_PUBLIC_ESCROW_ADDRESS,
) as `0x${string}`;

/** Pre-bound config object to spread into every wagmi read/write. Always pins the chain. */
export const escrowContract = {
  address: ESCROW_ADDRESS,
  abi: PAYNODE_ESCROW_ABI,
  chainId: ARC_CHAIN_ID,
} as const;

/* -------------------------------------------------------------------------- */
/*                              PROTOCOL CONSTANTS                            */
/* -------------------------------------------------------------------------- */

/** Mirrors the on-chain `constant`s. Kept in sync manually — see `assertProtocolConstants`. */
export const PROTOCOL = {
  MAX_FEE_BPS: 500,
  BPS_DENOMINATOR: 10_000,
  REVIEW_PERIOD_SECONDS: 7 * 24 * 60 * 60,
  REVISION_GRACE_SECONDS: 7 * 24 * 60 * 60,
  DISPUTE_TIMEOUT_SECONDS: 30 * 24 * 60 * 60,
  RESOLVER_TIMELOCK_SECONDS: 7 * 24 * 60 * 60,
  STALE_DISPUTE_BUILDER_BPS: 5_000,
  MAX_DURATION_DAYS: 365,
  MAX_REVISIONS_CAP: 10,
} as const;

/* -------------------------------------------------------------------------- */
/*                                   STATUS                                   */
/* -------------------------------------------------------------------------- */

/** Ordinals MUST match `PayNodeEscrowV2.ProjectStatus`. */
export enum ProjectStatus {
  AwaitingFunds = 0,
  Funded = 1,
  InRevision = 2,
  Completed = 3,
  Disputed = 4,
  Cancelled = 5,
  Refunded = 6,
  Delivered = 7,
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  [ProjectStatus.AwaitingFunds]: 'Awaiting Funds',
  [ProjectStatus.Funded]: 'In Progress',
  [ProjectStatus.InRevision]: 'In Revision',
  [ProjectStatus.Completed]: 'Completed',
  [ProjectStatus.Disputed]: 'Disputed',
  [ProjectStatus.Cancelled]: 'Cancelled',
  [ProjectStatus.Refunded]: 'Refunded',
  [ProjectStatus.Delivered]: 'Delivered',
};

/** Statuses in which the contract is holding escrowed value. Mirrors `_isFundedStatus`. */
export const FUNDED_STATUSES: readonly ProjectStatus[] = [
  ProjectStatus.Funded,
  ProjectStatus.InRevision,
  ProjectStatus.Delivered,
  ProjectStatus.Disputed,
];

export const TERMINAL_STATUSES: readonly ProjectStatus[] = [
  ProjectStatus.Completed,
  ProjectStatus.Cancelled,
  ProjectStatus.Refunded,
];

export const isFundedStatus = (s: ProjectStatus) => FUNDED_STATUSES.includes(s);
export const isTerminalStatus = (s: ProjectStatus) => TERMINAL_STATUSES.includes(s);

/** Resolution path ordinals emitted in `DisputeResolved.resolutionPath`. */
export enum ResolutionPath {
  DesignatedArbitrator = 0,
  AutonomousResolver = 1,
  MutualSettlement = 2,
  StaleDisputeBreaker = 3,
}

/* -------------------------------------------------------------------------- */
/*                            ON-CHAIN PROJECT SHAPE                          */
/* -------------------------------------------------------------------------- */

/**
 * The tuple returned by the public `projects(uint256)` getter, named.
 *
 * Field ORDER is dictated by the Solidity struct. If the struct changes, this is the only
 * place in the frontend that needs updating — do not destructure the raw tuple elsewhere.
 */
export type OnChainProject = {
  client: `0x${string}`;
  deadline: bigint;
  maxRevisions: number;
  revisionsUsed: number;
  feeBps: number;
  builder: `0x${string}`;
  stateTimestamp: bigint;
  status: ProjectStatus;
  preDispute: ProjectStatus;
  resolverEpoch: number;
  amount: bigint;
};

type ProjectsTuple = readonly [
  `0x${string}`, bigint, number, number, number,
  `0x${string}`, bigint, number, number, number, bigint,
];

export function parseProject(raw: ProjectsTuple): OnChainProject {
  const [
    client, deadline, maxRevisions, revisionsUsed, feeBps,
    builder, stateTimestamp, status, preDispute, resolverEpoch, amount,
  ] = raw;
  return {
    client, deadline, maxRevisions, revisionsUsed, feeBps,
    builder, stateTimestamp,
    status: status as ProjectStatus,
    preDispute: preDispute as ProjectStatus,
    resolverEpoch, amount,
  };
}

/** A project exists on-chain iff its client is set. Unwritten ids return the zero struct. */
export const projectExists = (p: OnChainProject) =>
  p.client !== '0x0000000000000000000000000000000000000000';

/* -------------------------------------------------------------------------- */
/*                           DERIVED ACTION GATING                            */
/* -------------------------------------------------------------------------- */

/**
 * What each party may do RIGHT NOW, derived from on-chain state only.
 *
 * AUDIT H-5 — the app previously gated every button on the Supabase `status` string, which
 * is written by whichever browser happened to succeed. That produced buttons that always
 * revert (e.g. "Request Revision" with revisions exhausted) and buttons that vanish while
 * the money is still in escrow. Derive from the chain; use the DB for presentation only.
 *
 * @param nowSeconds Prefer the latest block's timestamp over Date.now() — the contract
 *                   compares against block time, and a skewed client clock will otherwise
 *                   enable a button whose transaction reverts.
 */
export function deriveActions(p: OnChainProject, viewer: string | undefined, nowSeconds: bigint) {
  const me = viewer?.toLowerCase();
  const isClient = !!me && me === p.client.toLowerCase();
  const isBuilder = !!me && me === p.builder.toLowerCase();

  const pastDeadline = nowSeconds > p.deadline;
  const reviewEndsAt = p.status === ProjectStatus.Delivered ? p.stateTimestamp + BigInt(PROTOCOL.REVIEW_PERIOD_SECONDS) : 0n;
  const staleAt = p.status === ProjectStatus.Disputed ? p.stateTimestamp + BigInt(PROTOCOL.DISPUTE_TIMEOUT_SECONDS) : 0n;
  const active = isFundedStatus(p.status);

  return {
    isClient,
    isBuilder,
    isParty: isClient || isBuilder,
    pastDeadline,
    reviewEndsAt,
    staleAt,
    revisionsLeft: p.maxRevisions - p.revisionsUsed,

    canFund: isClient && p.status === ProjectStatus.AwaitingFunds,
    canCancelUnfunded: (isClient || isBuilder) && p.status === ProjectStatus.AwaitingFunds,

    canDeliver:
      isBuilder &&
      (p.status === ProjectStatus.Funded || p.status === ProjectStatus.InRevision) &&
      !pastDeadline,

    canRelease:
      isClient &&
      [ProjectStatus.Funded, ProjectStatus.InRevision, ProjectStatus.Delivered].includes(p.status),

    canRequestRevision:
      isClient &&
      [ProjectStatus.Funded, ProjectStatus.InRevision, ProjectStatus.Delivered].includes(p.status) &&
      p.revisionsUsed < p.maxRevisions,

    canClaimByBuilder:
      isBuilder && p.status === ProjectStatus.Delivered && nowSeconds >= reviewEndsAt,

    canBuilderCancel:
      isBuilder &&
      [ProjectStatus.Funded, ProjectStatus.InRevision, ProjectStatus.Delivered].includes(p.status),

    canClaimRefund:
      isClient &&
      [ProjectStatus.Funded, ProjectStatus.InRevision].includes(p.status) &&
      pastDeadline,

    // Client may escalate ONLY from Delivered; builder may escalate from any funded stage.
    canRaiseDispute:
      (isClient && p.status === ProjectStatus.Delivered) ||
      (isBuilder &&
        [ProjectStatus.Funded, ProjectStatus.InRevision, ProjectStatus.Delivered].includes(p.status)),

    canProposeSettlement: (isClient || isBuilder) && active,

    canForceResolve: p.status === ProjectStatus.Disputed && nowSeconds >= staleAt,
  };
}

/* -------------------------------------------------------------------------- */
/*                                 FORMATTING                                 */
/* -------------------------------------------------------------------------- */

/**
 * Format a native-unit bigint for display.
 * @dev Never round-trip an escrow amount through a JS number. `parseFloat`/`Number` on a
 *      USDC amount loses precision, and `fundProject` requires `msg.value` to match the
 *      registered amount EXACTLY — a single ulp of drift bricks the project in AwaitingFunds.
 */
export function formatAmount(wei: bigint, maxFractionDigits = 2): string {
  const base = 10n ** BigInt(ARC_DECIMALS);
  const whole = wei / base;
  const frac = wei % base;
  if (frac === 0n || maxFractionDigits === 0) return whole.toLocaleString('en-US');
  const fracStr = frac.toString().padStart(ARC_DECIMALS, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  return fracStr ? `${whole.toLocaleString('en-US')}.${fracStr}` : whole.toLocaleString('en-US');
}

export const formatUSDC = (wei: bigint) => `${formatAmount(wei)} USDC`;

export const txUrl = (hash: string) => (ARC_EXPLORER_URL ? `${ARC_EXPLORER_URL}/tx/${hash}` : '');

export function formatCountdown(targetSeconds: bigint, nowSeconds: bigint): string {
  let d = Number(targetSeconds - nowSeconds);
  if (d <= 0) return 'Expired';
  const days = Math.floor(d / 86400); d -= days * 86400;
  const hours = Math.floor(d / 3600); d -= hours * 3600;
  const mins = Math.floor(d / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${d % 60}s`;
}

/* -------------------------------------------------------------------------- */
/*                              ERROR TRANSLATION                             */
/* -------------------------------------------------------------------------- */

const ERROR_COPY: Record<string, string> = {
  NotClient: 'Only the client of this project can do that.',
  NotBuilder: 'Only the builder of this project can do that.',
  NotParty: 'You are not a party to this project.',
  NotArbitrator: 'Only the designated arbitrator can resolve this dispute.',
  NotProposer: 'Only the party who proposed this settlement can retract it.',
  NoArbitratorAssigned: 'This project has no designated arbitrator — it resolves automatically.',
  ArbitratorAssigned: 'This project has a designated arbitrator, who must rule on it.',
  ResolverDisabled: 'Automatic resolution is unavailable for this project.',
  BadAttestation: 'That resolution was not signed by the authorized resolver.',
  AttestationExpired: 'That resolution has expired. A new one must be issued.',
  BadState: 'This project has already moved on. Refreshing the latest state…',
  WrongValue: 'The deposit must match the agreed amount exactly.',
  DeadlinePassed: 'The delivery deadline has already passed.',
  DeadlineNotPassed: 'The builder still has time to deliver.',
  ReviewPeriodActive: 'The 7-day review period has not ended yet.',
  DisputeWindowActive: 'The 30-day dispute window has not ended yet.',
  RevisionsExhausted: 'You have used every revision included in this project.',
  BpsTooHigh: 'That share is out of range.',
  NoSettlementProposed: 'There is no settlement offer to accept.',
  SettlementMismatch: 'The offer changed. Review the new terms before accepting.',
  CannotSelfAccept: 'The other party has to accept your offer.',
  NothingToWithdraw: 'You have no funds waiting to be withdrawn.',
  TransferFailed: 'The transfer failed. Your funds are still claimable.',
  NoPendingResolverUpdate: 'There is no pending resolver change.',
  ResolverTimelockActive: 'The resolver change is still within its 7-day notice period.',
  ZeroAddress: 'That address is not valid.',
  SelfDeal: 'The client, builder and arbitrator must all be different addresses.',
  ZeroAmount: 'The amount must be greater than zero.',
  BadDuration: `The deadline must be between 1 and ${PROTOCOL.MAX_DURATION_DAYS} days away.`,
  BadRevisions: `You can include at most ${PROTOCOL.MAX_REVISIONS_CAP} revisions.`,
  EnforcedPause: 'New projects are temporarily paused.',
  ReentrancyGuardReentrantCall: 'That request could not be processed. Please try again.',
};

/**
 * Turn a viem/wagmi error into user-facing copy.
 *
 * AUDIT — the app previously did `alert("Transaction failed or was rejected by the wallet.")`
 * for everything, which tells a user who simply clicked Cancel that something broke.
 *
 * @returns `null` when the user deliberately rejected — show NOTHING in that case.
 */
export function describeTxError(err: unknown): string | null {
  if (!err) return null;

  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return null;

    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && ERROR_COPY[name]) return ERROR_COPY[name];
      if (name) return `The contract rejected this action (${name}).`;
      return 'The contract rejected this action.';
    }

    if (/insufficient funds/i.test(err.message)) {
      return 'Your wallet does not have enough to cover this transaction plus gas.';
    }
    return err.shortMessage || 'The transaction could not be completed.';
  }

  return 'Something went wrong. Your funds were not moved.';
}

/** True when the user dismissed the wallet prompt — never surface this as an error. */
export function isUserRejection(err: unknown): boolean {
  return err instanceof BaseError && !!err.walk((e) => e instanceof UserRejectedRequestError);
}

/* -------------------------------------------------------------------------- */
/*                              EIP-712 RESOLUTION                            */
/* -------------------------------------------------------------------------- */

/**
 * Typed-data payload the autonomous resolver signs. Must match `RESOLUTION_TYPEHASH` and the
 * `EIP712("PayNodeEscrow", "2")` domain in the contract exactly, or `BadAttestation` reverts.
 *
 * Verify a signature before submitting by comparing against the contract's own
 * `resolutionDigest(projectId, builderBps, deadline)` view.
 */
export function resolutionTypedData(projectId: bigint, builderBps: number, deadline: bigint) {
  return {
    domain: {
      name: 'PayNodeEscrow',
      version: '2',
      chainId: ARC_CHAIN_ID,
      verifyingContract: ESCROW_ADDRESS,
    },
    types: {
      Resolution: [
        { name: 'projectId', type: 'uint256' },
        { name: 'builderBps', type: 'uint16' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Resolution',
    message: { projectId, builderBps, deadline },
  } as const;
}
