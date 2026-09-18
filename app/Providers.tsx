'use client';

import * as React from 'react';
import {
  RainbowKitProvider,
  darkTheme,
  getDefaultConfig,
} from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { fallback, http } from 'viem';
import { arc, ARC_RPC_URLS, ARC_CHAIN_ID } from '@/lib/paynode';
import { SiweProvider } from './providers/SiweProvider';

/**
 * The chain object now comes from lib/paynode.ts, built with `satisfies Chain`.
 * The previous `arcTestnet as unknown as Chain` cast disabled the exact type check that
 * would have caught a malformed chain definition — and hardcoded TESTNET, with a single
 * RPC endpoint and no fallback.
 */
const config = getDefaultConfig({
  appName: 'PayNode Escrow',
  // Non-null: an empty projectId makes WalletConnect fail silently, leaving only
  // injected wallets working with no error anywhere. Fail at boot instead.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [arc],
  transports: {
    [ARC_CHAIN_ID]: fallback(ARC_RPC_URLS.map((url) => http(url))),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  // Per-mount, not module scope. With ssr:true a module-level QueryClient is shared
  // across server requests, which can leak one user's cached data into another's render.
  const [queryClient] = React.useState(() => new QueryClient());

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
          <SiweProvider>{children}</SiweProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
