'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabase';

export default function PublicProfilePage() {
  const { username } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tipSuccess = searchParams.get('tip') === 'success';
  useAccount();
  
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [stats, setStats] = useState({ rating: '0.0', completed: 0 });

  useEffect(() => {
    if (username) fetchProfile();
  }, [username]);

  const fetchProfile = async () => {
    setLoading(true);
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('wallet_address, username, "about me", skills, github, x, linkedin, website')
      .eq('username', username)
      .single();

    if (profileData && !profileError) {
      setProfile(profileData);
      
      const { data: projects } = await supabase
        .from('projects')
        .select('rating')
        .eq('builder', profileData.wallet_address)
        .eq('status', 'Completed');

      const completedCount = projects?.length || 0;
      const avgRating = completedCount > 0 
        ? (projects!.reduce((acc, curr) => acc + (Number(curr.rating) || 5), 0) / completedCount).toFixed(1) 
        : '0.0';
        
      setStats({ rating: avgRating, completed: completedCount });
    }
    setLoading(false);
  };

  const formatAddress = (addr: string) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
  
  const getShortUrl = (url: string, type: string) => {
    try {
      if (type === 'x') return `@${url.split('/').pop()}`;
      if (type === 'website') return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      return url.replace(/^https?:\/\/(www\.)?/, '');
    } catch { return 'Visit'; }
  };

  if (loading) return <div className="flex justify-center py-20 text-slate-500">Loading...</div>;
  if (!profile) return <div className="text-center py-20 text-white">Profile not found.</div>;

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-12">
      
      {tipSuccess && (
        <div className="mb-8 w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-4 rounded-2xl flex items-center justify-center gap-3 font-bold shadow-[0_0_20px_rgba(16,185,129,0.15)] animate-in fade-in slide-in-from-top-4 duration-500">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
          Tip sent successfully! Thank you for supporting @{profile.username}.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-[#0f172a]/60 border border-slate-800 rounded-3xl p-8 backdrop-blur-md relative">
            
            <div className="mb-8 flex items-center justify-center">
              <div className="relative flex items-center justify-center w-24 h-24 rounded-[2rem] bg-[#0f172a]/80 border border-slate-700/50 shadow-[0_0_50px_rgba(59,130,246,0.15)] backdrop-blur-xl">
                <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-14 h-14">
                  <defs><linearGradient id="paynode-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#3B82F6"/><stop offset="100%" stopColor="#A855F7"/></linearGradient></defs>
                  <circle cx="28" cy="50" r="16" stroke="url(#paynode-grad)" strokeWidth="7"/><circle cx="72" cy="50" r="16" stroke="url(#paynode-grad)" strokeWidth="7"/><path d="M44 50h12" stroke="url(#paynode-grad)" strokeWidth="7" strokeLinecap="round"/><circle cx="50" cy="50" r="4.5" fill="#34D399" className="animate-pulse" />
                </svg>
              </div>
            </div>

            <h1 className="text-2xl font-black text-white text-center">@{profile.username}</h1>
            
            <div className="mt-8 space-y-4">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Links & Identity</div>
              <div className="space-y-3 text-sm">
                {profile.github && <div className="flex justify-between"><span className="text-slate-500">GitHub:</span><a href={profile.github} target="_blank" className="text-blue-400 hover:text-blue-300 font-mono transition-colors">{getShortUrl(profile.github, 'github')}</a></div>}
                {profile.x && <div className="flex justify-between"><span className="text-slate-500">X:</span><a href={profile.x} target="_blank" className="text-blue-400 hover:text-blue-300 font-mono transition-colors">{getShortUrl(profile.x, 'x')}</a></div>}
                {profile.linkedin && <div className="flex justify-between"><span className="text-slate-500">LinkedIn:</span><a href={profile.linkedin} target="_blank" className="text-blue-400 hover:text-blue-300 font-mono transition-colors">linkedin.com/in/...</a></div>}
                {profile.website && <div className="flex justify-between"><span className="text-slate-500">Website:</span><a href={profile.website} target="_blank" className="text-blue-400 hover:text-blue-300 font-mono transition-colors">{getShortUrl(profile.website, 'website')}</a></div>}
                
                <div className="pt-3 mt-3 border-t border-slate-800/50">
                  <span className="text-slate-500">Wallet:</span>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                    <p className="font-mono text-blue-400">{formatAddress(profile.wallet_address)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          
          <div className="grid grid-cols-2 bg-[#0f172a]/60 border border-slate-800 rounded-3xl p-6 relative divide-x divide-slate-800/50">
             <div className="text-center px-4">
               <div className="text-3xl font-black text-white flex justify-center items-center gap-1">
                 {stats.rating} 
                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-yellow-400"><path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clipRule="evenodd" /></svg>
               </div>
               <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">Client Rating</div>
             </div>
             <div className="text-center px-4">
               <div className="text-3xl font-black text-white">{stats.completed}</div>
               <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">Escrows Done</div>
             </div>
          </div>

          <div className="bg-[#0f172a]/60 border border-slate-800 rounded-3xl p-8">
            <h2 className="text-xl font-black text-white mb-4">About Me</h2>
            <p className="text-slate-400 leading-relaxed">{profile['about me'] || "No description provided."}</p>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mt-8 mb-4">Core Skills</h3>
            <div className="flex flex-wrap gap-2">
              {profile.skills?.map((skill: string, i: number) => (
                <span key={i} className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-blue-300">{skill}</span>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <button 
              onClick={() => router.push(`/${profile.username}/tip`)}
              className="flex-1 py-4 bg-[#050B14] border border-emerald-500/30 hover:border-emerald-500 hover:bg-emerald-500/10 text-emerald-400 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M10.75 10.818v2.614A3.13 3.13 0 0011.888 13c.482-.315.612-.648.612-.875 0-.227-.13-.56-.612-.875a3.13 3.13 0 00-1.138-.432zM8.33 8.62c.053.055.115.11.184.164.208.16.46.284.736.363V6.603a2.45 2.45 0 00-.35.13c-.14.065-.27.143-.386.233-.377.292-.514.627-.514.909 0 .284.137.617.514.91z" />
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
              </svg>
              Send Tip
            </button>
            <button 
              onClick={() => router.push(`/project/new?builder=${profile.wallet_address}`)}
              className="flex-[2] py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)]"
            >
              Start Collaboration
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}