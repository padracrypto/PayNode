import { NextResponse } from 'next/server';
import { generateSiweNonce } from 'viem/siwe';
import { NONCE_COOKIE, NONCE_TTL_SECONDS, sessionCookieOptions } from '@/lib/siwe-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 1 of SIWE: issue a single-use nonce.
 *
 * The nonce is stored in an httpOnly cookie rather than in memory or a table: it must be
 * unreadable by page scripts (so an XSS cannot pre-sign a login) and must survive across
 * serverless instances without shared state.
 */
export async function GET() {
  const nonce = generateSiweNonce();

  const res = NextResponse.json({ nonce });
  res.cookies.set(NONCE_COOKIE, nonce, {
    ...sessionCookieOptions,
    maxAge: NONCE_TTL_SECONDS,
  });
  // Never let a CDN or the browser reuse a nonce response.
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}
