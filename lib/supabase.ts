import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client, authenticated by the SIWE session.
 *
 * Replaces both `lib/supabase.ts` and `app/lib/supabase.ts`, which disagreed on env
 * handling (`!` vs `|| ''`) and, more importantly, made every request anonymous. Under the
 * RLS policies in supabase/migrations/0001_rls_siwe.sql an anonymous request can read
 * public profiles and nothing else, so a session is now required for real work.
 *
 * The `accessToken` hook is supabase-js's third-party-auth integration: it is called before
 * every request, so a token that expires mid-session is refetched rather than 401-ing.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[paynode] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.',
  );
}

type CachedSession = { token: string; expiresAt: number };
let cached: CachedSession | null = null;
let inFlight: Promise<CachedSession | null> | null = null;

/** Refresh slightly early so a request never races the expiry boundary. */
const EXPIRY_SKEW_SECONDS = 60;

async function fetchSession(): Promise<CachedSession | null> {
  try {
    const res = await fetch('/api/siwe/session', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string; expiresAt?: number };
    if (!data.token || !data.expiresAt) return null;
    return { token: data.token, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - EXPIRY_SKEW_SECONDS > now) return cached.token;

  // Collapse concurrent misses into one request — every Supabase call hits this path.
  if (!inFlight) {
    inFlight = fetchSession().finally(() => {
      inFlight = null;
    });
  }
  cached = await inFlight;
  return cached?.token ?? null;
}

/** Drop the memoised token. Call after sign-in and sign-out so the next request re-reads. */
export function resetSupabaseSession() {
  cached = null;
  inFlight = null;
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  // We manage identity ourselves; don't let supabase-js try to persist or refresh a session.
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  accessToken: getAccessToken,
});
