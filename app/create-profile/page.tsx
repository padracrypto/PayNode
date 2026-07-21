'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabase';

export default function CreateProfilePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Profile State
  const [username, setUsername] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  const [skills, setSkills] = useState('');
  const [socials, setSocials] = useState({
    github: '',
    x: '',
    linkedin: '',
    website: ''
  });

  useEffect(() => {
    setMounted(true);
    if (isConnected && address) {
      fetchExistingProfile(address);
    }
  }, [isConnected, address]);

  const fetchExistingProfile = async (userWallet: string) => {
    // اصلاح نام ستون‌ها بر اساس دیتابیس شما
    const { data } = await supabase
      .from('profiles')
      .select('username, "about me", skills, github, x, linkedin, website')
      .eq('wallet_address', userWallet)
      .single();

    if (data) {
      setUsername(data.username || '');
      setAboutMe(data['about me'] || ''); 
      setSkills(Array.isArray(data.skills) ? data.skills.join(', ') : data.skills || '');
      setSocials({
        github: data.github || '',
        x: data.x || '', // اصلاح نام ستون از twitter به x
        linkedin: data.linkedin || '',
        website: data.website || ''
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    setLoading(true);

    try {
      const skillsArray = skills.split(',').map(s => s.trim());

      // استفاده از نام دقیق ستون‌ها طبق تصویر
      const { error } = await supabase
        .from('profiles')
        .update({
          "about me": aboutMe,
          skills: skillsArray,
          github: socials.github,
          x: socials.x,
          linkedin: socials.linkedin,
          website: socials.website
        })
        .eq('wallet_address', address);

      if (error) throw error;

      // هدایت به صفحه پروفایل عمومی کاربر
      router.push(`/${username}`);
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save profile. Please check console for details.');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-[calc(100vh-80px)] w-full flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">Complete Your Profile</h1>
          <p className="text-slate-400 text-sm">Add details to help clients find and collaborate with you.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#0f172a]/60 border border-slate-800/80 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl shadow-2xl">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Wallet Address</label>
                <input 
                  type="text" 
                  value={address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
                  disabled
                  className="w-full bg-[#050B14]/50 border border-slate-800/50 rounded-xl px-4 py-3 text-slate-500 font-mono text-sm cursor-not-allowed"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Username</label>
                <input 
                  type="text" 
                  value={`@${username}`}
                  disabled
                  className="w-full bg-[#050B14]/50 border border-slate-800/50 rounded-xl px-4 py-3 text-slate-500 font-bold text-sm cursor-not-allowed"
                />
              </div>
            </div>

            <div className="h-px w-full bg-slate-800/50 my-2"></div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">About Me</label>
              <textarea 
                value={aboutMe}
                onChange={(e) => setAboutMe(e.target.value)}
                placeholder="Tell the community about your expertise..."
                rows={4}
                className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-4 py-3 text-slate-300 text-sm focus:outline-none focus:border-blue-500/50 transition-all resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Skills (Comma Separated)</label>
              <input 
                type="text" 
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="e.g. Next.js, Solidity, Security Audit"
                className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-4 py-3 text-slate-300 text-sm focus:outline-none focus:border-blue-500/50 transition-all"
              />
            </div>

            <div className="space-y-4 pt-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Social Links & Identity</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input type="url" placeholder="GitHub URL" value={socials.github} onChange={(e) => setSocials({...socials, github: e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-4 py-3 text-slate-300 text-sm focus:outline-none focus:border-blue-500/50 transition-all" />
                <input type="url" placeholder="X (Twitter) URL" value={socials.x} onChange={(e) => setSocials({...socials, x: e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-4 py-3 text-slate-300 text-sm focus:outline-none focus:border-blue-500/50 transition-all" />
                <input type="url" placeholder="LinkedIn URL" value={socials.linkedin} onChange={(e) => setSocials({...socials, linkedin: e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-4 py-3 text-slate-300 text-sm focus:outline-none focus:border-blue-500/50 transition-all" />
                <input type="url" placeholder="Website URL" value={socials.website} onChange={(e) => setSocials({...socials, website: e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-4 py-3 text-slate-300 text-sm focus:outline-none focus:border-blue-500/50 transition-all" />
              </div>
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full mt-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all disabled:bg-slate-800"
          >
            {loading ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}