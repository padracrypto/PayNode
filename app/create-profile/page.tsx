'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabase'; // Ensure this path is correct

export default function CreateProfilePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState('');

  // Profile State
  const [username, setUsername] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  
  // تغییرات جدید برای مهارت‌ها (آرایه و اینپوت جداگانه)
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  
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
    try {
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('username, "about me", skills, github, x, linkedin, website')
        .eq('wallet_address', userWallet)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Error fetching profile:', fetchError);
        return;
      }

      if (data) {
        setUsername(data.username || '');
        setAboutMe(data['about me'] || ''); 
        
        // هندل کردن دیتای مهارت‌ها از دیتابیس
        let normalizedSkills: string[] = [];
        if (Array.isArray(data.skills)) {
          normalizedSkills = data.skills;
        } else if (typeof data.skills === 'string' && data.skills) {
          normalizedSkills = data.skills.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        setSkills(normalizedSkills);

        setSocials({
          github: data.github || '',
          x: data.x || '', 
          linkedin: data.linkedin || '',
          website: data.website || ''
        });
      }
    } catch (err) {
      console.error('Unexpected error fetching profile:', err);
    }
  };

  // تابع اضافه کردن مهارت با دکمه Enter
  const handleAddSkill = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const newSkill = skillInput.trim();
      if (newSkill && !skills.includes(newSkill)) {
        setSkills([...skills, newSkill]);
      }
      setSkillInput('');
    }
  };

  // تابع حذف مهارت با کلیک روی ضربدر
  const removeSkill = (skillToRemove: string) => {
    setSkills(skills.filter(s => s !== skillToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      setError('Wallet is not connected.');
      return;
    }
    
    setLoading(true);
    setError('');

    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          "about me": aboutMe,
          skills: skills,
          github: socials.github,
          x: socials.x,
          linkedin: socials.linkedin,
          website: socials.website
        })
        .eq('wallet_address', address);

      if (updateError) throw updateError;

      // Redirect to user's public profile
      router.push(`/${username}`);
      
    } catch (err: any) {
      console.error('Save error:', err);
      setError(err.message || 'Failed to save profile. Please try again.');
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

        {error && (
          <div className="bg-red-900/20 border border-red-900/50 text-red-400 p-4 rounded-2xl mb-6 text-sm font-bold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

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
                  value={username ? `@${username}` : ''}
                  disabled
                  placeholder="Loading..."
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

            {/* بخش جدید UI برای تگ‌های مهارت */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Skills</label>
              <div className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl p-3 flex flex-wrap gap-2 items-center min-h-[56px] focus-within:border-blue-500/50 transition-all">
                {skills.map((skill, index) => (
                  <span key={index} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/30 text-blue-400 border border-blue-800/50 rounded-lg text-sm font-bold">
                    {skill}
                    <button type="button" onClick={() => removeSkill(skill)} className="text-blue-400 hover:text-white transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={handleAddSkill}
                  placeholder={skills.length === 0 ? "Type a skill and press Enter..." : "Add another skill..."}
                  className="flex-1 bg-transparent text-slate-300 text-sm outline-none min-w-[150px] py-1 px-2 placeholder:text-slate-600"
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">Press <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] text-slate-300">Enter</kbd> to add a skill.</p>
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