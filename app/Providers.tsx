'use client';

import * as React from 'react';
import {
  RainbowKitProvider,
  darkTheme,
  getDefaultConfig,
} from '@rainbow-me/rainbowkit';
// مسیر ایمپورت CSS برای رفع خطای بیلد اصلاح شد
import '@rainbow-me/rainbowkit/dist/index.css';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { type Chain } from 'viem';

// 1. Define the actual Arc Testnet
const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] }, 
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
} as const;

// 2. Configure Wagmi and RainbowKit
const config = getDefaultConfig({
  appName: 'PayNode Escrow',
  // هشدار: این شناسه باید حتماً تغییر کند
  projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', 
  chains: [arcTestnet as unknown as Chain],
  ssr: true, 
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          theme={darkTheme({
            accentColor: '#2563eb', 
            accentColorForeground: 'white',
            borderRadius: 'large', 
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}