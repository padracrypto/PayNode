'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ethers } from 'ethers';
import { supabase } from '../../../lib/supabase';
import { USDC_ADDRESS, ESCROW_ADDRESS, USDC_ABI, ESCROW_ABI } from '../../../lib/contract';

export default function ProjectDetails() {
  const params = useParams();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [builderAddress, setBuilderAddress] = useState("");

  useEffect(() => {
    async function fetchProject() {
      if (!params?.id) return;
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('id', parseInt(params.id as string))
        .single();
      setProject(data);
      setLoading(false);
    }
    fetchProject();
  }, [params?.id]);

  const updateStatus = async (newStatus: string) => {
    await supabase.from('projects').update({ status: newStatus }).eq('id', project.id);
    setProject({ ...project, status: newStatus });
  };

  const handlePayment = async () => {
    if (!window.ethereum) return alert("MetaMask is not installed.");
    if (!builderAddress) return alert("Please enter the freelancer wallet address.");
    
    setIsProcessing(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
      const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
      
      const amountInUnits = ethers.parseUnits(project.budget.toString(), 6);

      alert("Step 1/2: Approving USDC transfer...");
      const approveTx = await usdcContract.approve(ESCROW_ADDRESS, amountInUnits);
      await approveTx.wait();

      alert("Step 2/2: Funding Escrow Contract...");
      const fundTx = await escrowContract.fundEscrow(project.id, builderAddress, amountInUnits);
      const receipt = await fundTx.wait();
      
      await updateStatus('ACTIVE');
      alert(`Payment successful! Transaction Hash:\n${receipt.hash}`);
    } catch (error: any) {
      console.error(error);
      alert("Transaction failed: " + (error.reason || error.message || "Unknown error"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeliver = async () => {
    setIsProcessing(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);

      const tx = await escrowContract.deliverWork(project.id);
      await tx.wait();
      
      await updateStatus('DELIVERED');
      alert("Work delivered successfully!");
    } catch (error: any) {
      console.error(error);
      alert("Action failed: " + (error.reason || error.message));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRelease = async () => {
    setIsProcessing(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);

      const tx = await escrowContract.releasePayment(project.id);
      await tx.wait();
      
      await updateStatus('COMPLETED');
      alert("Payment released to freelancer!");
    } catch (error: any) {
      console.error(error);
      alert("Action failed: " + (error.reason || error.message));
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 md:p-10 flex flex-col items-center">
      <div className="max-w-3xl w-full bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden">
        <div className="bg-slate-700/30 p-8 border-b border-slate-700 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">{project?.title}</h1>
            <p className="text-slate-400 text-sm mt-1">ID: #{project?.id}</p>
            <p className="text-slate-300 mt-5 leading-relaxed">{project?.description}</p>
          </div>
          <div className="text-right ml-6">
            <p className="text-3xl font-bold text-green-400">{project?.budget} USDC</p>
            <p className="text-sm font-bold mt-2 uppercase tracking-wider text-blue-400">
              STATUS: {project?.status || 'PENDING'}
            </p>
          </div>
        </div>
        <div className="p-8 space-y-4">
          
          {(project?.status === 'PENDING' || !project?.status) && (
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Freelancer Wallet Address (0x...)" 
                value={builderAddress}
                onChange={(e) => setBuilderAddress(e.target.value)}
                className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white outline-none focus:border-green-500"
              />
              <button 
                onClick={handlePayment}
                disabled={isProcessing}
                className="w-full py-4 font-bold text-xl rounded-xl transition-all shadow-lg bg-green-500 hover:bg-green-400 text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Processing...' : '💰 Pay & Start Project'}
              </button>
            </div>
          )}

          {project?.status === 'ACTIVE' && (
            <button 
              onClick={handleDeliver}
              disabled={isProcessing}
              className="w-full py-4 font-bold text-xl rounded-xl transition-all shadow-lg bg-blue-500 hover:bg-blue-400 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : '📦 Deliver Work (Freelancer)'}
            </button>
          )}

          {project?.status === 'DELIVERED' && (
            <button 
              onClick={handleRelease}
              disabled={isProcessing}
              className="w-full py-4 font-bold text-xl rounded-xl transition-all shadow-lg bg-purple-500 hover:bg-purple-400 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : '✅ Release Payment (Client)'}
            </button>
          )}

          {project?.status === 'COMPLETED' && (
            <div className="w-full py-4 bg-slate-700 text-green-400 font-bold text-xl rounded-xl text-center border border-green-500/30">
              🎉 Project Completed & Paid
            </div>
          )}

        </div>
      </div>
    </div>
  );
}