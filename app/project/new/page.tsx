'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
  useChainId,
  useSwitchChain,
} from 'wagmi';
import { parseUnits, decodeEventLog, isAddress, zeroAddress } from 'viem';
import { supabase } from '@/lib/supabase';
import {
  escrowContract,
  PAYNODE_ESCROW_ABI,
  ARC_CHAIN_ID,
  ARC_DECIMALS,
  PROTOCOL,
  describeTxError,
} from '@/lib/paynode';
import { useSiwe, RequireSiwe } from '@/app/providers/SiweProvider';

function ProjectForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const builderParam = searchParams.get('builder') || '';

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { authedWallet } = useSiwe();

  const wrongNetwork = isConnected && chainId !== ARC_CHAIN_ID;

  const [formData, setFormData] = useState({
    title: '',
    budget: '',
    delivery_type: 'Fixed Price',
    deadline: '',
    maxRevisions: '2',
    description: '',
    builderWallet: builderParam.startsWith('0x') ? builderParam : '',
    arbitratorWallet: '',
  });
  const [useArbitrator, setUseArbitrator] = useState(false);

  const [localError, setLocalError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const { data: hash, error: writeError, isPending, writeContract } = useWriteContract();

  // `isSuccess` means the receipt was FETCHED, not that the transaction succeeded — viem
  // resolves waitForTransactionReceipt for reverted transactions too. Checking status is
  // what stops a reverted tx from being written to the database as a success.
  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isMined,
  } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });
  const isConfirmed = isMined && receipt?.status === 'success';

  // React 18 StrictMode double-invokes effects, and any dep change re-fires them.
  // Without this guard a single transaction inserts the project row twice.
  const syncedRef = useRef<string | null>(null);

  const todayObj = new Date();
  const today = new Date(todayObj.getTime() - todayObj.getTimezoneOffset() * 60000)
    .toISOString()
    .split('T')[0];

  useEffect(() => {
    if (isMined && receipt?.status === 'reverted') {
      setIsSyncing(false);
      setLocalError('The transaction reverted on-chain. No project was created and no funds moved.');
      return;
    }
    if (isConfirmed && hash && syncedRef.current !== hash) {
      syncedRef.current = hash;
      void handlePostConfirmation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, isMined, receipt, hash]);

  const handlePostConfirmation = async () => {
    try {
      setIsSyncing(true);
      if (!publicClient) throw new Error('Blockchain client not initialised.');

      const txReceipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });

      let blockchainId: number | null = null;
      for (const log of txReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: PAYNODE_ESCROW_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'ProjectCreated') {
            blockchainId = Number((decoded.args as { projectId: bigint }).projectId);
            break;
          }
        } catch {
          // Log from another contract, or an event outside our ABI. Skip it.
        }
      }

      // The old fallback read `projectCounter` and subtracted 1. That was wrong twice over:
      // createProject does `++projectCounter` and returns THAT value, so the row was bound to
      // the PREVIOUS project — and the counter is global, so concurrent creates race anyway.
      // The event is the only authoritative source; fail loudly rather than guess an id.
      if (blockchainId === null) {
        throw new Error('Could not read the project ID from the transaction receipt.');
      }

      await syncToDatabase(blockchainId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to read the project from the chain.');
      setIsSyncing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (!isConnected || !address) {
      setLocalError('Please connect your wallet first.');
      return;
    }

    if (wrongNetwork) {
      try {
        await switchChainAsync({ chainId: ARC_CHAIN_ID });
      } catch {
        setLocalError('Switch to the Arc network to continue.');
        return;
      }
    }

    if (Number(formData.budget) <= 0) {
      setLocalError('Budget must be greater than 0 USDC.');
      return;
    }

    if (!isAddress(formData.builderWallet)) {
      setLocalError('Invalid builder wallet address.');
      return;
    }
    if (formData.builderWallet.toLowerCase() === address.toLowerCase()) {
      setLocalError('You cannot hire yourself.');
      return;
    }

    // Mirrors the contract's SelfDeal() check, so the user gets a sentence instead of a revert.
    let arbitrator: string = zeroAddress;
    if (useArbitrator) {
      if (!isAddress(formData.arbitratorWallet)) {
        setLocalError('Enter a valid arbitrator address, or switch to automatic resolution.');
        return;
      }
      const a = formData.arbitratorWallet.toLowerCase();
      if (a === address.toLowerCase() || a === formData.builderWallet.toLowerCase()) {
        setLocalError('The arbitrator must be a neutral third party, not you or the builder.');
        return;
      }
      arbitrator = formData.arbitratorWallet;
    }

    const revisions = Number(formData.maxRevisions);
    if (!Number.isInteger(revisions) || revisions < 0 || revisions > PROTOCOL.MAX_REVISIONS_CAP) {
      setLocalError(`Revisions must be between 0 and ${PROTOCOL.MAX_REVISIONS_CAP}.`);
      return;
    }

    const deadlineDate = new Date(formData.deadline);
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    deadlineDate.setHours(0, 0, 0, 0);

    const durationDays = Math.max(
      1,
      Math.ceil((deadlineDate.getTime() - todayDate.getTime()) / (1000 * 3600 * 24)),
    );
    if (durationDays > PROTOCOL.MAX_DURATION_DAYS) {
      setLocalError(`The deadline cannot be more than ${PROTOCOL.MAX_DURATION_DAYS} days away.`);
      return;
    }

    try {
      writeContract({
        ...escrowContract, // pins address, abi AND chainId — wagmi refuses any other chain
        functionName: 'createProject',
        args: [
          formData.builderWallet as `0x${string}`,
          parseUnits(formData.budget, ARC_DECIMALS),
          BigInt(durationDays),
          revisions,
          arbitrator as `0x${string}`,
        ],
      });
    } catch (err) {
      setLocalError(describeTxError(err) ?? 'Failed to initiate the transaction.');
    }
  };

  const syncToDatabase = async (blockchainId: number) => {
    try {
      const { data, error: sbError } = await supabase
        .from('projects')
        .insert([
          {
            title: formData.title,
            // Store the display string AND the exact on-chain integer. Never round-trip an
            // escrow amount through a JS float: fundProject requires msg.value to match the
            // registered amount exactly, and a single ulp of drift bricks the project.
            budget: formData.budget,
            amount_wei: parseUnits(formData.budget, ARC_DECIMALS).toString(),
            delivery_type: formData.delivery_type,
            deadline: formData.deadline,
            description: formData.description,
            builder: formData.builderWallet.toLowerCase(),
            client: (authedWallet ?? address ?? '').toLowerCase(),
            arbitrator: useArbitrator ? formData.arbitratorWallet.toLowerCase() : null,
            status: 'AwaitingFunds',
            tx_hash: hash,
            blockchain_id: blockchainId,
          },
        ])
        .select()
        .single();

      if (sbError) throw sbError;
      if (data) router.push(`/project/${data.id}`);
    } catch (err) {
      // supabase-js resolves `{ error }` as a plain object, not an Error instance, unless
      // .throwOnError() is used (it isn't here) — `err instanceof Error` was always false for
      // a failed insert, silently discarding the actual RLS/constraint message with nothing
      // logged anywhere. Pull `.message` off whatever shape came back instead of gating on it.
      console.error('[project/new] Failed to save project after on-chain confirmation:', err);
      const detail =
        err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
          ? err.message
          : null;
      setLocalError(
        detail
          ? `Project created on-chain, but saving it failed: ${detail}`
          : 'Project created on-chain, but saving it failed.',
      );
      setIsSyncing(false);
    }
  };

  const isProcessing = isPending || isConfirming || isSyncing;
  const displayError = localError || describeTxError(writeError);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-[#0f172a]/80 border border-slate-800/80 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/10 rounded-full blur-[80px] pointer-events-none -mr-10 -mt-10"></div>

        <div className="mb-8 relative z-10">
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">Start a New Project</h1>
          <p className="text-slate-400 text-sm">
            Deploy your terms to the blockchain and secure funds with PayNode escrow.
          </p>
        </div>

        {wrongNetwork && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 p-4 rounded-xl mb-6 text-sm font-bold flex items-center justify-between gap-3 relative z-10">
            <span>You&apos;re on the wrong network.</span>
            <button
              type="button"
              onClick={() => switchChainAsync({ chainId: ARC_CHAIN_ID }).catch(() => {})}
              className="underline underline-offset-4 hover:text-amber-300 shrink-0"
            >
              Switch to Arc
            </button>
          </div>
        )}

        {displayError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-xl mb-6 text-sm font-bold flex items-center gap-2 relative z-10">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            <span className="break-all">{displayError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Project Title *</label>
            <input
              type="text"
              required
              placeholder="e.g., Build a custom AI agent"
              className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Builder Wallet Address *</label>
            <input
              type="text"
              required
              placeholder="0x..."
              className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600 font-mono"
              value={formData.builderWallet}
              onChange={(e) => setFormData({ ...formData, builderWallet: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Budget (USDC) *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  placeholder="100"
                  className="w-full bg-[#050B14] pl-8 pr-4 py-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600"
                  value={formData.budget}
                  onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Deadline *</label>
              <input
                type="date"
                required
                min={today}
                className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all [color-scheme:dark]"
                value={formData.deadline}
                onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Delivery Type</label>
              <select
                className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none appearance-none transition-all cursor-pointer"
                value={formData.delivery_type}
                onChange={(e) => setFormData({ ...formData, delivery_type: e.target.value })}
              >
                <option value="Fixed Price">Fixed Price (Standard Escrow)</option>
                <option value="Milestones" disabled>Milestones (Coming Soon)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Max Revisions</label>
              <input
                type="number"
                min="0"
                max={PROTOCOL.MAX_REVISIONS_CAP}
                required
                className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all"
                value={formData.maxRevisions}
                onChange={(e) => setFormData({ ...formData, maxRevisions: e.target.value })}
              />
              <p className="text-[11px] text-slate-500">
                Each revision extends the deadline by 7 days. Max {PROTOCOL.MAX_REVISIONS_CAP}.
              </p>
            </div>
          </div>

          {/* ---------- Dispute resolution ---------- */}
          <div className="space-y-3 pt-2">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
              Dispute Resolution
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setUseArbitrator(false)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  !useArbitrator ? 'border-blue-500/50 bg-blue-950/20' : 'border-slate-700/50 bg-[#050B14] hover:border-slate-600'
                }`}
              >
                <p className="text-white font-bold text-sm mb-1">Automatic</p>
                <p className="text-slate-400 text-xs">
                  Resolved by PayNode&apos;s resolver, or by mutual agreement between you and the builder.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setUseArbitrator(true)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  useArbitrator ? 'border-blue-500/50 bg-blue-950/20' : 'border-slate-700/50 bg-[#050B14] hover:border-slate-600'
                }`}
              >
                <p className="text-white font-bold text-sm mb-1">Named arbitrator</p>
                <p className="text-slate-400 text-xs">
                  A third party you both trust decides. Recommended for high-value work.
                </p>
              </button>
            </div>

            {useArbitrator && (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="0x… arbitrator address"
                  className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm font-mono focus:border-blue-500/50 outline-none transition-all"
                  value={formData.arbitratorWallet}
                  onChange={(e) => setFormData({ ...formData, arbitratorWallet: e.target.value })}
                />
                <p className="text-xs text-amber-400/80">
                  Agree this address with your builder first — you are choosing it unilaterally, and
                  their only recourse is to cancel and refund you.
                </p>
              </div>
            )}

            {/* These are terms of the agreement. Users should read them before signing, not
                discover them on day 30. */}
            <p className="text-xs text-slate-500 leading-relaxed">
              If a dispute goes unresolved for 30 days, anyone can settle it: funds split 50/50 if
              work was delivered, or return to you in full if it never was.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Project Description</label>
            <textarea
              required
              rows={4}
              placeholder="Describe the requirements, deliverables, and expectations..."
              className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all resize-none placeholder:text-slate-600"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800/50 mt-6">
            <button
              type="button"
              onClick={() => router.back()}
              disabled={isProcessing}
              className="text-sm font-bold text-slate-400 hover:text-white transition-colors px-4 py-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isProcessing || wrongNetwork}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-white rounded-xl font-bold transition-all shadow-[0_0_20px_-5px_rgba(37,99,235,0.4)] disabled:shadow-none flex items-center justify-center min-w-[180px]"
            >
              {isProcessing ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-white animate-spin mr-2"></span>
                  {isPending ? 'Check your wallet…' : isConfirming ? 'Confirming on-chain…' : 'Saving…'}
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <div className="min-h-[calc(100vh-80px)] w-full flex items-center justify-center px-6 py-12">
      <Suspense
        fallback={
          <div className="w-full max-w-2xl mx-auto flex justify-center py-20">
            <span className="w-8 h-8 rounded-full border-4 border-slate-800 border-t-blue-500 animate-spin"></span>
          </div>
        }
      >
        <RequireSiwe>
          <ProjectForm />
        </RequireSiwe>
      </Suspense>
    </div>
  );
}
