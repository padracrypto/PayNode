<<<<<<< HEAD
'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseUnits } from 'viem';
import { supabase } from '../../lib/supabase'; 

//  
const ESCROW_CONTRACT_ADDRESS = '0x66B1fC10D5Ab5846EFdd632E331dBd4EB2B43a39';

// ABI
const ESCROW_ABI = [
  {
    "inputs": [{"internalType": "uint256","name": "_projectId","type": "uint256"}],
    "name": "cancelProject",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "address payable","name": "_builder","type": "address"},
      {"internalType": "uint256","name": "_amount","type": "uint256"},
      {"internalType": "uint256","name": "_durationInDays","type": "uint256"},
      {"internalType": "uint8","name": "_maxRevisions","type": "uint8"}
    ],
    "name": "createProject",
    "outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "projectCounter",
    "outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

function ProjectForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const builderParam = searchParams.get('builder') || '';
  
  const { address, isConnected } = useAccount();

  const [formData, setFormData] = useState({
    title: '',
    budget: '',
    delivery_type: 'Fixed Price',
    deadline: '',
    maxRevisions: '2',
    description: '',
    builderWallet: builderParam.startsWith('0x') ? builderParam : ''
  });
  
  const [localError, setLocalError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // Wagmi Hooks for Write and Confirmation
  const { data: hash, error: writeError, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  // Wagmi Hook to Read Current Project Counter from Contract
  const { refetch: fetchProjectCounter } = useReadContract({
    address: ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'projectCounter',
    query: { enabled: false } // We manually trigger this after creation
  });

  // 
  const todayObj = new Date();
  const today = new Date(todayObj.getTime() - (todayObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

  useEffect(() => {
    if (isConfirmed && hash) {
      handlePostConfirmation();
    }
  }, [isConfirmed, hash]);

  const handlePostConfirmation = async () => {
    try {
      setIsSyncing(true);
      
      // 
      const { data: counterData } = await fetchProjectCounter();
      
      //
      // 
      const newProjectId = counterData ? Number(counterData) - 1 : null;
      
      await syncToDatabase(newProjectId);

    } catch (err: any) {
      setLocalError("Failed to fetch project ID from blockchain. " + (err.message || ''));
      setIsSyncing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (!isConnected || !address) {
      setLocalError('Please connect your wallet first.');
      return;
    }

    if (Number(formData.budget) <= 0) {
      setLocalError('Budget must be greater than 0 USDC.');
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(formData.builderWallet)) {
      setLocalError('Invalid builder wallet address.');
      return;
    }

    // 
    const deadlineDate = new Date(formData.deadline);
    const todayDate = new Date();
    // ریست کردن ساعت‌ها به نیمه‌شب محلی برای محاسبه دقیق اختلاف روز
    todayDate.setHours(0, 0, 0, 0);
    deadlineDate.setHours(0, 0, 0, 0);
    
    const durationDays = Math.max(1, Math.ceil((deadlineDate.getTime() - todayDate.getTime()) / (1000 * 3600 * 24)));

    try {
      writeContract({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: 'createProject',
        args: [
          formData.builderWallet as `0x${string}`,
          parseUnits(formData.budget, 18), 
          BigInt(durationDays),
          Number(formData.maxRevisions)
        ],
      });
    } catch (err: any) {
      setLocalError(err.message || 'Failed to initiate Web3 transaction.');
    }
  };

  const syncToDatabase = async (blockchainId: number | null) => {
    try {
      const { data, error: sbError } = await supabase
        .from('projects')
        .insert([
          {
            title: formData.title,
            budget: Number(formData.budget),
            delivery_type: formData.delivery_type,
            deadline: formData.deadline,
            description: formData.description,
            builder: formData.builderWallet, 
            client: address,  
            status: 'AwaitingFunds',
            tx_hash: hash,
            blockchain_id: blockchainId // 
          }
        ])
        .select()
        .single();

      if (sbError) throw sbError;
      
      if (data) {
        router.push(`/project/${data.id}`);
      }
    } catch (err: any) {
      setLocalError(err.message || 'An error occurred while saving the project.');
      setIsSyncing(false);
    }
  };

  const isProcessing = isPending || isConfirming || isSyncing;
  const displayError = writeError ? writeError.message.split('\n')[0] : localError;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-[#0f172a]/80 border border-slate-800/80 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        
        <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/10 rounded-full blur-[80px] pointer-events-none -mr-10 -mt-10"></div>

        <div className="mb-8 relative z-10">
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">Start a New Project</h1>
          <p className="text-slate-400 text-sm">
            Deploy your terms to the blockchain and secure funds with PayNode escrow.
          </p>
        </div>

        {displayError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-xl mb-6 text-sm font-bold flex items-center gap-2 relative z-10">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            <span className="break-all">{displayError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
          
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Project Title *</label>
            <input 
              type="text" 
              required
              placeholder="e.g., Build a custom AI agent"
              className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Builder Wallet Address *</label>
            <input 
              type="text" 
              required
              placeholder="0x..."
              className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600 font-mono"
              value={formData.builderWallet}
              onChange={(e) => setFormData({...formData, builderWallet: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Budget (USDC) *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                <input 
                  type="number" 
                  min="1"
                  step="1"
                  required
                  placeholder="100"
                  className="w-full bg-[#050B14] pl-8 pr-4 py-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600"
                  value={formData.budget}
                  onChange={(e) => setFormData({...formData, budget: e.target.value})}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Deadline *</label>
              <input 
                type="date" 
                required
                min={today}
                className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all [color-scheme:dark]"
                value={formData.deadline}
                onChange={(e) => setFormData({...formData, deadline: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Delivery Type</label>
              <select 
                className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none appearance-none transition-all cursor-pointer"
                value={formData.delivery_type}
                onChange={(e) => setFormData({...formData, delivery_type: e.target.value})}
              >
                <option value="Fixed Price">Fixed Price (Standard Escrow)</option>
                <option value="Milestones" disabled>Milestones (Coming Soon)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Max Revisions</label>
              <input 
                type="number" 
                min="0"
                required
                className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all"
                value={formData.maxRevisions}
                onChange={(e) => setFormData({...formData, maxRevisions: e.target.value})}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Project Description</label>
            <textarea 
              required
              rows={4}
              placeholder="Describe the requirements, deliverables, and expectations..."
              className="w-full bg-[#050B14] p-4 rounded-xl border border-slate-700/50 text-white text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all resize-none placeholder:text-slate-600"
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800/50 mt-6">
            <button 
              type="button"
              onClick={() => router.back()}
              disabled={isProcessing}
              className="text-sm font-bold text-slate-400 hover:text-white transition-colors px-4 py-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isProcessing}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-white rounded-xl font-bold transition-all shadow-[0_0_20px_-5px_rgba(37,99,235,0.4)] disabled:shadow-none flex items-center justify-center min-w-[180px]"
            >
              {isProcessing ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-white animate-spin mr-2"></span>
                  {isPending ? 'Confirming...' : isConfirming ? 'Minting...' : 'Syncing...'}
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <div className="min-h-[calc(100vh-80px)] w-full flex items-center justify-center px-6 py-12">
      <Suspense fallback={
        <div className="w-full max-w-2xl mx-auto flex justify-center py-20">
          <span className="w-8 h-8 rounded-full border-4 border-slate-800 border-t-blue-500 animate-spin"></span>
        </div>
      }>
        <ProjectForm />
      </Suspense>
    </div>
  );
=======
'use client';

import { useState } from 'react';
import { supabase } from '../../../lib/supabase';

export default function StartProject() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(''); // ✨ این خط برای توضیحات اضافه شد
  const [budget, setBudget] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg('⏳ Saving to database...');

    // ✨ حالا توضیحات رو هم همراه با بقیه اطلاعات می‌فرستیم به دیتابیس
    const { error } = await supabase
      .from('projects')
      .insert([
        { 
          title: title, 
          description: description, 
          budget: parseFloat(budget) 
        }
      ]);

    if (error) {
      setStatusMsg('❌ Error: ' + error.message);
    } else {
      setStatusMsg('✅ Project successfully created!');
      setTitle(''); 
      setDescription(''); // خالی کردن توضیحات بعد از موفقیت
      setBudget('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center py-12">
      <div className="max-w-xl w-full bg-slate-800 rounded-2xl p-8 shadow-2xl border border-slate-700">
        <h2 className="text-3xl font-bold mb-2">Start a New Project</h2>
        <p className="text-slate-400 mb-8 text-sm">Fill out the details below.</p>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Project Title</label>
            <input 
              type="text" 
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white" 
            />
          </div>

          {/* ✨ این بخش برای باکس توضیحات به فرم اضافه شد */}
          <div>
            <label className="block text-sm text-slate-300 mb-1">Project Description</label>
            <textarea 
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white" 
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Budget (USDC)</label>
            <input 
              type="number" 
              required
              min="0" 
              step="any"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white" 
            />
          </div>
          
          <button type="submit" className="w-full mt-4 py-4 rounded-xl bg-green-500 text-slate-900 font-bold text-lg hover:bg-green-400 transition-all">
            Create Project
          </button>

          {statusMsg && (
            <p className="text-center mt-4 text-sm font-medium text-slate-300">
              {statusMsg}
            </p>
          )}
        </form>
      </div>
    </div>
  );
>>>>>>> 0c8861c1432ec02fbefa50456b56404b620b9408
}