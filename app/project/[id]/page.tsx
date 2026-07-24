'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { supabase } from '../../lib/supabase';

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
    "anonymous": false,
    "inputs": [
      {"indexed": true,"internalType": "uint256","name": "projectId","type": "uint256"},
      {"indexed": false,"internalType": "address","name": "raisedBy","type": "address"}
    ],
    "name": "DisputeRaised",
    "type": "event"
  },
  {
    "inputs": [{"internalType": "uint256","name": "_projectId","type": "uint256"}],
    "name": "fundProject",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true,"internalType": "uint256","name": "projectId","type": "uint256"},
      {"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"}
    ],
    "name": "FundsLocked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true,"internalType": "uint256","name": "projectId","type": "uint256"},
      {"indexed": true,"internalType": "address","name": "builder","type": "address"},
      {"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"}
    ],
    "name": "FundsReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true,"internalType": "uint256","name": "projectId","type": "uint256"}
    ],
    "name": "ProjectCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true,"internalType": "uint256","name": "projectId","type": "uint256"},
      {"indexed": true,"internalType": "address","name": "client","type": "address"},
      {"indexed": true,"internalType": "address","name": "builder","type": "address"},
      {"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"},
      {"indexed": false,"internalType": "uint256","name": "deadline","type": "uint256"},
      {"indexed": false,"internalType": "uint8","name": "maxRevisions","type": "uint8"}
    ],
    "name": "ProjectCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true,"internalType": "uint256","name": "projectId","type": "uint256"},
      {"indexed": true,"internalType": "address","name": "client","type": "address"},
      {"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"}
    ],
    "name": "ProjectRefunded",
    "type": "event"
  },
  {
    "inputs": [{"internalType": "uint256","name": "_projectId","type": "uint256"}],
    "name": "raiseDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256","name": "_projectId","type": "uint256"}],
    "name": "releaseFunds",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256","name": "_projectId","type": "uint256"}],
    "name": "requestRevision",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true,"internalType": "uint256","name": "projectId","type": "uint256"},
      {"indexed": false,"internalType": "uint8","name": "revisionsLeft","type": "uint8"}
    ],
    "name": "RevisionRequested",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "projectCounter",
    "outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256","name": "","type": "uint256"}],
    "name": "projects",
    "outputs": [
      {"internalType": "address payable","name": "client","type": "address"},
      {"internalType": "address payable","name": "builder","type": "address"},
      {"internalType": "uint256","name": "amount","type": "uint256"},
      {"internalType": "uint256","name": "deadline","type": "uint256"},
      {"internalType": "uint8","name": "maxRevisions","type": "uint8"},
      {"internalType": "uint8","name": "revisionsUsed","type": "uint8"},
      {"internalType": "enum PayNodeEscrow.ProjectStatus","name": "status","type": "uint8"},
      {"internalType": "bool","name": "isFunded","type": "bool"}
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

const ESCROW_CONTRACT_ADDRESS = '0x66B1fC10D5Ab5846EFdd632E331dBd4EB2B43a39';

export default function ProjectPage() {
  const { id } = useParams();
  const { address } = useAccount();
  
  const [project, setProject] = useState<any>(null);
  const [clientUsername, setClientUsername] = useState<string>('');
  const [builderUsername, setBuilderUsername] = useState<string>('');

  const [deliveryData, setDeliveryData] = useState({ notes: '', links: '' });
  const [isRevisionMode, setIsRevisionMode] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState(''); 
  const [timeLeft, setTimeLeft] = useState<string>('');
  
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const { data: hash, error: writeError, writeContract } = useWriteContract();
  const { isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    fetchProject();
  }, [id]);

  const isClient = project?.client && address?.toLowerCase() === project.client.toLowerCase();
  const isBuilder = project?.builder && address?.toLowerCase() === project.builder.toLowerCase();
  const isUnauthorized = !isClient && !isBuilder && !!address;

  useEffect(() => {
    if (!project?.deadline) return;

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const deadlineDate = new Date(project.deadline).getTime();
      const endOfDayDeadline = deadlineDate + (24 * 60 * 60 * 1000) - 1; 
      const distance = endOfDayDeadline - now;

      if (distance < 0) {
        setTimeLeft('Expired');
        clearInterval(timer);
        return;
      }

      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);

      setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    }, 1000);

    return () => clearInterval(timer);
  }, [project?.deadline]);

  useEffect(() => {
    if (isConfirmed && activeAction) {
      handleDbSyncAfterWeb3();
    }
  }, [isConfirmed, activeAction]);

  useEffect(() => {
    if (writeError) {
      setLoading(false);
      setActiveAction(null);
      alert("Transaction failed or was rejected by the wallet.");
    }
  }, [writeError]);

  const fetchProject = async () => {
    const { data } = await supabase.from('projects').select('*').eq('id', id).single();
    if (data) {
      setProject(data);
      
      const { data: profiles } = await supabase
        .from('profiles')
        .select('wallet_address, username')
        .in('wallet_address', [data.client, data.builder]);

      if (profiles) {
        const cProfile = profiles.find(p => p.wallet_address.toLowerCase() === data.client.toLowerCase());
        const bProfile = profiles.find(p => p.wallet_address.toLowerCase() === data.builder.toLowerCase());
        
        if (cProfile) setClientUsername(cProfile.username);
        if (bProfile) setBuilderUsername(bProfile.username);
      }
    }
  };

  const updateProjectStatus = async (newStatus: string, extraData: any = {}) => {
    const { error } = await supabase.from('projects').update({ status: newStatus, ...extraData }).eq('id', id);
    if (!error) {
      setIsRevisionMode(false);
      fetchProject();
    } else {
      alert("Error updating project: " + error.message);
    }
  };

  const sendNotification = async (receiverWallet: string, message: string, type: string) => {
    if (!receiverWallet) return;
    try {
      await supabase.from('notifications').insert([{
        wallet_address: receiverWallet,
        message: message,
        type: type,
        link: `/project/${id}`
      }]);
    } catch (err) {
      console.error("Failed to send notification:", err);
    }
  };

  const handleDbSyncAfterWeb3 = async () => {
    setTxStatus('Syncing Database...');
    switch(activeAction) {
      case 'Funded': 
        await updateProjectStatus('Funded'); 
        await sendNotification(project.builder, `Client has funded "${project.title}". You can start working now!`, 'PROJECT_FUNDED');
        break;
      case 'Completed': 
        await updateProjectStatus('Completed', { rating: selectedRating }); 
        await sendNotification(project.builder, `Funds released! Client approved your work for "${project.title}".`, 'PROJECT_FUNDED');
        break;
      case 'Refunded': 
        await updateProjectStatus('Refunded'); 
        if (isClient) {
          await sendNotification(project.builder, `Client claimed a refund for "${project.title}".`, 'PROJECT_CANCELLED');
        }
        break;
      case 'Refunded_Builder': 
        await updateProjectStatus('Refunded', { revision_notes: 'Cancelled by Builder' }); 
        await sendNotification(project.client, `Builder cancelled the contract for "${project.title}". Funds have been refunded.`, 'PROJECT_CANCELLED');
        break;
      case 'Cancelled_Builder': 
        await updateProjectStatus('Cancelled', { revision_notes: 'Declined by Builder' }); 
        await sendNotification(project.client, `Builder declined your project request for "${project.title}".`, 'PROJECT_CANCELLED');
        break;
      case 'Revision': 
        await updateProjectStatus('Revision', { revision_notes: revisionNote }); 
        await sendNotification(project.builder, `Client requested a revision for "${project.title}".`, 'REVISION_REQUESTED');
        break;
    }
    setActiveAction(null);
    setLoading(false);
  };

  const isPastDeadline = timeLeft === 'Expired';
  const isForceReleaseAvailable = project?.delivered_at ? new Date().getTime() >= new Date(project.delivered_at).getTime() + (7 * 24 * 60 * 60 * 1000) : false;

  const fundEscrow = async () => {
    if (project.blockchain_id == null) {
      alert("Error: Blockchain ID is missing. The project was not synced properly on creation.");
      return;
    }
    setLoading(true); 
    setTxStatus('Requesting Signature...');
    setActiveAction('Funded');
    writeContract({
      address: ESCROW_CONTRACT_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'fundProject',
      args: [BigInt(project.blockchain_id)], 
      // Fixed: Arc network native token decimals (6)
      value: parseUnits(project.budget.toString(), 6) 
    });
  };

  const executeReleaseFunds = async () => {
    if (project.blockchain_id == null) {
      alert("Error: Blockchain ID is missing. Cannot interact with smart contract.");
      return;
    }
    setShowRatingModal(false);
    setLoading(true); 
    setTxStatus('Releasing Funds...');
    setActiveAction('Completed');
    writeContract({
      address: ESCROW_CONTRACT_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'releaseFunds',
      args: [BigInt(project.blockchain_id)]
    });
  };

  const claimRefund = async () => {
    if (project.blockchain_id == null) {
      alert("Error: Blockchain ID is missing.");
      return;
    }
    setLoading(true); 
    setTxStatus('Reclaiming Funds...');
    setActiveAction('Refunded');
    writeContract({
      address: ESCROW_CONTRACT_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'cancelProject',
      args: [BigInt(project.blockchain_id)]
    });
  };

  const submitRevision = () => {
    if (!revisionNote) return alert("Provide notes.");
    if (project.blockchain_id == null) {
      alert("Error: Blockchain ID is missing.");
      return;
    }
    setLoading(true);
    setTxStatus('Submitting Feedback...');
    setActiveAction('Revision');
    writeContract({
      address: ESCROW_CONTRACT_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'requestRevision',
      args: [BigInt(project.blockchain_id)]
    });
  };

  const declineProject = () => {
    if (project.blockchain_id == null) {
      alert("Error: Blockchain ID is missing.");
      return;
    }
    if (window.confirm("Are you sure you want to decline this project request?")) {
      setLoading(true);
      setTxStatus('Cancelling Project...');
      setActiveAction('Cancelled_Builder');
      writeContract({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: 'cancelProject',
        args: [BigInt(project.blockchain_id)]
      });
    }
  };

  const cancelByBuilder = () => {
    if (project.blockchain_id == null) {
      alert("Error: Blockchain ID is missing.");
      return;
    }
    if (window.confirm("Are you sure you want to cancel the contract? The funds will be fully refunded to the client.")) {
      setLoading(true);
      setTxStatus('Refunding Client...');
      setActiveAction('Refunded_Builder');
      writeContract({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: 'cancelProject',
        args: [BigInt(project.blockchain_id)]
      });
    }
  };

  const deliverWork = async () => {
    if (!deliveryData.links) return alert("Provide links.");
    setLoading(true);
    setTxStatus('Submitting Work...');
    await updateProjectStatus('Delivered', { delivery_notes: deliveryData.notes, delivery_links: deliveryData.links, delivered_at: new Date().toISOString() });
    await sendNotification(project.client, `Builder has delivered the work for "${project.title}". Please review it.`, 'WORK_DELIVERED');
    setLoading(false);
  };

  if (!project) return (
    <div className="min-h-[calc(100vh-80px)] w-full flex items-center justify-center">
      <span className="w-8 h-8 rounded-full border-4 border-slate-800 border-t-blue-500 animate-spin"></span>
    </div>
  );

  if (isUnauthorized) {
    return (
      <div className="min-h-[calc(100vh-80px)] w-full flex flex-col items-center justify-center px-6">
        <div className="bg-red-950/20 border border-red-900/50 p-8 rounded-[2rem] max-w-lg w-full text-center shadow-2xl backdrop-blur-xl">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-red-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-white mb-2">Access Denied</h1>
          <p className="text-slate-400 text-sm mb-8">
            You do not have permission to view this smart contract. Only the authorized client or builder can access this page.
          </p>
          <Link 
            href="/dashboard"
            className="w-full inline-block bg-[#050B14] hover:bg-slate-800 border border-slate-800 text-white py-4 rounded-xl font-bold transition-all shadow-lg"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-12 space-y-6 relative">
      
      {showRatingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowRatingModal(false)}></div>
          <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-8 max-w-md w-full relative z-10 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-emerald-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-white mb-2">Rate the Builder</h3>
              <p className="text-slate-400 text-sm">How was your experience working with @{builderUsername || project.builder}?</p>
            </div>

            <div className="flex justify-center gap-2 mb-8">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  onClick={() => setSelectedRating(star)}
                  className="focus:outline-none transition-transform hover:scale-110"
                >
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    viewBox="0 0 24 24" 
                    fill="currentColor" 
                    className={`w-10 h-10 transition-colors duration-200 ${
                      star <= (hoveredRating || selectedRating) 
                        ? 'text-yellow-400' 
                        : 'text-slate-700'
                    }`}
                  >
                    <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clipRule="evenodd" />
                  </svg>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowRatingModal(false)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-sm border border-slate-800"
              >
                Cancel
              </button>
              <button 
                onClick={executeReleaseFunds}
                className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white py-3 px-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] text-sm"
              >
                Confirm & Release Funds
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#0f172a]/60 border border-slate-800 rounded-[2rem] p-8 md:p-10 relative overflow-hidden shadow-2xl">
        
        <div className="absolute top-0 right-0 bg-[#050B14] px-6 py-3 rounded-bl-2xl border-b border-l border-slate-800/80">
          <span className={`text-xs font-black tracking-widest uppercase flex items-center gap-2 ${
            project.status === 'Completed' ? 'text-emerald-400' :
            project.status === 'Cancelled' ? 'text-red-400' :
            project.status === 'Refunded' ? 'text-orange-500' :
            project.status === 'Delivered' ? 'text-purple-400' :
            project.status === 'Revision' ? 'text-orange-400' : 'text-blue-400'
          }`}>
            {project.status === 'Funded' && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>}
            {project.status === 'Pending' && <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse"></span>}
            {project.status}
          </span>
        </div>

        <h1 className="text-3xl font-black text-white mb-8 w-3/4 leading-tight">{project.title}</h1>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Builder</p>
            {builderUsername ? (
              <Link href={`/${builderUsername}`} className="text-blue-400 hover:text-blue-300 font-bold text-sm truncate block transition-colors">
                @{builderUsername}
              </Link>
            ) : (
              <p className="text-white font-mono text-sm truncate">{project.builder}</p>
            )}
          </div>
          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Client</p>
            {clientUsername ? (
              <Link href={`/${clientUsername}`} className="text-blue-400 hover:text-blue-300 font-bold text-sm truncate block transition-colors">
                @{clientUsername}
              </Link>
            ) : (
              <p className="text-white font-mono text-sm truncate">{project.client.substring(0,6)}...{project.client.substring(project.client.length-4)}</p>
            )}
          </div>
          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Budget</p>
            <p className="text-blue-400 font-mono font-bold text-lg">{project.budget} USDC</p>
          </div>
          <div className="bg-[#050B14] border border-slate-800/80 rounded-2xl p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Time Left</p>
            <p className={`font-mono font-bold text-sm ${isPastDeadline ? 'text-red-400' : 'text-emerald-400'}`}>
              {timeLeft || 'Calculating...'}
            </p>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-800/50">

          {project.status === 'Cancelled' && (
             <div className="text-center py-4">
               <div className="text-3xl mb-4">🚫</div>
               <h2 className="text-xl font-bold text-red-400 mb-2">Project Cancelled</h2>
               <p className="text-slate-400 text-sm">This project was cancelled before any funds were transferred.</p>
             </div>
          )}

          {project.status === 'Funded' && isPastDeadline && isClient && (
            <div className="bg-red-950/20 border border-red-900/50 p-6 rounded-2xl flex items-center justify-between">
               <div>
                 <h3 className="text-red-400 font-bold mb-1">Deadline Passed</h3>
                 <p className="text-sm text-slate-400">The builder failed to deliver on time.</p>
               </div>
               <button onClick={claimRefund} disabled={loading} className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-[0_0_15px_rgba(220,38,38,0.3)]">
                 {loading ? txStatus : 'Claim Full Refund'}
               </button>
            </div>
          )}

          {project.status === 'Funded' && isPastDeadline && isBuilder && (
            <div className="bg-red-950/20 border border-red-900/50 p-6 rounded-2xl text-center">
              <h2 className="text-red-400 font-bold text-lg mb-1">⚠️ Time Expired</h2>
              <p className="text-slate-400 text-sm">You missed the delivery deadline. The client can now claim a refund.</p>
            </div>
          )}

          {(project.status === 'Pending' || project.status === 'AwaitingFunds') && isClient && (
            <div className="flex flex-col md:flex-row items-center justify-between bg-blue-950/10 border border-blue-900/30 p-6 rounded-2xl gap-4">
              <div>
                <h3 className="text-white font-bold mb-1">Action Required</h3>
                <p className="text-sm text-slate-400">Secure the smart contract to start the project.</p>
              </div>
              <button onClick={fundEscrow} disabled={loading} className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-[0_0_20px_-5px_rgba(37,99,235,0.4)]">
                {loading ? txStatus : `Fund ${project.budget} USDC`}
              </button>
            </div>
          )}

          {(project.status === 'Pending' || project.status === 'AwaitingFunds') && isBuilder && (
             <div className="flex flex-col md:flex-row items-center justify-between bg-[#050B14] border border-slate-800/80 p-6 rounded-2xl gap-4">
               <div>
                 <h2 className="text-lg font-bold text-white mb-1">⏳ Waiting for Funds</h2>
                 <p className="text-slate-400 text-sm">Do not start working until the client funds the escrow.</p>
               </div>
               <button onClick={declineProject} disabled={loading} className="w-full md:w-auto px-6 py-3 rounded-xl border border-red-900/50 text-red-500 hover:bg-red-950/30 font-bold transition-all text-sm">
                 {loading ? txStatus : 'Decline Request'}
               </button>
             </div>
          )}

          {project.status === 'Funded' && !isPastDeadline && isClient && (
            <div className="text-center py-6">
              <div className="text-4xl mb-4 animate-bounce">🛠️</div>
              <h2 className="text-xl font-bold text-white mb-2">Work in Progress</h2>
              <p className="text-slate-400 text-sm">Escrow secured. Waiting for @{builderUsername || project.builder} to submit the deliverables.</p>
            </div>
          )}

          {((project.status === 'Funded' && !isPastDeadline) || project.status === 'Revision') && isBuilder && (
            <div className="bg-[#050B14] border border-slate-800/80 p-6 md:p-8 rounded-3xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black text-white">Deliver Work</h2>
                <span className="bg-blue-950/30 text-blue-400 px-3 py-1 rounded-lg text-xs font-bold border border-blue-900/50 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" /></svg>
                  Escrow Secured
                </span>
              </div>
              <textarea 
                className="w-full bg-[#0f172a] p-4 rounded-xl border border-slate-700/50 text-white text-sm mb-4 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all resize-none" 
                placeholder="What did you complete? (Notes)" 
                rows={3}
                onChange={e => setDeliveryData({...deliveryData, notes: e.target.value})} 
              />
              <input 
                className="w-full bg-[#0f172a] p-4 rounded-xl border border-slate-700/50 text-white text-sm mb-6 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all" 
                placeholder="https://github.com/..." 
                onChange={e => setDeliveryData({...deliveryData, links: e.target.value})} 
              />
              <button onClick={deliverWork} disabled={loading} className="w-full bg-purple-600 hover:bg-purple-500 text-white py-4 rounded-xl font-bold transition-all shadow-[0_0_20px_-5px_rgba(168,85,247,0.4)] mb-6">
                {loading && txStatus === 'Submitting Work...' ? txStatus : 'Submit Delivery'}
              </button>
              
              <div className="border-t border-slate-800 pt-6 text-center">
                 <button onClick={cancelByBuilder} disabled={loading} className="text-slate-500 hover:text-red-400 text-xs font-bold transition-colors underline decoration-slate-700 underline-offset-4">
                   Unable to complete? Cancel Contract & Refund Client
                 </button>
              </div>
            </div>
          )}

          {project.status === 'Delivered' && (
            <div className="bg-[#050B14] border border-purple-900/30 p-6 md:p-8 rounded-3xl">
              <h2 className="text-xl font-bold text-purple-400 mb-6 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" /></svg>
                Work Delivered for Review
              </h2>
              
              <div className="bg-[#0f172a] p-5 rounded-2xl border border-slate-800/80 mb-6 text-sm text-slate-300">
                <p className="mb-4"><strong className="text-slate-500 uppercase text-xs tracking-wider block mb-1">Notes:</strong>{project.delivery_notes}</p>
                <p><strong className="text-slate-500 uppercase text-xs tracking-wider block mb-1">Link:</strong><a href={project.delivery_links} target="_blank" className="text-blue-400 hover:text-blue-300 hover:underline">{project.delivery_links}</a></p>
              </div>
              
              {isClient && !isRevisionMode && (
                 <div className="flex flex-col sm:flex-row gap-4 mt-6 border-t border-slate-800 pt-6">
                   <button 
                     onClick={() => setShowRatingModal(true)} 
                     disabled={loading} 
                     className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-bold transition-all shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)]"
                   >
                     {loading && txStatus === 'Releasing Funds...' ? txStatus : 'Approve & Release Funds'}
                   </button>
                   <button onClick={() => setIsRevisionMode(true)} className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white py-4 rounded-xl font-bold transition-all">
                     Request Revision
                   </button>
                 </div>
              )}
              
              {isClient && isRevisionMode && (
                 <div className="mt-6 border-t border-slate-800 pt-6">
                   <textarea 
                     className="w-full bg-[#0f172a] p-4 rounded-xl border border-orange-900/30 text-white text-sm mb-4 outline-none focus:border-orange-500/50 transition-all resize-none" 
                     placeholder="What needs to be changed?" 
                     rows={3}
                     onChange={(e) => setRevisionNote(e.target.value)} 
                   />
                   <div className="flex gap-4">
                     <button onClick={() => setIsRevisionMode(false)} className="px-6 py-3 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-sm">Cancel</button>
                     <button onClick={submitRevision} disabled={loading} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-3 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(234,88,12,0.3)] text-sm">
                       {loading && txStatus === 'Submitting Feedback...' ? txStatus : 'Submit Feedback'}
                     </button>
                   </div>
                 </div>
              )}

              {isBuilder && (
                <div className="mt-6 pt-6 border-t border-slate-800/80 text-center">
                  <p className="text-slate-400 mb-4 text-sm">Waiting for the client to review the work...</p>
                  <button onClick={() => setShowRatingModal(true)} disabled={!isForceReleaseAvailable || loading} className={`w-full py-3 rounded-xl font-bold transition-all text-sm ${isForceReleaseAvailable ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-[#0f172a] border border-slate-800 text-slate-600 cursor-not-allowed'}`}>
                    {loading ? txStatus : `Force Release ${isForceReleaseAvailable ? '' : '(Locked for 7 Days)'}`}
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}