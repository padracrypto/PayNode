import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { createPublicClient, http } from 'viem';
import { arc, ARC_RPC_URLS } from './paynode';

/**
 * Server-side SIWE + Supabase session minting.
 *
 * WHY WE MINT OUR OWN JWT: Supabase Auth has no wallet provider. Rather than bolt on a
 * fake email identity, we sign a token with the project's JWT secret carrying a `wallet`
 * claim, and the RLS policies in supabase/migrations/0001_rls_siwe.sql match on it.
 * PostgREST accepts any token signed with that secret, so the secret is the crown jewel:
 * it is server-only and must never appear in a NEXT_PUBLIC_ var.
 */

export const SESSION_COOKIE = 'paynode-session';
export const NONCE_COOKIE = 'paynode-siwe-nonce';

/** Short enough that a stolen token expires quickly; long enough to avoid re-signing constantly. */
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h
export const NONCE_TTL_SECONDS = 60 * 10; // 10min

function requireServerEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[paynode] Missing server env var ${name}`);
  return v;
}

const jwtSecret = () => new TextEncoder().encode(requireServerEnv('SUPABASE_JWT_SECRET'));

/** Read-only chain client. Needed by verifySiweMessage for ERC-1271/6492 smart-account support. */
export const serverPublicClient = createPublicClient({
  chain: arc,
  transport: http(ARC_RPC_URLS[0]),
});

/**
 * Deterministic UUIDv5-shaped `sub` derived from the wallet.
 *
 * Supabase's `auth.uid()` parses `sub` as a UUID and errors on anything else. Our policies
 * use `auth.jwt() ->> 'wallet'` and never call auth.uid(), but a malformed sub would break
 * any future policy or Supabase internal that does — cheap insurance.
 */
export function walletToUuid(wallet: string): string {
  const h = createHash('sha256').update(`paynode:${wallet.toLowerCase()}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Mint a Supabase-compatible session token for a verified wallet. */
export async function mintSupabaseJwt(wallet: string): Promise<{ token: string; expiresAt: number }> {
  const address = wallet.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;

  const token = await new SignJWT({
    // Claims PostgREST requires to treat this as a logged-in request.
    role: 'authenticated',
    // The claim every RLS policy keys on. Lowercased here so policies never have to guess.
    wallet: address,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(walletToUuid(address))
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(jwtSecret());

  return { token, expiresAt: exp };
}

/** Verify a session token we previously minted. Returns the wallet, or null. */
export async function readSessionToken(
  token: string | undefined,
): Promise<{ wallet: string; exp: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), {
      audience: 'authenticated',
      algorithms: ['HS256'],
    });
    const wallet = typeof payload.wallet === 'string' ? payload.wallet.toLowerCase() : null;
    if (!wallet || !payload.exp) return null;
    return { wallet, exp: payload.exp };
  } catch {
    return null;
  }
}

/** Constant-time nonce comparison — a nonce check that leaks timing is not a nonce check. */
export function nonceMatches(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
