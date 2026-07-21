'use client';

import { useState, use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { supabase } from '@/app/lib/supabase';

export default function SendTipPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const router = useRouter();
  
  const { address: senderAddress, isConnected } = useAccount();

  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [profile, setProfile] = useState<any>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [localError, setLocalError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const { data: hash, error: txError, isPending, sendTransaction } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (username) {
      fetchProfileData();
    }
  }, [username]);

  useEffect(() => {
    if (isConfirmed && hash) {
      syncTipToDatabase();
    }
  }, [isConfirmed, hash]);

  const fetchProfileData = async () => {
    setIsFetching(true);
    const { data } = await supabase
      .from('profiles')
      .select('wallet_address, username')
      .eq('username', username)
      .maybeSingle();

    if (data) {
      setProfile(data);
    }
    setIsFetching(false);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d{0,2}$/.test(value) || value === '') {
      setAmount(value);
    }
  };

  const handleSendTip = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    const tipValue = parseFloat(amount);
    
    if (!isConnected || !senderAddress) {
      setLocalError('Please connect your wallet first.');
      return;
    }

    if (!tipValue || tipValue <= 0 || !profile?.wallet_address) {
      setLocalError('Invalid amount or missing builder wallet address.');
      return;
    }

    try {
      sendTransaction({
        to: profile.wallet_address as `0x${string}`,
        value: parseEther(amount),
      });
    } catch (err: any) {
      setLocalError(err.message || 'Failed to initiate transaction.');
    }
  };

  const syncTipToDatabase = async () => {
    setIsSyncing(true);
    try {
      const { error: tipError } = await supabase
        .from('tips')
        .insert([
          {
            sender_wallet: senderAddress,
            receiver_wallet: profile.wallet_address,
            amount: parseFloat(amount),
            message: message,
            tx_hash: hash,
          }
        ]);

      if (tipError) throw tipError;

      const shortAddress = senderAddress ? `${senderAddress.slice(0, 6)}...${senderAddress.slice(-4)}` : 'Someone';
      
      await supabase.from('notifications').insert([{
        wallet_address: profile.wallet_address,
        message: `You received a $${amount} USDC tip from ${shortAddress}!`,
        type: 'NEW_TIP',
        link: '/dashboard'
      }]);
      
      router.push(`/${username}?tip=success`);
    } catch (err: any) {
      console.error('Error saving tip:', err);
      setLocalError('Transaction succeeded, but failed to save record to database.');
      setIsSyncing(false);
    }
  };

  if (isFetching) {
    return <div className="min-h-[calc(100vh-80px)] flex items-center justify-center text-slate-500">Loading...</div>;
  }

  if (!profile) {
    return <div className="min-h-[calc(100vh-80px)] flex items-center justify-center text-white">Profile not found.</div>;
  }

  const isProcessing = isPending || isConfirming || isSyncing;
  const displayError = txError ? txError.message.split('\n')[0] : localError;

  return (
    <div className="min-h-[calc(100vh-80px)] w-full flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        
        <div className="flex items-center justify-between mb-8">
          <Link 
            href={`/${username}`}
            className="text-sm font-bold text-slate-400 hover:text-blue-400 transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Profile
          </Link>
        </div>

        <div className="bg-[#0f172a]/80 border border-slate-800/80 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          
          <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-[80px] pointer-events-none -mr-10 -mt-10"></div>

          <div className="text-center mb-8 relative z-10">
            <div className="w-16 h-16 bg-[#050B14] border border-slate-700/50 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-emerald-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight mb-1">Send Tip</h1>
            <p className="text-slate-400 text-sm">Support <span className="text-white font-bold">@{username}</span>'s work directly via ARC network.</p>
          </div>

          {displayError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-xl mb-6 text-sm font-bold flex items-center gap-2 relative z-10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              <span className="break-all">{displayError}</span>
            </div>
          )}

          <form onSubmit={handleSendTip} className="space-y-6 relative z-10">
            
            <div>
              <div className="relative group flex items-center justify-center">
                <span className="absolute left-6 text-3xl font-black text-slate-500 group-focus-within:text-emerald-400 transition-colors">$</span>
                <input 
                  type="text" 
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={handleAmountChange}
                  disabled={isProcessing}
                  className="w-full bg-[#050B14] p-6 pl-14 pr-20 rounded-2xl border border-slate-700/50 text-white text-4xl font-black focus:border-emerald-500/50 outline-none transition-all shadow-inner focus:shadow-[0_0_20px_rgba(16,185,129,0.1)] text-center tracking-wider disabled:opacity-50"
                />
                <span className="absolute right-6 text-sm font-bold text-slate-500">USDC</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[5, 10, 50].map((val) => (
                <button
                  key={val}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setAmount(val.toString())}
                  className="py-3 rounded-xl border border-slate-700/50 bg-[#050B14] text-slate-400 font-bold hover:border-emerald-500/30 hover:text-emerald-400 transition-all focus:outline-none focus:border-emerald-500/50 focus:text-emerald-400 disabled:opacity-50"
                >
                  ${val}
                </button>
              ))}
            </div>

            <div className="space-y-2 pt-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Message (Optional)</label>
              <textarea 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isProcessing}
                placeholder="Leave a nice note..."
                maxLength={100}
                rows={2}
                className="w-full bg-[#050B14] border border-slate-700/50 rounded-xl px-4 py-3 text-slate-300 text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all resize-none placeholder:text-slate-600 disabled:opacity-50"
              />
              <div className="text-right text-xs text-slate-600 font-mono">
                {message.length} / 100
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isProcessing || !parseFloat(amount) || parseFloat(amount) <= 0}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-white py-4 rounded-xl font-bold transition-all shadow-[0_0_30px_-10px_rgba(16,185,129,0.5)] disabled:shadow-none mt-4 flex justify-center items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-white animate-spin"></span>
                  {isPending ? 'Requesting Signature...' : isConfirming ? 'Confirming on Chain...' : 'Syncing Record...'}
                </>
              ) : (
                'Confirm & Send Tip'
              )}
            </button>
            
            <p className="text-center text-xs text-slate-500 font-bold flex items-center justify-center gap-1.5 mt-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
              </svg>
              Secured by ARC Network
            </p>

          </form>
        </div>
      </div>
    </div>
  );
}