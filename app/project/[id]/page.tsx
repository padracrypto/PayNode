'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useBlockNumber,
  useChainId,
  useSwitchChain,
  usePublicClient,
  useWatchContractEvent,
} from 'wagmi';
import { zeroAddress } from 'viem';
import { supabase } from '@/lib/supabase';
import {
  escrowContract,
  parseProject,
  deriveActions,
  ProjectStatus,
  STATUS_LABEL,
  ResolutionPath,
  ARC_CHAIN_ID,
  formatUSDC,
  formatCountdown,
  describeTxError,
  isUserRejection,
  txUrl,
  type OnChainProject,
} from '@/lib/paynode';
import { useSiwe } from '@/app/providers/SiweProvider';

const PATH_LABEL: Record<number, string> = {
  [ResolutionPath.DesignatedArbitrator]: 'the designated arbitrator',
  [ResolutionPath.AutonomousResolver]: 'automatic resolution',
  [ResolutionPath.MutualSettlement]: 'mutual agreement',
  [ResolutionPath.StaleDisputeBreaker]: 'the 30-day timeout',
};

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

/**
 * Shown when the project row cannot be read. Row-level security only lets the client, the
 * builder and the designated arbitrator select a project, so for anyone else — or for a
 * visitor who has not signed in — the query returns nothing. Without this the page sat on a
 * loading spinner forever, which looked like a hang rather than a permissions answer.
 */
function AccessDenied({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="min-h-[calc(100vh-80px)] w-full flex flex-col items-center justify-center px-6">
      <div className="bg-red-950/20 border border-red-900/50 p-8 rounded-[2rem] max-w-lg w-full text-center shadow-2xl backdrop-blur-xl">
        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-500/20">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-red-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <h1 className="text-2xl font-black text-white mb-2">{signedIn ? 'Access Denied' : 'Sign in required'}</h1>
        <p className="text-slate-400 text-sm mb-8">
          {signedIn
            ? 'This project does not exist, or you are not its client, builder or designated arbitrator.'
            : 'Connect your wallet and sign in to view this project.'}
        </p>
        <Link
          href="/dashboard"
          className="w-full inline-block bg-[#050B14] hover:bg-slate-800 border border-slate-800 text-white py-4 rounded-xl font-bold transition-all shadow-lg"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}

/**
 * The delivery link is typed by the builder and rendered as an <a href> for the client, so a
 * `javascript:` URL would run in this origin on click. Only http(s) is allowed through.
 */
const safeHref = (url?: string | null): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

export default function ProjectPage() {
  const { id } = useParams();
  const { address } = useAccount();
  
  const [project, setProject] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [clientUsername, setClientUsername] = useState<string>('');
  const [builderUsername, setBuilderUsername] = useState<string>('');
  const [arbitratorUsername, setArbitratorUsername] = useState<string>('');

  const [deliveryData, setDeliveryData] = useState({ notes: '', links: '' });
  const [isRevisionMode, setIsRevisionMode] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState(''); 
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [forceReleaseTimeLeft, setForceReleaseTimeLeft] = useState<string>('');
  
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [settlementBps, setSettlementBps] = useState<number>(5000);
  const [rulingBps, setRulingBps] = useState<number>(5000);
  const { data: hash, error: writeError, writeContract } = useWriteContract();
  // `isSuccess` means the receipt was FETCHED, not that the transaction succeeded. viem
  // resolves waitForTransactionReceipt for reverted transactions too, so without the status
  // check a revert was being written to Supabase as a success — the DB said "paid" while the
  // money was still in escrow, and the UI removed the button that would have released it.
  const {
    data: receipt,
    isSuccess: isMined,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash });
  const isConfirmed = isMined && receipt?.status === 'success';
  const syncedRef = useRef<string | null>(null);

  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { authedWallet } = useSiwe();
  const wrongNetwork = !!address && chainId !== ARC_CHAIN_ID;

  // Re-read when the SIWE session changes: a page opened before signing in gets nothing back
  // from row-level security, and would otherwise stay empty until a manual refresh.
  useEffect(() => {
    fetchProject();
  }, [id, authedWallet]);

  // ------------------------------------------------------------------
  // ON-CHAIN STATE IS THE SOURCE OF TRUTH
  //
  // Every gate below used to read Supabase's `status` string, which is written by whichever
  // browser happened to succeed. That produced buttons that always revert (Request Revision
  // with revisions exhausted) and buttons that vanish while funds are still escrowed.
  // Supabase now supplies presentation only: title, notes, links, usernames.
  // ------------------------------------------------------------------
  const pid = project?.blockchain_id != null ? BigInt(project.blockchain_id) : undefined;

  const { data: blockNumber } = useBlockNumber({ watch: true, chainId: ARC_CHAIN_ID });

  const { data: rawProject, refetch: refetchChain } = useReadContract({
    ...escrowContract,
    functionName: 'projects',
    args: pid !== undefined ? [pid] : undefined,
    query: { enabled: pid !== undefined },
  });

  const { data: arbitratorAddr } = useReadContract({
    ...escrowContract,
    functionName: 'projectArbitrator',
    args: pid !== undefined ? [pid] : undefined,
    query: { enabled: pid !== undefined },
  });

  // The resolver key snapshotted for this project's epoch. Zero means automatic resolution is
  // switched off, in which case the UI must not promise it.
  const { data: resolverAddr } = useReadContract({
    ...escrowContract,
    functionName: 'resolverFor',
    args: pid !== undefined ? [pid] : undefined,
    query: { enabled: pid !== undefined },
  });

  const { data: pendingOffer, refetch: refetchOffer } = useReadContract({
    ...escrowContract,
    functionName: 'settlements',
    args: pid !== undefined ? [pid] : undefined,
    query: { enabled: pid !== undefined },
  });

  // Chain time, not Date.now(). The contract compares against block.timestamp; a skewed
  // client clock otherwise enables a button whose transaction reverts.
  const [chainNow, setChainNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    if (!publicClient) return;
    publicClient
      .getBlock()
      .then((b) => setChainNow(b.timestamp))
      .catch(() => {});
  }, [publicClient, blockNumber]);

  // Re-read on every block so the UI reflects reality rather than a stale row.
  useEffect(() => {
    if (pid === undefined) return;
    void refetchChain();
    void refetchOffer();
  }, [blockNumber, pid, refetchChain, refetchOffer]);

  const onchain: OnChainProject | null = useMemo(
    () => (rawProject ? parseProject(rawProject as never) : null),
    [rawProject],
  );

  const act = useMemo(
    () => (onchain ? deriveActions(onchain, address, chainNow) : null),
    [onchain, address, chainNow],
  );

  // The Delivered/Completed cards are gated on CHAIN status, which refreshes every block, but
  // `project` is a one-shot Supabase read. A client who already had this page open when the
  // builder delivered saw the card appear with the stale (empty) notes and link. Re-read the
  // row whenever the on-chain status moves so the two halves stay in step.
  const onchainStatus = onchain?.status;
  useEffect(() => {
    if (onchainStatus === undefined) return;
    void fetchProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onchainStatus]);

  const hasArbitrator = !!arbitratorAddr && arbitratorAddr !== zeroAddress;
  const hasResolver = !!resolverAddr && resolverAddr !== zeroAddress;
  const offer = pendingOffer as readonly [`0x${string}`, number] | undefined;
  const hasOffer = !!offer && offer[0] !== zeroAddress;

  /**
   * Whether there is delivered work to show.
   *
   * This used to be `status === Delivered || status === Completed`, which blanked the notes
   * and the link the instant a dispute was opened — `status` moves to Disputed — and again if
   * the ruling went Refunded. That hid the only evidence of the work at exactly the moment the
   * arbitrator was asked to judge it, and left both parties arguing from memory.
   *
   * `preDispute` is the status the contract itself captured at raiseDispute, so it is a
   * reliable answer to "had this been delivered before it went sideways?". It defaults to
   * AwaitingFunds, so a project refunded without any delivery still correctly shows nothing.
   */
  const deliveryOnRecord =
    onchain?.status === ProjectStatus.Delivered ||
    onchain?.status === ProjectStatus.Completed ||
    ((onchain?.status === ProjectStatus.Disputed || onchain?.status === ProjectStatus.Refunded) &&
      onchain.preDispute === ProjectStatus.Delivered);

  const deliveredCard =
    onchain?.status === ProjectStatus.Completed
      ? { border: 'border-emerald-900/30', text: 'text-emerald-400', title: 'Delivered Work (Approved)' }
      : onchain?.status === ProjectStatus.Disputed
        ? { border: 'border-amber-900/30', text: 'text-amber-400', title: 'Delivered Work (Under Dispute)' }
        : onchain?.status === ProjectStatus.Refunded
          ? { border: 'border-red-900/30', text: 'text-red-400', title: 'Delivered Work (Refunded to Client)' }
          : { border: 'border-purple-900/30', text: 'text-purple-400', title: 'Work Delivered for Review' };

  // The delivery deadline stops meaning anything once the contract has finalized. Read from the
  // chain rather than the Supabase `status` column, which only moves when the indexer catches up.
  const closedCard =
    onchain?.status === ProjectStatus.Completed
      ? { label: 'Completed', text: 'text-emerald-400' }
      : onchain?.status === ProjectStatus.Refunded || onchain?.status === ProjectStatus.Cancelled
        ? { label: 'Closed', text: 'text-slate-400' }
        : null;

  const isClient = act?.isClient ?? false;
  const isBuilder = act?.isBuilder ?? false;
  // Decided from the CHAIN, which is what resolveDispute actually enforces — not the
  // client-supplied `arbitrator` column in Supabase.
  const isArbitrator =
    hasArbitrator && !!address && (arbitratorAddr as string).toLowerCase() === address.toLowerCase();
  // `arbitratorAddr !== undefined` is load-bearing: the `projectArbitrator` read resolves a
  // moment after `projects` does, and without it the real arbitrator was shown Access Denied
  // for that gap — on the one page they were sent here to act on.
  const isUnauthorized =
    !isClient && !isBuilder && !isArbitrator && !!address && !!onchain && arbitratorAddr !== undefined;

  // The arbitrator's handle is resolved separately from the client's and the builder's,
  // because their address comes from the CHAIN rather than from the row. Looking it up from
  // Supabase's client-written `arbitrator` column would let a client display the handle of a
  // wallet that resolveDispute does not actually recognise.
  useEffect(() => {
    if (!hasArbitrator) {
      setArbitratorUsername('');
      return;
    }
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('username')
      .eq('wallet_address', (arbitratorAddr as string).toLowerCase())
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setArbitratorUsername(data?.username ?? '');
      });
    return () => {
      cancelled = true;
    };
  }, [hasArbitrator, arbitratorAddr]);

  useEffect(() => {
    if (!project?.deadline) return;

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const deadlineDate = new Date(project.deadline).getTime();
      const endOfDayDeadline = deadlineDate + (24 * 60 * 60 * 1000) - 1; 
      const distance = endOfDayDeadline - now;

      if (distance < 0) {
        setTimeLeft('Expired');
        clearInterval(timer);
        return;
      }

      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);

      setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    }, 1000);

    return () => clearInterval(timer);
  }, [project?.deadline]);

  useEffect(() => {
    if (!project?.delivered_at || project.status !== 'Delivered') return;

    const releaseTimer = setInterval(() => {
      const now = new Date().getTime();
      const deliveredDate = new Date(project.delivered_at).getTime();
      const releaseTime = deliveredDate + (7 * 24 * 60 * 60 * 1000); 
      const distance = releaseTime - now;

      if (distance < 0) {
        setForceReleaseTimeLeft('Claim Now');
        clearInterval(releaseTimer);
        return;
      }

      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setForceReleaseTimeLeft(`Available in ${days}d ${hours}h`);
      } else if (hours > 0) {
        setForceReleaseTimeLeft(`Available in ${hours}h ${minutes}m`);
      } else {
        setForceReleaseTimeLeft(`Available in ${minutes}m`);
      }
    }, 1000);

    return () => clearInterval(releaseTimer);
  }, [project?.delivered_at, project?.status]);

  useEffect(() => {
    if (isMined && receipt?.status === 'reverted') {
      setLoading(false);
      setActiveAction(null);
      setBanner({ kind: 'error', text: 'That transaction reverted. Nothing changed on-chain.' });
      void refetchChain();
      return;
    }
    if (isConfirmed && activeAction && syncedRef.current !== hash) {
      syncedRef.current = hash ?? null;
      void handleDbSyncAfterWeb3();
      void refetchChain();
      void refetchOffer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, isMined, receipt, activeAction, hash]);

  // A dropped or replaced transaction never yields a receipt. Without this, `loading` stayed
  // true forever and every action button on the page stayed disabled until a manual reload.
  useEffect(() => {
    if (!receiptError) return;
    setLoading(false);
    setActiveAction(null);
    setBanner({
      kind: 'error',
      text: 'We could not confirm that transaction. Check its status on the explorer; if it went through, refresh this page.',
    });
  }, [receiptError]);

  useEffect(() => {
    if (!writeError) return;
    setLoading(false);
    setActiveAction(null);
    // A user dismissing the wallet prompt chose to do that. Showing them a failure modal
    // for their own deliberate action is the single most common dApp papercut.
    if (isUserRejection(writeError)) return;
    setBanner({ kind: 'error', text: describeTxError(writeError) ?? 'Transaction failed.' });
  }, [writeError]);

  // Surface resolutions that happened without this user acting — an arbitrator ruling, an
  // automatic resolution, or a keeper calling the 30-day breaker.
  useWatchContractEvent({
    ...escrowContract,
    eventName: 'DisputeResolved',
    args: pid !== undefined ? { projectId: pid } : undefined,
    enabled: pid !== undefined,
    onLogs: (logs) => {
      const a = logs[0]?.args as { builderBps?: number; resolutionPath?: number } | undefined;
      if (!a) return;
      setBanner({
        kind: 'info',
        text:
          `Dispute resolved by ${PATH_LABEL[a.resolutionPath ?? 0]}: ` +
          `${(a.builderBps ?? 0) / 100}% to the builder.`,
      });
      void refetchChain();
    },
  });

  const guardNetwork = async (): Promise<boolean> => {
    if (!wrongNetwork) return true;
    try {
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
      return true;
    } catch {
      setBanner({ kind: 'error', text: 'Switch to the Arc network to continue.' });
      return false;
    }
  };

  /** Single entry point for every contract write: pins the chain, guards the network, tracks state. */
  const send = async (
    functionName: string,
    args: readonly unknown[],
    action: string,
    statusText: string,
    value?: bigint,
  ) => {
    if (pid === undefined) {
      setBanner({ kind: 'error', text: 'This project is not linked to the blockchain yet.' });
      return;
    }
    if (!(await guardNetwork())) return;
    setBanner(null);
    setLoading(true);
    setTxStatus(statusText);
    setActiveAction(action);
    writeContract({
      ...escrowContract,
      functionName,
      args,
      ...(value !== undefined ? { value } : {}),
    } as never);
  };

  const fetchProject = async () => {
    const { data } = await supabase.from('projects').select('*').eq('id', id).single();
    if (!data) {
      // RLS returns no row for a non-party or an unauthenticated visitor. If a project is
      // already on screen a failed refetch must not blank it, so this only matters on first load.
      setNotFound(true);
      return;
    }
    if (data) {
      setNotFound(false);
      setProject(data);

      const { data: profiles } = await supabase
        .from('profiles')
        .select('wallet_address, username')
        .in('wallet_address', [data.client, data.builder]);

      if (profiles) {
        const cProfile = profiles.find(p => p.wallet_address.toLowerCase() === data.client.toLowerCase());
        const bProfile = profiles.find(p => p.wallet_address.toLowerCase() === data.builder.toLowerCase());
        
        if (cProfile) setClientUsername(cProfile.username);
        if (bProfile) setBuilderUsername(bProfile.username);
      }
    }
  };

  /**
   * Update the presentation-only columns of a project.
   *
   * There is deliberately no `status` parameter. Under the RLS policies in
   * supabase/migrations/0001_rls_siwe.sql, the `authenticated` role has no UPDATE grant on
   * projects.status — nor on client, builder, budget, amount_wei or blockchain_id. Sending
   * one would fail with "permission denied for column status", and that is the point: it is
   * why a session can no longer mark someone else's project Completed to hide their
   * release button. Those columns belong to the service-role indexer.
   */
  const updateProjectFields = async (fields: Record<string, unknown>) => {
    // `.select('id')` matters: an UPDATE that RLS filters out returns `error: null` and zero
    // rows, which is indistinguishable from success unless we ask for the affected rows back.
    const { data, error } = await supabase.from('projects').update(fields).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Project update matched no rows (blocked by RLS or wrong id).');
  };

  const sendNotification = async (receiverWallet: string, message: string, type: string) => {
    if (!receiverWallet) return;
    try {
      // supabase-js reports failures (RLS rejection, missing session) through `error` and does
      // NOT throw, so without this check a refused insert vanished without a trace.
      const { error } = await supabase.from('notifications').insert([{
        wallet_address: receiverWallet,
        message: message,
        type: type,
        link: `/project/${id}`
      }]);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to send notification:", err);
    }
  };

  /**
   * Post-transaction Supabase write.
   *
   * IMPORTANT: this no longer writes `status`. Under the RLS policies in
   * supabase/migrations/0001_rls_siwe.sql, `authenticated` has no UPDATE grant on
   * projects.status, projects.client, projects.builder, projects.budget,
   * projects.amount_wei or projects.blockchain_id — a browser session physically cannot
   * change them. Those columns are owned by the service-role indexer, which derives them
   * from confirmed chain events. That is what makes it impossible for a session to mark
   * someone else's project Completed and hide their release button.
   *
   * What remains here is presentation only: notes, links, and the client's rating.
   */
  const handleDbSyncAfterWeb3 = async () => {
    setTxStatus('Saving…');
    try {
      switch (activeAction) {
        case 'Delivered':
          // Notes and links were saved in deliverWork() BEFORE the transaction was sent.
          await sendNotification(project.builder === authedWallet ? project.client : project.builder,
            `Work delivered for "${project.title}". Please review it.`, 'WORK_DELIVERED');
          break;
        case 'Completed':
          await updateProjectFields({ rating: selectedRating });
          await sendNotification(project.builder,
            `Funds released! Your work on "${project.title}" was approved.`, 'PROJECT_FUNDED');
          break;
        case 'Revision':
          await updateProjectFields({ revision_notes: revisionNote });
          setIsRevisionMode(false);
          await sendNotification(project.builder,
            `A revision was requested for "${project.title}".`, 'REVISION_REQUESTED');
          break;
        case 'Funded':
          await sendNotification(project.builder,
            `"${project.title}" is funded. You can start work.`, 'PROJECT_FUNDED');
          break;
        case 'Refunded_Builder':
        case 'Cancelled_Builder':
          await updateProjectFields({ revision_notes: 'Cancelled by builder' });
          await sendNotification(project.client,
            `The builder ended "${project.title}". You have been refunded.`, 'PROJECT_CANCELLED');
          break;
        case 'Refunded':
          await sendNotification(project.builder,
            `The client reclaimed funds for "${project.title}" after the deadline.`, 'PROJECT_CANCELLED');
          break;
        case 'Disputed':
          // Notified by the indexer from the DisputeRaised event (client, builder AND the
          // arbitrator, who a browser session cannot notify). Sending one here as well would
          // show every recipient the same dispute twice.
          break;
        case 'OfferSent':
          await sendNotification(isClient ? project.builder : project.client,
            `You have a settlement offer on "${project.title}".`, 'REVISION_REQUESTED');
          break;
        case 'Settled':
        case 'ForceResolved':
        case 'Ruled':
        case 'OfferWithdrawn':
          // Fully chain-derived; the indexer records the outcome.
          break;
      }
      await fetchProject();
    } catch (err) {
      // The transaction already succeeded on-chain. A failed cache write must never be
      // reported as a failed payment.
      setBanner({
        kind: 'info',
        text: 'Your transaction succeeded on-chain. Some details may take a moment to appear.',
      });
      console.error('Supabase sync failed after a successful transaction:', err);
    }
    setActiveAction(null);
    setLoading(false);
  };

  // Legacy DB-derived flags, kept only for the deadline countdown display.
  const isPastDeadline = act?.pastDeadline ?? false;

  // ---------------- actions (all routed through the guarded `send`) ----------------
  // fundProject is payable: msg.value must equal the project's registered amount EXACTLY
  // or the contract reverts with WrongValue. Read it from the chain (`onchain.amount`), not
  // from Supabase's amount_wei — the DB value is only a display mirror and can drift.
  const fundEscrow = () =>
    send('fundProject', [pid!], 'Funded', 'Confirm in your wallet…', onchain?.amount);

  const executeReleaseFunds = () => {
    setShowRatingModal(false);
    return send('releaseFunds', [pid!], 'Completed', 'Releasing funds…');
  };

  const forceClaimFunds = () =>
    send('claimByBuilder', [pid!], 'ForceCompleted', 'Claiming funds…');

  const claimRefund = () =>
    send('claimRefund', [pid!], 'Refunded', 'Reclaiming funds…');

  const submitRevision = () => {
    if (!revisionNote) { setBanner({ kind: 'error', text: 'Add a note describing what needs changing.' }); return; }
    return send('requestRevision', [pid!], 'Revision', 'Submitting feedback…');
  };

  // Declining an unfunded request and cancelling a funded contract are DIFFERENT contract
  // calls now. v1 overloaded one `cancelProject` for both, with identical duplicated
  // branches that differed only by a deadline check.
  const declineProject = () => {
    if (!window.confirm('Decline this project request?')) return;
    return send('cancelUnfunded', [pid!], 'Cancelled_Builder', 'Declining…');
  };

  const cancelByBuilder = () => {
    if (!window.confirm('Cancel the contract? The client will be refunded in full.')) return;
    return send('builderCancel', [pid!], 'Refunded_Builder', 'Refunding client…');
  };

  const deliverWork = async () => {
    if (!deliveryData.links) { setBanner({ kind: 'error', text: 'Add a link to your deliverable.' }); return; }
    if (!safeHref(deliveryData.links)) { setBanner({ kind: 'error', text: 'The delivery link must start with http:// or https://.' }); return; }

    // Save the notes and link FIRST. Doing it after the receipt meant a closed tab, a page
    // refresh or a failed write left the on-chain status at Delivered with nothing for the
    // client to review. If this fails we stop before the builder spends gas.
    setLoading(true);
    setTxStatus('Saving delivery details…');
    try {
      await updateProjectFields({
        delivery_notes: deliveryData.notes,
        delivery_links: deliveryData.links,
      });
    } catch (err) {
      console.error('Saving delivery details failed:', err);
      setLoading(false);
      setTxStatus('');
      setBanner({ kind: 'error', text: 'Could not save your delivery notes and link. Nothing was sent on-chain — please try again.' });
      return;
    }
    return send('markDelivered', [pid!], 'Delivered', 'Recording delivery…');
  };

  // ---------------- dispute + settlement (the four resolution paths) ----------------
  // Opening a dispute freezes the escrow with no undo, so it gets the same confirmation the
  // cancel and decline actions have. The wording follows the contract: a client can only
  // dispute delivered work (stale outcome 50/50), while a builder can dispute earlier — and
  // if that goes stale before delivery, the client is refunded in full.
  const raiseDispute = () => {
    const delivered = onchain?.status === ProjectStatus.Delivered;
    const staleOutcome = delivered
      ? 'If it is not resolved within 30 days, the funds are split 50/50.'
      : 'The work has not been delivered, so if it is not resolved within 30 days the client is refunded in full.';
    const who = hasArbitrator ? 'the designated arbitrator, an agreement between you,' : 'an agreement between you';
    const ok = window.confirm(
      `Open a dispute?\n\nThe escrowed funds are frozen until it is resolved by ${who} or the 30-day timeout. ` +
        `You cannot release or refund the project in the meantime.\n\n${staleOutcome}`,
    );
    if (!ok) return;
    return send('raiseDispute', [pid!], 'Disputed', 'Opening dispute…');
  };

  // Path 1. Only the designated arbitrator can call this on-chain; the buttons are gated on the
  // same check. The ruling pays out immediately and cannot be revised.
  //
  // `builderBps` is passed in rather than read from `rulingBps`, because the two outcomes an
  // arbitrator reaches for most — pay the builder, refund the client — are the endpoints of
  // that slider, and making someone drag a range input to exactly 0 or 10000 to express them
  // is an invitation to rule 99% by accident. The slider stays for genuine splits.
  const resolveAsArbitrator = (builderBps: number) => {
    const summary =
      builderBps === 10000
        ? '100% to the builder. The client is refunded nothing.'
        : builderBps === 0
          ? '100% refunded to the client. The builder is paid nothing.'
          : `${builderBps / 100}% to the builder and ${(10000 - builderBps) / 100}% refunded to the client.`;
    const ok = window.confirm(
      `Submit your ruling?\n\n${summary}\n\nThis pays out immediately and is final.`,
    );
    if (!ok) return;
    return send('resolveDispute', [pid!, builderBps], 'Ruled', 'Submitting ruling…');
  };

  const proposeSettlement = () =>
    send('proposeSettlement', [pid!, settlementBps], 'OfferSent', 'Sending offer…');

  const acceptSettlement = () =>
    send('acceptSettlement', [pid!, offer![1]], 'Settled', 'Accepting offer…');

  const withdrawSettlement = () =>
    send('withdrawSettlement', [pid!], 'OfferWithdrawn', 'Withdrawing offer…');

  const forceResolve = () =>
    send('forceResolveStaleDispute', [pid!], 'ForceResolved', 'Settling dispute…');


  if (!project) {
    if (notFound) return <AccessDenied signedIn={!!authedWallet} />;
    return (
      <div className="min-h-[calc(100vh-80px)] w-full flex items-center justify-center">
        <span className="w-8 h-8 rounded-full border-4 border-slate-800 border-t-blue-500 animate-spin"></span>
      </div>
    );
  }

  if (isUnauthorized) return <AccessDenied signedIn={!!authedWallet} />;

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-12 space-y-6 relative">
      
      {showRatingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowRatingModal(false)}></div>
          <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-8 max-w-md w-full relative z-10 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-emerald-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-white mb-2">Rate the Builder</h3>
              <p className="text-slate-400 text-sm">How was your experience working with @{builderUsername || project.builder}?</p>
            </div>

            <div className="flex justify-center gap-2 mb-8">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  onClick={() => setSelectedRating(star)}
                  className="focus:outline-none transition-transform hover:scale-110"
                >
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    viewBox="0 0 24 24" 
                    fill="currentColor" 
                    className={`w-10 h-10 transition-colors duration-200 ${
                      star <= (hoveredRating || selectedRating) 
                        ? 'text-yellow-400' 
                        : 'text-slate-700'
                    }`}
                  >
                    <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clipRule="evenodd" />
                  </svg>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowRatingModal(false)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-sm border border-slate-800"
              >
                Cancel
              </button>
              <button 
                onClick={executeReleaseFunds}
                className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white py-3 px-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] text-sm"
              >
                Confirm & Release Funds
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#0f172a]/60 border border-slate-800 rounded-[2rem] p-8 md:p-10 relative overflow-hidden shadow-2xl">
        
        <div className="absolute top-0 right-0 bg-[#050B14] px-6 py-3 rounded-bl-2xl border-b border-l border-slate-800/80">
          <span className={`text-xs font-black tracking-widest uppercase flex items-center gap-2 ${
            project.status === 'Completed' ? 'text-emerald-400' :
            onchain?.status === ProjectStatus.Cancelled ? 'text-red-400' :
            project.status === 'Refunded' ? 'text-orange-500' :
            onchain?.status === ProjectStatus.Delivered ? 'text-purple-400' :
            onchain?.status === ProjectStatus.InRevision ? 'text-orange-400' : onchain?.status === ProjectStatus.Disputed ? 'text-amber-400' : 'text-blue-400'
          }`}>
            {onchain?.status === ProjectStatus.Funded && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>}
            {onchain?.status === ProjectStatus.AwaitingFunds && <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse"></span>}
            {onchain ? STATUS_LABEL[onchain.status] : project.status}
          </span>
        </div>

        {/* The brief itself. It was never rendered on this page at all — the client typed it at
            /project/new and nobody, including the arbitrator ruling on the work, could read it
            back. RLS has always permitted it (migration 0001 grants SELECT on the whole row,
            0005 extends that to the arbitrator); only the markup was missing. */}
        <div className="mb-8 w-3/4">
          <h1 className="text-3xl font-black text-white leading-tight">{project.title}</h1>
          {project.description && (
            <p className="mt-3 text-sm text-slate-400 leading-relaxed whitespace-pre-wrap">
              {project.description}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Builder</p>
            {builderUsername ? (
              <Link href={`/${builderUsername}`} className="text-blue-400 hover:text-blue-300 font-bold text-sm truncate block transition-colors">
                @{builderUsername}
              </Link>
            ) : (
              <p className="text-white font-mono text-sm truncate">{project.builder}</p>
            )}
          </div>
          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Client</p>
            {clientUsername ? (
              <Link href={`/${clientUsername}`} className="text-blue-400 hover:text-blue-300 font-bold text-sm truncate block transition-colors">
                @{clientUsername}
              </Link>
            ) : (
              <p className="text-white font-mono text-sm truncate">{project.client.substring(0,6)}...{project.client.substring(project.client.length-4)}</p>
            )}
          </div>

          {/* Who rules if this goes wrong. The builder's acceptance of an arbitrator is implicit
              in starting work — the contract's own note on createProject tells them to verify it
              first — so it has to be legible here rather than only once a dispute is already
              open. Read from the chain, never from the client-written `arbitrator` column. */}
          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2 group relative w-max">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Arbitrator</p>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 cursor-help text-slate-500 transition-colors">
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-3 bg-slate-800 border border-slate-700 text-xs text-white rounded-xl shadow-xl z-20 font-normal normal-case text-center pointer-events-none">
                If this project is disputed, this is who decides how the escrow is split. Verify it before you start work.
              </div>
            </div>

            {arbitratorAddr === undefined ? (
              <p className="text-slate-600 font-mono text-sm">…</p>
            ) : hasArbitrator ? (
              <>
                {arbitratorUsername ? (
                  <Link href={`/${arbitratorUsername}`} className="text-blue-400 hover:text-blue-300 font-bold text-sm truncate block transition-colors">
                    @{arbitratorUsername}
                  </Link>
                ) : (
                  <p className="text-white font-mono text-sm truncate" title={arbitratorAddr as string}>
                    {short(arbitratorAddr as string)}
                  </p>
                )}
                {isArbitrator && (
                  <span className="mt-1.5 inline-block text-[10px] font-black uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                    You
                  </span>
                )}
              </>
            ) : (
              <p className="text-slate-400 font-bold text-sm truncate">
                {hasResolver ? 'Automatic' : 'None'}
              </p>
            )}
          </div>

          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Budget</p>
            <p className="text-blue-400 font-mono font-bold text-lg">{onchain ? formatUSDC(onchain.amount) : project.budget + ' USDC'}</p>
          </div>
          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            
            <div className="flex items-center gap-1.5 mb-2 group relative w-max">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Time Left</p>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 cursor-help text-slate-500 transition-colors">
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-3 bg-slate-800 border border-slate-700 text-xs text-white rounded-xl shadow-xl z-20 font-normal normal-case text-center pointer-events-none">
                This is the delivery deadline. If time runs out before the work is submitted, the client can reclaim the locked funds.
              </div>
            </div>

            {closedCard ? (
              <p className={`font-mono font-bold text-sm ${closedCard.text}`}>{closedCard.label}</p>
            ) : (
              <p className={`font-mono font-bold text-sm ${isPastDeadline ? 'text-red-400' : 'text-emerald-400'}`}>
                {timeLeft || 'Calculating...'}
              </p>
            )}
          </div>
        </div>

        <div className="pt-6 border-t border-slate-800/50">

          {banner && (
            <div
              className={`mb-6 p-4 rounded-xl text-sm font-bold border ${
                banner.kind === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="break-words">{banner.text}</span>
                <button onClick={() => setBanner(null)} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
              </div>
              {hash && txUrl(hash) && (
                <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer"
                   className="block mt-2 underline underline-offset-4 font-normal opacity-80 hover:opacity-100">
                  View transaction
                </a>
              )}
            </div>
          )}

          {wrongNetwork && (
            <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-bold flex items-center justify-between gap-3">
              <span>You&apos;re on the wrong network.</span>
              <button onClick={() => switchChainAsync({ chainId: ARC_CHAIN_ID }).catch(() => {})}
                      className="underline underline-offset-4 hover:text-amber-300 shrink-0">
                Switch to Arc
              </button>
            </div>
          )}

          {/* ============================================================
              DISPUTED — v1 rendered this state with no actions whatsoever,
              because on-chain there was no way out of it. All four
              resolution paths are surfaced here.
              ============================================================ */}
          {onchain?.status === ProjectStatus.Disputed && (
            <div className="bg-amber-950/20 border border-amber-900/50 p-6 md:p-8 rounded-3xl space-y-6">
              <div>
                <h3 className="text-amber-400 font-black text-lg mb-1">Dispute open</h3>
                <p className="text-sm text-slate-400">
                  {isArbitrator ? (
                    <>You are the designated arbitrator for this project. Your ruling is final.</>
                  ) : hasArbitrator ? (
                    <>
                      Awaiting a ruling from the agreed arbitrator{' '}
                      <span className="font-mono text-slate-300">{short(arbitratorAddr as string)}</span>. You can also
                      settle directly with the other party.
                    </>
                  ) : hasResolver ? (
                    <>
                      No arbitrator was named for this project, so the platform resolver may issue a ruling. You can
                      also settle directly with the other party.
                    </>
                  ) : (
                    <>
                      No arbitrator was named and automatic resolution is not enabled. Settle directly with the other
                      party — or, if you cannot agree, anyone can settle it after 30 days.
                    </>
                  )}
                </p>
              </div>

              {/* ---- PATH 1: the designated arbitrator's ruling ---- */}
              {isArbitrator && (
                <div className="bg-[#050B14] border border-amber-900/50 rounded-2xl p-5">
                  <p className="text-white font-bold text-sm mb-1">Your ruling</p>
                  <p className="text-xs text-slate-500 leading-relaxed mb-5">
                    Read the brief above and any delivered work below before you rule. Whichever you
                    choose pays out immediately and cannot be revised.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button onClick={() => resolveAsArbitrator(10000)} disabled={loading}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-sm transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                      {loading ? txStatus : 'Release to Builder'}
                    </button>
                    <button onClick={() => resolveAsArbitrator(0)} disabled={loading}
                            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-sm transition-all shadow-[0_0_15px_rgba(220,38,38,0.3)]">
                      {loading ? txStatus : 'Refund to Client'}
                    </button>
                  </div>

                  <div className="border-t border-amber-900/30 mt-5 pt-5">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                      Or split the escrow
                    </p>
                    <input type="range" min={0} max={10000} step={100} value={rulingBps}
                           onChange={(e) => setRulingBps(Number(e.target.value))}
                           className="w-full accent-amber-500 mb-2" />
                    <div className="flex justify-between text-xs text-slate-400 mb-4">
                      <span>Client refunded {(10000 - rulingBps) / 100}%</span>
                      <span>Builder paid {rulingBps / 100}%</span>
                    </div>
                    <button onClick={() => resolveAsArbitrator(rulingBps)} disabled={loading}
                            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-sm transition-all">
                      {loading ? txStatus : `Submit ${rulingBps / 100}/${(10000 - rulingBps) / 100} split`}
                    </button>
                  </div>
                </div>
              )}

              {/* ---- PATH 3: mutual 2-of-2, needs no third party at all ---- */}
              {act?.canProposeSettlement && (
                <div className="bg-[#050B14] border border-slate-800 rounded-2xl p-5">
                  {hasOffer ? (
                    <>
                      <p className="text-white font-bold text-sm mb-1">
                        {offer![0].toLowerCase() === address?.toLowerCase()
                          ? 'Your offer is awaiting a response'
                          : 'You have a settlement offer'}
                      </p>
                      <p className="text-slate-400 text-sm mb-4">
                        {offer![1] / 100}% to the builder, {(10000 - offer![1]) / 100}% refunded to the client.
                      </p>
                      {offer![0].toLowerCase() === address?.toLowerCase() ? (
                        <button onClick={withdrawSettlement} disabled={loading}
                                className="text-slate-400 hover:text-red-400 text-xs font-bold underline underline-offset-4">
                          Withdraw offer
                        </button>
                      ) : (
                        <button onClick={acceptSettlement} disabled={loading}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold text-sm">
                          {loading ? txStatus : 'Accept and settle'}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-white font-bold text-sm mb-3">Propose a split</p>
                      <input type="range" min={0} max={10000} step={500} value={settlementBps}
                             onChange={(e) => setSettlementBps(Number(e.target.value))}
                             className="w-full accent-emerald-500 mb-2" />
                      <div className="flex justify-between text-xs text-slate-400 mb-4">
                        <span>Client {(10000 - settlementBps) / 100}%</span>
                        <span>Builder {settlementBps / 100}%</span>
                      </div>
                      <button onClick={proposeSettlement} disabled={loading}
                              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-bold text-sm">
                        {loading ? txStatus : 'Send offer'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* ---- PATH 4: the permissionless deadlock breaker ---- */}
              <div className="border-t border-amber-900/30 pt-5">
                {act?.canForceResolve ? (
                  <button onClick={forceResolve} disabled={loading}
                          className="w-full bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-xl font-bold text-sm">
                    {loading ? txStatus : onchain.preDispute === ProjectStatus.Delivered
                      ? 'Force settle — split 50/50'
                      : 'Force settle — full refund to client'}
                  </button>
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    If nobody resolves this, anyone can settle it in{' '}
                    <span className="text-slate-300 font-bold">
                      {formatCountdown(act?.staleAt ?? 0n, chainNow)}
                    </span>{' '}
                    — {onchain.preDispute === ProjectStatus.Delivered
                      ? 'split 50/50 between both parties'
                      : 'refunded in full to the client'}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Escalation entry point. The asymmetry (client may only dispute a delivery,
              builder may dispute any funded stage) is encoded in deriveActions. */}
          {act?.canRaiseDispute && (
            <div className="mt-4 text-center">
              <button onClick={raiseDispute} disabled={loading}
                      className="text-slate-500 hover:text-amber-400 text-xs font-bold transition-colors underline decoration-slate-700 underline-offset-4">
                Something wrong? Open a dispute
              </button>
            </div>
          )}

          {/* How a dispute ended. A 50/50 settlement is recorded on-chain as Completed and a full
              refund as Refunded, so the bare status alone hides who got what. These columns are
              written by the indexer from the DisputeResolved event. */}
          {project.resolution_path != null &&
            (onchain?.status === ProjectStatus.Completed || onchain?.status === ProjectStatus.Refunded) && (
              <div className="mb-4 bg-amber-950/20 border border-amber-900/50 p-5 rounded-2xl">
                <h3 className="text-amber-400 font-bold text-sm mb-1">Dispute resolved</h3>
                <p className="text-sm text-slate-400">
                  Settled by {PATH_LABEL[project.resolution_path] ?? 'the escrow contract'}
                  {project.resolution_builder_bps != null && (
                    <>
                      {' '}— {project.resolution_builder_bps / 100}% to the builder,{' '}
                      {(10000 - project.resolution_builder_bps) / 100}% refunded to the client
                    </>
                  )}
                  .
                </p>
              </div>
            )}

          {onchain?.status === ProjectStatus.Cancelled && (
             <div className="text-center py-4">
               <div className="text-3xl mb-4">🚫</div>
               <h2 className="text-xl font-bold text-red-400 mb-2">Project Cancelled</h2>
               <p className="text-slate-400 text-sm">This project was cancelled before any funds were transferred.</p>
             </div>
          )}

          {act?.canClaimRefund && (
            <div className="bg-red-950/20 border border-red-900/50 p-6 rounded-2xl flex items-center justify-between">
               <div>
                 <h3 className="text-red-400 font-bold mb-1">Deadline Passed</h3>
                 <p className="text-sm text-slate-400">The builder failed to deliver on time.</p>
               </div>
               <button onClick={claimRefund} disabled={loading} className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-[0_0_15px_rgba(220,38,38,0.3)]">
                 {loading ? txStatus : 'Claim Full Refund'}
               </button>
            </div>
          )}

          {isBuilder && act?.pastDeadline && onchain?.status === ProjectStatus.Funded && (
            <div className="bg-red-950/20 border border-red-900/50 p-6 rounded-2xl text-center">
              <h2 className="text-red-400 font-bold text-lg mb-1">⚠️ Time Expired</h2>
              <p className="text-slate-400 text-sm">You missed the delivery deadline. The client can now claim a refund.</p>
            </div>
          )}

          {act?.canFund && (
            <div className="flex flex-col md:flex-row items-center justify-between bg-blue-950/10 border border-blue-900/30 p-6 rounded-2xl gap-4">
              <div>
                <h3 className="text-white font-bold mb-1">Action Required</h3>
                <p className="text-sm text-slate-400">Secure the smart contract to start the project.</p>
              </div>
              <button onClick={fundEscrow} disabled={loading} className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-[0_0_20px_-5px_rgba(37,99,235,0.4)]">
                {loading ? txStatus : `Fund ${project.budget} USDC`}
              </button>
            </div>
          )}

          {isBuilder && onchain?.status === ProjectStatus.AwaitingFunds && (
             <div className="flex flex-col md:flex-row items-center justify-between bg-[#050B14] border border-slate-800/80 p-6 rounded-2xl gap-4">
               <div>
                 <h2 className="text-lg font-bold text-white mb-1">⏳ Waiting for Funds</h2>
                 <p className="text-slate-400 text-sm">Do not start working until the client funds the escrow.</p>
               </div>
               <button onClick={declineProject} disabled={loading} className="w-full md:w-auto px-6 py-3 rounded-xl border border-red-900/50 text-red-500 hover:bg-red-950/30 font-bold transition-all text-sm">
                 {loading ? txStatus : 'Decline Request'}
               </button>
             </div>
          )}

          {isClient && onchain?.status === ProjectStatus.Funded && !act?.pastDeadline && (
            <div className="text-center py-6">
              <div className="text-4xl mb-4 animate-bounce">🛠️</div>
              <h2 className="text-xl font-bold text-white mb-2">Work in Progress</h2>
              <p className="text-slate-400 text-sm">Escrow secured. Waiting for @{builderUsername || project.builder} to submit the deliverables.</p>
            </div>
          )}

          {act?.canDeliver && (
            <div className="bg-[#050B14] border border-slate-800/80 p-6 md:p-8 rounded-3xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black text-white">Deliver Work</h2>
                <span className="bg-blue-950/30 text-blue-400 px-3 py-1 rounded-lg text-xs font-bold border border-blue-900/50 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" /></svg>
                  Escrow Secured
                </span>
              </div>
              <textarea 
                className="w-full bg-[#0f172a] p-4 rounded-xl border border-slate-700/50 text-white text-sm mb-4 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all resize-none" 
                placeholder="What did you complete? (Notes)" 
                rows={3}
                onChange={e => setDeliveryData({...deliveryData, notes: e.target.value})} 
              />
              <input 
                className="w-full bg-[#0f172a] p-4 rounded-xl border border-slate-700/50 text-white text-sm mb-6 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all" 
                placeholder="https://github.com/..." 
                onChange={e => setDeliveryData({...deliveryData, links: e.target.value})} 
              />
              <button onClick={deliverWork} disabled={loading} className="w-full bg-purple-600 hover:bg-purple-500 text-white py-4 rounded-xl font-bold transition-all shadow-[0_0_20px_-5px_rgba(168,85,247,0.4)] mb-6">
                {loading && txStatus === 'Recording Delivery on Blockchain...' ? txStatus : 'Submit Delivery'}
              </button>
              
              <div className="border-t border-slate-800 pt-6 text-center">
                 <button onClick={cancelByBuilder} disabled={loading} className="text-slate-500 hover:text-red-400 text-xs font-bold transition-colors underline decoration-slate-700 underline-offset-4">
                   Unable to complete? Cancel Contract & Refund Client
                 </button>
              </div>
            </div>
          )}

          {deliveryOnRecord && (
            <div className={`bg-[#050B14] border ${deliveredCard.border} p-6 md:p-8 rounded-3xl`}>
              <h2 className={`text-xl font-bold ${deliveredCard.text} mb-6 flex items-center gap-2`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" /></svg>
                {deliveredCard.title}
              </h2>

              <div className="bg-[#0f172a] p-5 rounded-2xl border border-slate-800/80 mb-6 text-sm text-slate-300">
                <p className="mb-4"><strong className="text-slate-500 uppercase text-xs tracking-wider block mb-1">Notes:</strong>{project.delivery_notes || <span className="text-slate-500 italic">No notes provided.</span>}</p>
                <p><strong className="text-slate-500 uppercase text-xs tracking-wider block mb-1">Link:</strong>{safeHref(project.delivery_links)
                  ? <a href={safeHref(project.delivery_links)!} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline break-all">{project.delivery_links}</a>
                  : project.delivery_links
                    ? <span className="break-all">{project.delivery_links}</span>
                    : <span className="text-slate-500 italic">No link recorded.</span>}</p>
              </div>
              
              {isClient && onchain?.status === ProjectStatus.Delivered && !isRevisionMode && (
                 <div className="flex flex-col sm:flex-row gap-4 mt-6 border-t border-slate-800 pt-6">
                   <button 
                     onClick={() => setShowRatingModal(true)} 
                     disabled={loading} 
                     className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-bold transition-all shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)]"
                   >
                     {loading && txStatus === 'Releasing Funds...' ? txStatus : 'Approve & Release Funds'}
                   </button>
                   <button onClick={() => setIsRevisionMode(true)} className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white py-4 rounded-xl font-bold transition-all">
                     Request Revision
                   </button>
                 </div>
              )}
              
              {isClient && onchain?.status === ProjectStatus.Delivered && isRevisionMode && (
                 <div className="mt-6 border-t border-slate-800 pt-6">
                   <textarea 
                     className="w-full bg-[#0f172a] p-4 rounded-xl border border-orange-900/30 text-white text-sm mb-4 outline-none focus:border-orange-500/50 transition-all resize-none" 
                     placeholder="What needs to be changed?" 
                     rows={3}
                     onChange={(e) => setRevisionNote(e.target.value)} 
                   />
                   <div className="flex gap-4">
                     <button onClick={() => setIsRevisionMode(false)} className="px-6 py-3 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-sm">Cancel</button>
                     <button onClick={submitRevision} disabled={loading} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-3 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(234,88,12,0.3)] text-sm">
                       {loading && txStatus === 'Submitting Feedback...' ? txStatus : 'Submit Feedback'}
                     </button>
                   </div>
                 </div>
              )}

              {isBuilder && onchain?.status === ProjectStatus.Delivered && (
                <div className="mt-6 pt-6 border-t border-slate-800/80 flex flex-col items-center">
                  
                  <div className="flex items-center gap-1.5 mb-4 group relative w-max">
                    <p className="text-slate-400 text-sm">Waiting for the client to review the work...</p>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 cursor-help text-slate-500 transition-colors">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                    </svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-72 p-3 bg-slate-800 border border-slate-700 text-xs text-white rounded-xl shadow-xl z-20 font-normal normal-case text-center pointer-events-none">
                      Review period is active. If the client takes no action before this timer ends, the builder becomes eligible to claim the funds.
                    </div>
                  </div>

                  <button 
                    onClick={forceClaimFunds} 
                    disabled={!(act?.canClaimByBuilder ?? false) || loading} 
                    className={`w-full py-3 rounded-xl font-bold transition-all text-sm ${(act?.canClaimByBuilder ?? false) ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-[#0f172a] border border-slate-800 text-slate-500 cursor-not-allowed'}`}
                  >
                    {loading && txStatus === 'Claiming Funds...' ? txStatus : ((act?.canClaimByBuilder ?? false) ? 'Force Release (Claim Now)' : `Force Release (${forceReleaseTimeLeft || 'Calculating...'})`)}
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}