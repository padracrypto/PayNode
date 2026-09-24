'use client';

import * as React from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { createSiweMessage } from 'viem/siwe';
import { ARC_CHAIN_ID } from '@/lib/paynode';
import { resetSupabaseSession } from '@/lib/supabase';

/**
 * Binds the connected wallet to a cryptographically verified Supabase session.
 *
 * Connecting a wallet proves nothing to our backend — it is a client-side UI state. Before
 * this provider existed the app passed `useAccount().address` straight into Supabase writes,
 * which meant anyone could claim any address with a single curl (audit C-4). Signing in
 * produces a signature the server verifies, and only then does a session exist.
 */

type SiweState = {
  /** Wallet the SERVER has verified. May lag or differ from the connected wallet. */
  authedWallet: string | null;
  status: 'loading' | 'unauthenticated' | 'authenticating' | 'authenticated';
  error: string | null;
  /** True when a wallet is connected but not yet signed in. */
  needsSignIn: boolean;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  /**
   * Re-read the session from the server and return the wallet it belongs to, or null.
   *
   * `authedWallet` is read once at mount and is not re-validated, so a token that expires
   * while a page sits open leaves it holding a wallet the server no longer recognises. Any
   * write that gates on the cached value would sail past its own check and fail at PostgREST
   * instead. Call this immediately before a write to gate on what the server actually says.
   */
  refresh: () => Promise<string | null>;
};

const SiweContext = React.createContext<SiweState | null>(null);

export function useSiwe(): SiweState {
  const ctx = React.useContext(SiweContext);
  if (!ctx) throw new Error('useSiwe must be used inside <SiweProvider>');
  return ctx;
}

export function SiweProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, status: accountStatus } = useAccount();
  const { signMessageAsync } = useSignMessage();
  // Whether wagmi has reported a live connection during this page load. Used to tell a user
  // who disconnected apart from a page that simply has not reconnected yet.
  const wasConnected = React.useRef(false);

  const [authedWallet, setAuthedWallet] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SiweState['status']>('loading');
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/siwe/session', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        setAuthedWallet(null);
        setStatus('unauthenticated');
        return null;
      }
      const data = (await res.json()) as { wallet?: string };
      const wallet = data.wallet ?? null;
      setAuthedWallet(wallet);
      setStatus(wallet ? 'authenticated' : 'unauthenticated');
      return wallet;
    } catch {
      setAuthedWallet(null);
      setStatus('unauthenticated');
      return null;
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = React.useCallback(async () => {
    await fetch('/api/siwe/logout', { method: 'POST', credentials: 'include' });
    resetSupabaseSession();
    setAuthedWallet(null);
    setStatus('unauthenticated');
    setError(null);
  }, []);

  const signIn = React.useCallback(async (): Promise<boolean> => {
    if (!address) {
      setError('Connect a wallet first.');
      return false;
    }
    setStatus('authenticating');
    setError(null);

    try {
      const nonceRes = await fetch('/api/siwe/nonce', { credentials: 'include', cache: 'no-store' });
      if (!nonceRes.ok) throw new Error('Could not start the sign-in challenge.');
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const message = createSiweMessage({
        address,
        // Must equal the Host header the server sees, or verification rejects it.
        domain: window.location.host,
        uri: window.location.origin,
        // Pin to Arc, so a signature farmed elsewhere cannot be replayed here.
        chainId: ARC_CHAIN_ID,
        nonce,
        version: '1',
        statement:
          'Sign in to PayNode. This proves you control this wallet. ' +
          'It is free, does not touch your funds, and authorises no transactions.',
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60 * 1000),
      });

      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch('/api/siwe/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });

      if (!verifyRes.ok) {
        const { error: serverError } = (await verifyRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(serverError ?? 'Sign-in failed.');
      }

      // The memoised Supabase token is now stale — force the next call to pick up the new one.
      resetSupabaseSession();
      await refresh();
      return true;
    } catch (err) {
      // A user dismissing the signature prompt is a choice, not a failure worth shouting about.
      const msg = err instanceof Error ? err.message : 'Sign-in failed.';
      setError(/rejected|denied|User rejected/i.test(msg) ? null : msg);
      setStatus('unauthenticated');
      return false;
    }
  }, [address, signMessageAsync, refresh]);

  // If the user switches accounts in their wallet, the old session no longer represents
  // them. Drop it immediately rather than letting them act under the previous identity.
  //
  // On a hard refresh wagmi starts in 'connecting'/'reconnecting' with isConnected === false
  // while /api/siwe/session is already in flight. Treating that gap as a disconnect used to
  // call signOut() whenever the session fetch won the race, wiping the still-valid cookie
  // and leaving the dashboard empty. Only a definitive state may end the session.
  React.useEffect(() => {
    if (accountStatus === 'connected') wasConnected.current = true;

    if (status !== 'authenticated' || !authedWallet) return;

    if (accountStatus === 'connected' && address) {
      if (address.toLowerCase() !== authedWallet) void signOut();
      return;
    }

    // A real disconnect: we watched the wallet connect and it is now definitively gone.
    if (accountStatus === 'disconnected' && wasConnected.current) {
      wasConnected.current = false;
      void signOut();
    }
  }, [address, accountStatus, authedWallet, status, signOut]);

  const value: SiweState = {
    authedWallet,
    status,
    error,
    needsSignIn: isConnected && status === 'unauthenticated',
    signIn,
    signOut,
    refresh,
  };

  return <SiweContext.Provider value={value}>{children}</SiweContext.Provider>;
}

/**
 * Drop-in gate for any action that writes to Supabase.
 * Renders a sign-in prompt when the wallet is connected but unverified.
 *
 * `autoPrompt` asks the wallet for the signature as soon as the gate appears, instead of
 * waiting for a click on the button below. Use it on pages a user only reaches in order to
 * write something — /onboarding, /create-profile, /settings — where the extra click is pure
 * friction and its absence was mistaken for the app being broken. Leave it off on pages that
 * are useful without a session: popping a signature request at someone who opened a public
 * profile or a tip link, before they have done anything, reads as a phishing attempt.
 *
 * It fires ONCE per connected wallet. Rejecting the prompt must not re-open it — signIn()
 * returns the status to 'unauthenticated', which is the same state that triggered it, so an
 * ungated effect here is an infinite signature loop. The button stays as the way back in.
 */
export function RequireSiwe({
  children,
  autoPrompt = false,
}: {
  children: React.ReactNode;
  autoPrompt?: boolean;
}) {
  const { needsSignIn, signIn, status, error } = useSiwe();
  const { address } = useAccount();

  /** Wallet we have already opened the prompt for, so a refusal is respected. */
  const promptedFor = React.useRef<string | null>(null);
  /** True only while the sign-in THIS gate started is still open in the wallet. */
  const [promptingHere, setPromptingHere] = React.useState(false);

  /** Used by both the automatic prompt and the button, so either keeps the gate up. */
  const startSignIn = React.useCallback(() => {
    setPromptingHere(true);
    void signIn().finally(() => setPromptingHere(false));
  }, [signIn]);

  React.useEffect(() => {
    if (!address) {
      // Disconnected: forget the refusal, so reconnecting later asks again.
      promptedFor.current = null;
      return;
    }
    if (!autoPrompt || !needsSignIn) return;

    const wallet = address.toLowerCase();
    if (promptedFor.current === wallet) return;
    // Marked BEFORE awaiting: signIn() flips status back to 'unauthenticated' on a
    // rejection, which would otherwise re-enter this effect and prompt again forever.
    promptedFor.current = wallet;
    startSignIn();
  }, [autoPrompt, needsSignIn, address, startSignIn]);

  // Hold the gate while OUR prompt is open, so the form is not left interactive behind the
  // signature dialog. Deliberately not `status === 'authenticating'`: the forms inside call
  // signIn() themselves before submitting, and gating on the global status would unmount the
  // child mid-await — losing everything typed into it, and in the tip page's case abandoning
  // a transaction that was about to be sent.
  if (!needsSignIn && !promptingHere) return <>{children}</>;

  return (
    <div className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-6 text-center">
      <h3 className="text-white font-bold mb-2">Verify your wallet</h3>
      <p className="text-slate-400 text-sm mb-5">
        Sign a free message to prove you own this address. No transaction, no gas.
      </p>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      <button
        onClick={startSignIn}
        disabled={status === 'authenticating'}
        className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-6 py-3 rounded-xl font-bold transition-all"
      >
        {status === 'authenticating' ? 'Check your wallet…' : 'Sign in with Ethereum'}
      </button>
    </div>
  );
}
