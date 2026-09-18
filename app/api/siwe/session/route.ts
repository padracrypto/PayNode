import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, readSessionToken } from '@/lib/siwe-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hands the current session token back to the browser so supabase-js can attach it.
 *
 * The token lives in an httpOnly cookie, which page scripts cannot read directly. That is
 * deliberate: it keeps the durable copy out of reach of an XSS payload that runs before the
 * user authenticates. Once a signed-in page fetches it here it is in memory like any
 * Supabase access token would be, but it is never persisted to localStorage.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);

  if (!session) {
    const res = NextResponse.json({ authenticated: false }, { status: 401 });
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  }

  const res = NextResponse.json({
    authenticated: true,
    wallet: session.wallet,
    expiresAt: session.exp,
    token,
  });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}
