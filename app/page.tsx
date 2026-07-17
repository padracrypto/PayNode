import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-6xl font-extrabold mb-4 tracking-tight">PayNode</h1>
      <p className="text-xl text-slate-300 mb-10">
        One Link. Get Tipped. Get Paid Securely.
      </p>
      
      <ConnectButton />
      
      <div className="mt-16 text-center text-slate-400 text-sm space-y-2">
        <p className="font-bold text-slate-300">How it Works</p>
        <p>1️⃣ Create Profile | 2️⃣ Share Your Link | 3️⃣ Get Paid Securely</p>
      </div>
    </div>
  );
}