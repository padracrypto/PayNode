'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

interface Project {
  id: string;
  title: string;
  budget: number;
  builder: string;
  client: string;
  status: string;
  created_at: string;
}

interface Tip {
  id: string;
  sender_wallet: string;
  receiver_wallet: string;
  amount: number;
  message: string;
  created_at: string;
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [totalTips, setTotalTips] = useState<number>(0);
  const [recentTips, setRecentTips] = useState<Tip[]>([]);
  
  const [showAllPast, setShowAllPast] = useState(false);
  const [showAllTips, setShowAllTips] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isConnected && address) {
      fetchDashboardData(address);
    } else {
      setProjects([]);
      setUsername(null);
      setTotalTips(0);
      setRecentTips([]);
      setIsLoading(false);
    }
  }, [isConnected, address]);

  const fetchDashboardData = async (userWallet: string) => {
    setIsLoading(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('wallet_address', userWallet)
        .maybeSingle(); 
      
      if (!profile || !profile.username) {
        router.push('/onboarding');
        return; 
      }

      setUsername(profile.username);

      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*');

      if (projectsError) throw projectsError;

      const userProjects = (projectsData || []).filter(
        (p) => 
          p.client?.toLowerCase() === userWallet.toLowerCase() || 
          p.builder?.toLowerCase() === userWallet.toLowerCase()
      );

      userProjects.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });

      setProjects(userProjects);

      const { data: tipsData, error: tipsError } = await supabase
        .from('tips')
        .select('*');

      if (!tipsError && tipsData) {
        const userTips = tipsData.filter(
          (t) => t.receiver_wallet?.toLowerCase() === userWallet.toLowerCase()
        );
        
        userTips.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });

        const sum = userTips.reduce((acc, tip) => acc + Number(tip.amount || 0), 0);
        setTotalTips(sum);
        setRecentTips(userTips);
      }

    } catch (err: any) {
      console.error("Data fetch error details:", err.message || err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatAddress = (addr: string | undefined) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const activeStatuses = ['AwaitingFunds', 'Pending', 'Funded', 'Delivered', 'Revision', 'Disputed'];
  const activeProjects = projects.filter(p => activeStatuses.includes(p.status));
  const pastProjects = projects.filter(p => !activeStatuses.includes(p.status));
  
  const visiblePastProjects = showAllPast ? pastProjects : pastProjects.slice(0, 3);
  const visibleTips = showAllTips ? recentTips : recentTips.slice(0, 3);
  
  const activeContractsCount = activeProjects.length;
  const totalLockedAmount = activeProjects.reduce((sum, p) => sum + Number(p.budget || 0), 0);

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-[#0f172a]/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm relative overflow-hidden group">
          <p className="text-slate-400 text-sm font-bold mb-2">Total Locked in Escrow</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-white">${totalLockedAmount.toLocaleString()}</span>
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
              activeProjects.map((project) => (
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
                      <p className="text-lg font-black text-white">${project.budget} USDC</p>
                    </div>
                    <Link href={`/project/${project.id}`} className="text-sm text-slate-400 hover:text-white font-bold transition-colors">
                      View Details →
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>

          {pastProjects.length > 0 && (
            <div className="space-y-6 pt-6 border-t border-slate-800/80">
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <div className="w-2 h-6 bg-emerald-500 rounded-full"></div>
                Completed & Past Contracts
              </h2>

              {visiblePastProjects.map((project) => (
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
                      <p className="text-lg font-black text-slate-300">${project.budget} USDC</p>
                    </div>
                    <Link href={`/project/${project.id}`} className="text-sm text-blue-400 hover:text-blue-300 font-bold transition-colors">
                      View Record →
                    </Link>
                  </div>
                </div>
              ))}

              {pastProjects.length > 3 && (
                <div className="text-center pt-2">
                  <button 
                    onClick={() => setShowAllPast(!showAllPast)}
                    className="px-6 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-sm font-bold"
                  >
                    {showAllPast ? 'Show Less' : `View All Past Contracts (${pastProjects.length})`}
                  </button>
                </div>
              )}
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
              <div className="space-y-4">
                {visibleTips.map((tip) => (
                  <div key={tip.id} className="bg-[#050B14]/80 border border-slate-800/80 rounded-2xl p-4 hover:border-slate-700 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-mono text-slate-400" title={tip.sender_wallet}>
                        {formatAddress(tip.sender_wallet)}
                      </span>
                      <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold">
                        + ${tip.amount}
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
                
                {recentTips.length > 3 && (
                  <div className="text-center pt-4 border-t border-slate-800/50 mt-2">
                    <button 
                      onClick={() => setShowAllTips(!showAllTips)}
                      className="w-full px-6 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-sm font-bold"
                    >
                      {showAllTips ? 'Show Less' : `View All Tips (${recentTips.length})`}
                    </button>
                  </div>
                )}
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