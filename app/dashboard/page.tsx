<<<<<<< HEAD
'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

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
  
  // استیت جدید برای کنترل نمایش لیست قراردادهای گذشته
  const [showAllPast, setShowAllPast] = useState(false);

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
      const { data: profile, error: profileError } = await supabase
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
        // اینجا همون محدودیتی هست که قبلا خودت گذاشتی (۵ انعام آخر)
        setRecentTips(userTips.slice(0, 5));
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
  
  // منطق نمایش محدود پروژه‌های گذشته (۳ تای اول در حالت عادی)
  const visiblePastProjects = showAllPast ? pastProjects : pastProjects.slice(0, 3);

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
            aria-label="Edit Profile Settings"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 relative z-10 group-hover:rotate-90 transition-transform duration-500 ease-in-out text-slate-400 group-hover:text-blue-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <span className="relative z-10 font-bold text-sm tracking-wide">Edit Profile</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-[#0f172a]/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-blue-500/20"></div>
          <p className="text-slate-400 text-sm font-bold mb-2">Total Locked in Escrow</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-white">${totalLockedAmount.toLocaleString()}</span>
            <span className="text-xs font-bold text-slate-500">USDC</span>
          </div>
        </div>

        <div className="bg-[#0f172a]/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-emerald-500/20"></div>
          <p className="text-slate-400 text-sm font-bold mb-2">Total Tips Received</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-emerald-400">${totalTips}</span>
            <span className="text-xs font-bold text-slate-500">USDC</span>
          </div>
        </div>

        <div className="bg-[#0f172a]/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-purple-500/20"></div>
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
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-400">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Locked Amount</p>
                        <p className="text-lg font-black text-white">${project.budget} USDC</p>
                      </div>
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
                    <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
                      project.status === 'Completed' ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400' :
                      project.status === 'Cancelled' || project.status === 'Refunded' ? 'bg-red-950/40 border-red-900/50 text-red-400' :
                      'bg-slate-800 border-slate-700 text-slate-400'
                    }`}>
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

              {/* دکمه باز و بسته کردن لیست */}
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
                {recentTips.map((tip) => (
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
              </div>
            ) : (
              <p className="text-slate-500 text-sm text-center py-4">No tips received yet.</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
=======
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('PENDING');
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProjects() {
      // این بار فقط گفتیم همه پروژه‌ها رو بیار و کاری به تاریخ نداشته باش
      const { data, error } = await supabase
        .from('projects')
        .select('*');
      
      // این دو خط رو اضافه کردم تا اگر باز هم مشکلی بود، بهمون دقیق بگه مشکل چیه
      console.log("Supabase Error:", error);
      console.log("Supabase Data:", data);
      
      if (!error && data) {
        setProjects(data);
      }
      setLoading(false);
    }
    
    fetchProjects();
  }, []);

  const filteredProjects = projects.filter(p => {
    const projectStatus = (p.status || 'PENDING').toUpperCase();
    return projectStatus === activeTab;
  });

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-extrabold mb-8 tracking-tight">Dashboard</h1>
        
        <div className="flex border-b border-slate-700 mb-6 space-x-8">
          {['PENDING', 'ACTIVE', 'COMPLETED'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-all ${activeTab === tab ? 'border-b-2 border-green-400 text-green-400' : 'text-slate-400 hover:text-slate-300'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-slate-400 animate-pulse">⏳ Loading your projects...</p>
        ) : filteredProjects.length === 0 ? (
          <p className="text-slate-500 italic">No projects found in this category.</p>
        ) : (
          <div className="space-y-4">
            {filteredProjects.map((project) => (
              <div key={project.id} className="bg-slate-800 p-5 rounded-xl border border-slate-700 flex justify-between items-center hover:border-slate-500 transition-all">
                <div>
                  <h3 className="text-lg font-bold text-white">{project.title}</h3>
                  <p className="text-sm text-slate-400 mt-1 line-clamp-1">{project.description}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-400">{project.budget} USDC</p>
                  <Link href={`/project/${project.id}`}>
                    <button className="mt-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-all">
                      View Details ➡️
                    </button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
>>>>>>> 0c8861c1432ec02fbefa50456b56404b620b9408
}