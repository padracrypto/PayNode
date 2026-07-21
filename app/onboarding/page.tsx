'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabase'; // Ensure this path is correct

export default function OnboardingPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    username: '',
    role: 'client' 
  });

  // Ensure hydration matches client state
  useEffect(() => {
    setMounted(true);
  }, []);

  const formatAddress = (addr: string | undefined) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      setError('Please connect your wallet first.');
      return;
    }

    setLoading(true);
    setError('');

    if (formData.username.length < 3) {
      setError('Username must be at least 3 characters.');
      setLoading(false);
      return;
    }

    try {
      const { error: sbError } = await supabase
        .from('profiles')
        .insert([
          {
            wallet_address: address, // Using the real connected wallet
            username: formData.username.toLowerCase().trim(),
            role: formData.role
          }
        ]);

      if (sbError) {
        if (sbError.code === '23505') {
          throw new Error('This username or wallet is already registered!');
        }
        throw new Error(sbError.message);
      }
      
      // Redirect to profile creation upon success
      router.push('/create-profile');
      
    } catch (err: any) {
      setError(err.message || 'An error occurred while creating your profile.');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-[calc(100vh-80px)] bg-[#050B14] w-full flex flex-col items-center justify-center p-6 relative overflow-x-hidden text-slate-300">
      
      {/* Background ambient light effect */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl h-[400px] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none z-0"></div>

      <div className="relative z-10 w-full max-w-md mt-4">
        
        {/* Form Card */}
        <div className="bg-[#0f172a]/90 border border-slate-700/50 p-8 rounded-3xl backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.5)]">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">Set up your profile</h1>
            <p className="text-slate-400 text-sm">Create your decentralized identity.</p>
          </div>

          {/* Real Wallet Connection Display */}
          <div className="p-4 bg-[#050B14] border border-slate-800 rounded-xl flex items-center justify-between mb-8 shadow-inner">
            <div className="flex items-center gap-3">
              {/* Wallet Icon */}
              <div className="w-10 h-10 rounded-full bg-blue-900/20 flex items-center justify-center border border-blue-800/50">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-blue-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Connected Wallet</p>
                <p className="font-mono text-slate-300 text-sm">
                  {isConnected ? formatAddress(address) : 'Not Connected'}
                </p> 
              </div>
            </div>
            
            {/* Active Status Indicator */}
            {isConnected && (
              <div className="flex items-center gap-2 px-3 py-1 bg-emerald-900/20 border border-emerald-500/20 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"></div>
                <span className="text-xs text-emerald-400 font-bold">Active</span>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 text-red-400 p-3 rounded-xl mb-6 text-sm font-bold flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Role Selection */}
            <div>
              <label className="block text-sm font-bold text-slate-400 mb-3">I am a...</label>
              <div className="grid grid-cols-2 gap-4">
                
                <button
                  type="button"
                  onClick={() => setFormData({...formData, role: 'client'})}
                  className={`p-5 rounded-2xl border transition-all flex flex-col items-center gap-3 group ${
                    formData.role === 'client' 
                      ? 'bg-blue-600/10 border-blue-500 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.15)]' 
                      : 'bg-[#050B14] border-slate-700/50 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-8 h-8 transition-transform ${formData.role === 'client' ? 'scale-110' : 'group-hover:scale-110'}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z" />
                  </svg>
                  <span className={`font-bold tracking-wide ${formData.role === 'client' ? 'text-white' : ''}`}>Client</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFormData({...formData, role: 'builder'})}
                  className={`p-5 rounded-2xl border transition-all flex flex-col items-center gap-3 group ${
                    formData.role === 'builder' 
                      ? 'bg-purple-600/10 border-purple-500 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.15)]' 
                      : 'bg-[#050B14] border-slate-700/50 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-8 h-8 transition-transform ${formData.role === 'builder' ? 'scale-110' : 'group-hover:scale-110'}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                  </svg>
                  <span className={`font-bold tracking-wide ${formData.role === 'builder' ? 'text-white' : ''}`}>Builder</span>
                </button>
              </div>
            </div>

            {/* Username */}
            <div>
              <label className="block text-sm font-bold text-slate-400 mb-2">Username</label>
              <div className="relative group">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold group-focus-within:text-blue-400 transition-colors">@</span>
                <input 
                  type="text" 
                  required
                  placeholder="Type a username..."
                  className="w-full bg-[#050B14] p-4 pl-10 rounded-xl border border-slate-700/50 text-white focus:border-blue-500 outline-none transition-all font-mono shadow-inner focus:shadow-[0_0_15px_rgba(37,99,235,0.1)]"
                  value={formData.username}
                  onChange={(e) => setFormData({...formData, username: e.target.value.replace(/[^a-zA-Z0-9_]/g, '')})}
                />
              </div>
            </div>

            {/* Submit Button */}
            <button 
              type="submit" 
              disabled={loading || formData.username.length < 3 || !address}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-white py-4 rounded-xl font-bold transition-all shadow-[0_0_30px_-10px_rgba(37,99,235,0.5)] disabled:shadow-none mt-4 flex justify-center items-center gap-2"
            >
              {loading ? 'Processing...' : 'Continue →'}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}