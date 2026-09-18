import { NextResponse } from 'next/server';
import { SESSION_COOKIE, NONCE_COOKIE, sessionCookieOptions } from '@/lib/siwe-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  res.cookies.set(NONCE_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
