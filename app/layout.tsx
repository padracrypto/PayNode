import './globals.css';
<<<<<<< HEAD
import Link from 'next/link';
import { Providers } from './Providers';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import NotificationBell from './components/NotificationBell';

export const metadata = {
  title: 'PayNode - Trustless Web3 Escrow on ARC',
  description: 'The ultimate Web3 platform for content creators and builders on the ARC network.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="bg-[#050B14] text-slate-300 min-h-screen flex flex-col font-sans antialiased selection:bg-blue-500/30">
        
        {/* Wrap everything inside Providers for Web3 context */}
        <Providers>
          
          {/* Global Sticky Header */}
          <header className="sticky top-0 z-50 w-full bg-[#050B14]/80 backdrop-blur-lg border-b border-white/[0.05] shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
            <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
              
              {/* Logo & Platform Name */}
              <Link href="/" className="flex items-center gap-3 group">
                {/* Animated Mini Logo */}
                <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-[#0f172a] border border-slate-700/50 shadow-[0_0_15px_rgba(59,130,246,0.1)] group-hover:scale-105 transition-transform">
                  <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
                    <defs>
                      <linearGradient id="paynode-grad-mini" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#3B82F6"/>
                        <stop offset="100%" stopColor="#A855F7"/>
                      </linearGradient>
                      <filter id="glow-mini" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                    </defs>
                    <circle cx="28" cy="50" r="16" stroke="url(#paynode-grad-mini)" strokeWidth="7" filter="url(#glow-mini)"/>
                    <circle cx="72" cy="50" r="16" stroke="url(#paynode-grad-mini)" strokeWidth="7" filter="url(#glow-mini)"/>
                    <path d="M44 50h12" stroke="url(#paynode-grad-mini)" strokeWidth="7" strokeLinecap="round" filter="url(#glow-mini)"/>
                    <circle cx="50" cy="50" r="4.5" fill="#34D399" className="animate-pulse" />
                  </svg>
                </div>
                <span className="text-2xl font-black text-white tracking-tighter group-hover:text-blue-400 transition-colors">
                  PayNode<span className="text-blue-500">.</span>
                </span>
              </Link>

              {/* Header Right Section */}
              <div className="flex items-center gap-4">
                <Link 
                  href="/dashboard" 
                  className="hidden md:block text-sm font-bold text-slate-400 hover:text-white transition-colors"
                >
                  Dashboard
                </Link>
                
                {/* Real-time Notification Bell */}
                <NotificationBell />
                
                {/* Real RainbowKit Connect Button */}
                <ConnectButton />
              </div>

            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 flex flex-col relative w-full">
            {children}
          </main>

        </Providers>

=======
import { Providers } from './Providers';

export const metadata = {
  title: 'PayNode',
  description: 'One Link. Get Paid Securely.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
>>>>>>> 0c8861c1432ec02fbefa50456b56404b620b9408
      </body>
    </html>
  );
}