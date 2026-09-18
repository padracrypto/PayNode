'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatUSDC, formatAmount } from '@/lib/paynode';
import { useSiwe } from '@/app/providers/SiweProvider';

interface Project {
  id: string;
  title: string;
  budget: number;
  amount_wei: string | null;
  builder: string;
  client: string;
  status: string;
  created_at: string;
  last_event_block: number | null;
}

interface Tip {
  id: string;
  sender_wallet: string;
  receiver_wallet: string;
  amount: number;
  amount_wei: string | null;
  verified: boolean;
  message: string;
  created_at: string;
}

/**
 * Statuses in which the escrow contract is still holding funds.
 * Mirrors _isFundedStatus() in PayNodeEscrowV2, plus AwaitingFunds which is pre-escrow but
 * still actionable. Written by the indexer, never by a browser session.
 */
const ACTIVE_STATUSES = ['AwaitingFunds', 'Funded', 'Delivered', 'Revision', 'Disputed'] as const;

const byNewest = <T extends { created_at?: string }>(a: T, b: T) =>
  (b.created_at ? Date.parse(b.created_at) : 0) - (a.created_at ? Date.parse(a.created_at) : 0);

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const { authedWallet, status: authStatus } = useSiwe();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // The VERIFIED wallet, not the connected one. Querying by useAccount().address would show
  // data for an address the server has not authenticated — and under the RLS policies in
  // migration 0001 those queries return nothing anyway, since the JWT drives every filter.
  const wallet = authedWallet;
  const ready = mounted && isConnected && authStatus === 'authenticated' && !!wallet;

  // ---------------------------------------------------------------------------
  // Keying every query by wallet is what prevents the stale-data leak: on account
  // switch React Query treats it as a different cache entry rather than briefly
  // rendering the previous account's projects under the new address.
  // keepPreviousData holds the last good render during a refetch, so the panels
  // update in place instead of collapsing to a spinner on every poll.
  // ---------------------------------------------------------------------------
  const profileQuery = useQuery({
    queryKey: ['profile', wallet],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('wallet_address', wallet!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', wallet],
    enabled: ready,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
    queryFn: async () => {
      // Scoped server-side. The previous implementation did .select('*') with NO filter and
      // narrowed in JavaScript, which shipped every project in the database — titles,
      // budgets, delivery links, wallet pairs — to every visitor's browser.
      const { data, error } = await supabase
        .from('projects')
        .select('id,title,budget,amount_wei,builder,client,status,created_at,last_event_block')
        .or(`client.eq.${wallet},builder.eq.${wallet}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });

  const tipsQuery = useQuery({
    queryKey: ['tips', wallet],
    enabled: ready,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tips')
        .select('id,sender_wallet,receiver_wallet,amount,amount_wei,verified,message,created_at')
        .eq('receiver_wallet', wallet!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Tip[];
    },
  });

  // Onboarding redirect, but only once the profile query has actually resolved. Firing it
  // on a transient null used to bounce users out of their own dashboard.
  useEffect(() => {
    if (!ready || profileQuery.isPending || profileQuery.isError) return;
    if (!profileQuery.data?.username) router.push('/onboarding');
  }, [ready, profileQuery.isPending, profileQuery.isError, profileQuery.data, router]);

  const username = profileQuery.data?.username ?? null;
  const projects = projectsQuery.data ?? [];
  const recentTips = tipsQuery.data ?? [];

  // Show the skeleton only on a true cold load. During background refetches the previous
  // data is still rendered, so nothing flickers.
  const isLoading = ready && (projectsQuery.isPending || tipsQuery.isPending);
  const isRefreshing = projectsQuery.isFetching || tipsQuery.isFetching;
  const loadError = projectsQuery.error ?? tipsQuery.error;

  const activeProjects = projects
    .filter((p) => (ACTIVE_STATUSES as readonly string[]).includes(p.status))
    .sort(byNewest);
  const pastProjects = projects
    .filter((p) => !(ACTIVE_STATUSES as readonly string[]).includes(p.status))
    .sort(byNewest);

  const activeContractsCount = activeProjects.length;

  // Sum in integer units, never in floats. amount_wei is written by the indexer from the
  // ProjectCreated log; budget is a display string the client supplied.
  const totalLockedWei = activeProjects.reduce(
    (sum, p) => sum + (p.amount_wei ? BigInt(p.amount_wei) : 0n),
    0n,
  );
  const totalLockedAmount = formatAmount(totalLockedWei);

  // Only tips the indexer has confirmed on-chain. An unverified row is a self-reported
  // claim — counting it would let anyone inflate any creator's displayed earnings.
  const verifiedTips = recentTips.filter((t) => t.verified);
  const totalTipsWei = verifiedTips.reduce(
    (sum, t) => sum + (t.amount_wei ? BigInt(t.amount_wei) : 0n),
    0n,
  );
  const totalTips = formatAmount(totalTipsWei);
  const pendingTipCount = recentTips.length - verifiedTips.length;

  const formatAddress = (addr: string | undefined) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '');

  const scrollbarClasses = "max-h-[380px] overflow-y-auto pr-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600";

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-6 py-10 text-slate-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight mb-1 flex items-center gap-2">
            Welcome back,{' '}
            {mounted && isConnected ? (
              username ? (
                <Link href={`/${username}`} className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 hover:opacity-80 transition-opacity">
                  @{username}
                </Link>
              ) : (
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Builder</span>
              )
            ) : (
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-slate-400 to-slate-500">Not Connected</span>
            )}
          </h1>
          <p className="text-sm text-slate-500 font-mono">
            Wallet: {mounted && isConnected ? address : 'Not Connected'}
          </p>
        </div>
        
        <div>
          <Link 
            href="/settings"
            className="relative group flex items-center justify-center gap-3 px-6 py-3 bg-[#0f172a]/80 border border-slate-700/50 hover:border-blue-500/50 rounded-2xl text-slate-300 hover:text-white transition-all duration-300 backdrop-blur-xl overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.2)] hover:shadow-[0_0_30px_rgba(59,130,246,0.15)]"
          >
            <span className="relative z-10 font-bold text-sm tracking-wide">Edit Profile</span>
          </Link>
        </div>
      </div>

      {/* A read failure must be visible. The old implementation caught the error, logged it
          to the console, and rendered an empty dashboard — indistinguishable from a user
          who genuinely has no projects. */}
      {loadError && (
        <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-bold flex items-center justify-between gap-3">
          <span>Could not load your dashboard. Your funds are safe on-chain.</span>
          <button
            onClick={() => { void projectsQuery.refetch(); void tipsQuery.refetch(); }}
            className="underline underline-offset-4 hover:text-red-300 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {pendingTipCount > 0 && (
        <div className="mb-6 p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50 text-slate-400 text-xs">
          {pendingTipCount} tip{pendingTipCount === 1 ? '' : 's'} awaiting on-chain confirmation.
          Totals count confirmed tips only.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-[#0f172a]/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm relative overflow-hidden group">
          <p className="text-slate-400 text-sm font-bold mb-2 flex items-center gap-2">
            Total Locked in Escrow
            {/* Quiet in-place indicator instead of tearing the panel down on every poll. */}
            {isRefreshing && <span className="w-2 h-2 rounded-full bg-blue-400/60 animate-pulse" title="Syncing" />}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-white">${totalLockedAmount}</span>
            <span className="text-xs font-bold text-slate-500">USDC</span>
          </div>
        </div>

        <div className="bg-[#0f172a]/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm relative overflow-hidden group">
          <p className="text-slate-400 text-sm font-bold mb-2">Total Tips Received</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-emerald-400">${totalTips}</span>
            <span className="text-xs font-bold text-slate-500">USDC</span>
          </div>
        </div>

        <div className="bg-[#0f172a]/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm relative overflow-hidden group">
          <p className="text-slate-400 text-sm font-bold mb-2">Active Contracts</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-white">{activeContractsCount}</span>
            <span className="text-xs font-bold text-slate-500">Ongoing</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-10">
          
          <div className="space-y-6">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <div className="w-2 h-6 bg-blue-500 rounded-full"></div>
              Active Escrow Contracts
            </h2>

            {!mounted || isLoading ? (
              <div className="p-10 border border-slate-800 border-dashed rounded-3xl text-center">
                <p className="text-slate-500 font-bold animate-pulse">Syncing with blockchain data...</p>
              </div>
            ) : activeProjects.length === 0 ? (
              <div className="p-10 bg-[#0f172a]/30 border border-slate-800 rounded-3xl text-center">
                <p className="text-slate-400 font-bold mb-2">No active escrows found.</p>
                <p className="text-slate-500 text-sm">When you start a project or get hired, your contracts will appear here.</p>
              </div>
            ) : (
              <div className={`space-y-4 ${scrollbarClasses}`}>
                {activeProjects.map((project) => (
                  <div key={project.id} className="bg-[#050B14] border border-slate-800 rounded-3xl p-6 hover:border-slate-700 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white mb-1">{project.title}</h3>
                        <p className="text-sm text-slate-500 flex items-center gap-2">
                          Role: <span className="text-blue-400 font-mono">
                            {project.client?.toLowerCase() === address?.toLowerCase() ? 'Client' : 'Builder'}
                          </span>
                        </p>
                      </div>
                      <div className="px-3 py-1 rounded-full bg-blue-900/30 border border-blue-800/50 text-blue-400 text-xs font-bold uppercase tracking-wider">
                        {project.status}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-4 border-t border-slate-800/50">
                      <div>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Locked Amount</p>
                        <p className="text-lg font-black text-white">{project.amount_wei ? formatUSDC(BigInt(project.amount_wei)) : `$${project.budget} USDC`}</p>
                      </div>
                      <Link href={`/project/${project.id}`} className="text-sm text-slate-400 hover:text-white font-bold transition-colors">
                        View Details →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {pastProjects.length > 0 && (
            <div className="space-y-6 pt-6 border-t border-slate-800/80">
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <div className="w-2 h-6 bg-emerald-500 rounded-full"></div>
                Completed & Past Contracts
              </h2>

              <div className={`space-y-4 ${scrollbarClasses}`}>
                {pastProjects.map((project) => (
                  <div key={project.id} className="bg-[#050B14]/60 border border-slate-800/60 rounded-3xl p-6 hover:border-slate-700 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-slate-200 mb-1">{project.title}</h3>
                        <p className="text-sm text-slate-500 flex items-center gap-2">
                          Role: <span className="text-slate-400 font-mono">
                            {project.client?.toLowerCase() === address?.toLowerCase() ? 'Client' : 'Builder'}
                          </span>
                        </p>
                      </div>
                      <div className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border bg-emerald-950/40 border-emerald-900/50 text-emerald-400">
                        {project.status}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-4 border-t border-slate-800/40">
                      <div>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Final Budget</p>
                        <p className="text-lg font-black text-slate-300">{project.amount_wei ? formatUSDC(BigInt(project.amount_wei)) : `$${project.budget} USDC`}</p>
                      </div>
                      <Link href={`/project/${project.id}`} className="text-sm text-blue-400 hover:text-blue-300 font-bold transition-colors">
                        View Record →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <div className="w-2 h-6 bg-emerald-500 rounded-full"></div>
            Recent Tips
          </h2>
          <div className="bg-[#0f172a]/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm">
            {isLoading ? (
              <p className="text-slate-500 text-sm text-center">Loading tips...</p>
            ) : recentTips.length > 0 ? (
              <div className={`space-y-4 ${scrollbarClasses}`}>
                {recentTips.map((tip) => (
                  <div key={tip.id} className="bg-[#050B14]/80 border border-slate-800/80 rounded-2xl p-4 hover:border-slate-700 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-mono text-slate-400" title={tip.sender_wallet}>
                        {formatAddress(tip.sender_wallet)}
                      </span>
                      <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold">
                        + {tip.amount_wei ? formatUSDC(BigInt(tip.amount_wei)) : `$${tip.amount}`}{!tip.verified && <span className="ml-1 text-[10px] font-bold text-slate-500 uppercase">pending</span>}
                      </span>
                    </div>
                    {tip.message && (
                      <p className="text-sm text-slate-300 italic mb-2 break-words">"{tip.message}"</p>
                    )}
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                        {new Date(tip.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm text-center py-4">No tips received yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}