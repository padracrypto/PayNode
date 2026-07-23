'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabase';

export default function HomePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [isRouting, setIsRouting] = useState(false);

  const handleLaunchApp = async (e: React.MouseEvent) => {
    e.preventDefault();

    if (!isConnected || !address) {
      router.push('/onboarding');
      return;
    }

    setIsRouting(true);
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('wallet_address', address)
        .maybeSingle();

      if (data && data.username) {
        router.push(`/${data.username}`);
      } else {
        router.push('/onboarding');
      }
    } catch (error) {
      console.error("Routing error:", error);
      router.push('/onboarding');
    } finally {
      setIsRouting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] bg-[#050B14] text-slate-300 font-sans relative overflow-x-hidden flex flex-col items-center">
      
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[200%] md:w-full max-w-4xl h-[500px] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none z-0"></div>

      <div className="fixed bottom-6 right-6 z-50">
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-full px-5 py-2.5 flex items-center gap-3 shadow-[0_0_20px_rgba(0,0,0,0.5)] hover:bg-slate-800 transition-colors cursor-default">
          <div className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
          </div>
          <span className="text-slate-400 text-xs font-bold tracking-widest">
            Built on <span className="text-white">Arc</span>
          </span>
        </div>
      </div>

      <main className="relative z-10 flex-1 flex flex-col justify-center items-center text-center px-6 w-full max-w-5xl mx-auto mt-24 mb-32">
        
        <div className="mb-10 flex items-center justify-center">
          <div className="relative flex items-center justify-center w-24 h-24 rounded-[2rem] bg-[#0f172a]/80 border border-slate-700/50 shadow-[0_0_50px_rgba(59,130,246,0.15)] backdrop-blur-xl group hover:scale-105 transition-transform duration-500">
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-14 h-14">
              <defs>
                <linearGradient id="paynode-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3B82F6"/>
                  <stop offset="100%" stopColor="#A855F7"/>
                </linearGradient>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>
              
              <circle cx="28" cy="50" r="16" stroke="url(#paynode-grad)" strokeWidth="7" filter="url(#glow)"/>
              <circle cx="72" cy="50" r="16" stroke="url(#paynode-grad)" strokeWidth="7" filter="url(#glow)"/>
              <path d="M44 50h12" stroke="url(#paynode-grad)" strokeWidth="7" strokeLinecap="round" filter="url(#glow)"/>
              <circle cx="50" cy="50" r="4.5" fill="#34D399" className="animate-pulse" />
            </svg>
            <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-tr from-blue-500/5 to-purple-500/5 pointer-events-none"></div>
          </div>
        </div>

        <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight mb-8 leading-tight drop-shadow-2xl">
          Trustless Escrow.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
            Seamless Tipping.
          </span>
        </h1>

        <p className="text-lg md:text-xl text-slate-400 mb-12 max-w-2xl leading-relaxed">
          The ultimate Web3 platform for content creators and builders. Secure your freelance contracts in smart escrow, deliver your work, or simply receive tips directly from your community. 
        </p>

        <div className="flex flex-col sm:flex-row gap-5 w-full sm:w-auto">
          <button 
            onClick={handleLaunchApp}
            disabled={isRouting}
            className="px-12 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg transition-all shadow-[0_0_40px_-10px_rgba(37,99,235,0.7)] flex items-center justify-center gap-2 hover:scale-105 active:scale-95 disabled:opacity-80 disabled:hover:scale-100 disabled:cursor-wait"
          >
            {isRouting ? (
              <>
                <span className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin"></span>
                Routing...
              </>
            ) : (
              <>
                Launch App
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 ml-1">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </>
            )}
          </button>
          
          <Link 
            href="#features" 
            className="px-12 py-4 rounded-2xl bg-[#0f172a] hover:bg-slate-800 border border-slate-700 text-white font-bold text-lg transition-all flex items-center justify-center hover:scale-105 active:scale-95"
          >
            How it works
          </Link>
        </div>
      </main>

      <section id="features" className="relative z-10 w-full max-w-6xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <div className="bg-[#0f172a] border border-slate-800 p-8 rounded-3xl hover:bg-slate-800/80 transition-all hover:-translate-y-2 group shadow-xl">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)] group-hover:shadow-[0_0_25px_rgba(59,130,246,0.3)] transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-blue-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Client-Builder Trust</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Define the job and lock funds in an automated smart contract. No intermediaries, absolute transparency.
            </p>
          </div>

          <div className="bg-[#0f172a] border border-slate-800 p-8 rounded-3xl hover:bg-slate-800/80 transition-all hover:-translate-y-2 group shadow-xl">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.1)] group-hover:shadow-[0_0_25px_rgba(168,85,247,0.3)] transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-purple-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Powered by Arc Network</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Experience lightning-fast transactions and minimal gas fees utilizing the robust Arc infrastructure.
            </p>
          </div>

          <div className="bg-[#0f172a] border border-slate-800 p-8 rounded-3xl hover:bg-slate-800/80 transition-all hover:-translate-y-2 group shadow-xl">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)] group-hover:shadow-[0_0_25px_rgba(16,185,129,0.3)] transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-emerald-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Creator Tipping</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Not just for fixed projects. Content creators can receive direct tips from their community with zero platform cuts.
            </p>
          </div>

        </div>
      </section>

    </div>
  );
}