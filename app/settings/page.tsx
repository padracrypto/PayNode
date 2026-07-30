'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import Link from 'next/link';
import { supabase } from '../lib/supabase';

export default function UserSettingsPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  
  const [skillInput, setSkillInput] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isConnected && address) {
      loadProfile(address);
    } else if (mounted && !isConnected) {
      setLoading(false);
    }
  }, [isConnected, address, mounted]);

  const loadProfile = async (wallet: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .ilike('wallet_address', wallet)
      .maybeSingle();
      
    if (data) {
      let normalizedSkills = [];
      if (Array.isArray(data.skills)) {
        normalizedSkills = data.skills;
      } else if (typeof data.skills === 'string') {
        normalizedSkills = data.skills.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      setProfile({ ...data, skills: normalizedSkills });
    }
    setLoading(false);
  };

  const handleAddSkill = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const newSkill = skillInput.trim();
      if (newSkill && !profile.skills?.includes(newSkill)) {
        setProfile({ ...profile, skills: [...(profile.skills || []), newSkill] });
      }
      setSkillInput('');
    }
  };

  const removeSkill = (skillToRemove: string) => {
    setProfile({
      ...profile,
      skills: profile.skills.filter((s: string) => s !== skillToRemove)
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !address) return;
    setSaving(true);
    
    const { error } = await supabase
      .from('profiles')
      .update({
        "about me": profile['about me'],
        skills: profile.skills,
        github: profile.github,
        x: profile.x,
        linkedin: profile.linkedin,
        website: profile.website,
      })
      .ilike('wallet_address', address);

    setSaving(false);
    
    if (!error) {
      router.push(`/${profile.username}`);
    } else {
      console.error("Update error:", error);
      alert("Error updating profile.");
    }
  };

  if (!mounted) return null;

  if (loading) return <div className="flex-1 flex items-center justify-center text-slate-500 font-mono py-20 animate-pulse">Syncing profile data...</div>;
  if (!isConnected) return <div className="flex-1 flex items-center justify-center text-slate-400 py-20 font-bold">Please connect your wallet first.</div>;
  
  if (!profile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20">
        <p className="text-white text-xl font-bold mb-4">Profile not found.</p>
        <Link href="/onboarding" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all">Create Profile</Link>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full max-w-2xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-black text-white tracking-tight">Edit Profile</h1>
        <Link href="/dashboard" className="text-sm font-bold text-slate-400 hover:text-blue-400 transition-colors">← Back to Dashboard</Link>
      </div>

      <form onSubmit={handleUpdate} className="bg-[#0f172a]/60 border border-slate-800 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-[80px] pointer-events-none -mr-20 -mt-20"></div>

        <div className="space-y-6 relative z-10">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Username (Locked)</label>
            <input type="text" value={`@${profile.username}`} disabled className="w-full bg-[#050B14]/50 border border-slate-800 rounded-xl px-5 py-4 text-slate-500 cursor-not-allowed font-bold" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">About Me</label>
            <textarea value={profile['about me'] || ''} onChange={(e) => setProfile({...profile, 'about me': e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-5 py-4 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none" rows={4} />
          </div>

          <div className="pt-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Skills</label>
            <div className="bg-[#050B14] border border-slate-700/50 rounded-xl p-3 flex flex-wrap gap-2 items-center min-h-[56px] focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
              {profile.skills?.map((skill: string, index: number) => (
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
                placeholder={profile.skills?.length === 0 ? "Type a skill and press Enter..." : "Add another skill..."}
                className="flex-1 bg-transparent text-white text-sm outline-none min-w-[150px] py-1 px-2 placeholder:text-slate-600"
              />
            </div>
            <p className="text-xs text-slate-500 mt-2">Press <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] text-slate-300">Enter</kbd> to add a skill.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-800/50 mt-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">GitHub</label>
              <input type="url" value={profile.github || ''} onChange={(e) => setProfile({...profile, github: e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-5 py-3 text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all" />
            </div>
            
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">X (Twitter)</label>
              <input type="url" value={profile.x || ''} onChange={(e) => setProfile({...profile, x: e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-5 py-3 text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all" />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">LinkedIn</label>
              <input type="url" value={profile.linkedin || ''} onChange={(e) => setProfile({...profile, linkedin: e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-5 py-3 text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all" />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Personal Website</label>
              <input type="url" value={profile.website || ''} onChange={(e) => setProfile({...profile, website: e.target.value})} className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-5 py-3 text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all" />
            </div>
          </div>

          <button type="submit" disabled={saving} className="w-full mt-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-black text-lg shadow-[0_0_30px_-10px_rgba(59,130,246,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2">
            {saving ? 'Saving Changes...' : 'Update Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}