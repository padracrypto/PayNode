import { NextRequest, NextResponse } from 'next/server';
import { parseSiweMessage, verifySiweMessage } from 'viem/siwe';
import { isAddress } from 'viem';
import {
  NONCE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  mintSupabaseJwt,
  nonceMatches,
  serverPublicClient,
  sessionCookieOptions,
} from '@/lib/siwe-server';
import { ARC_CHAIN_ID } from '@/lib/paynode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 2 of SIWE: verify an EIP-4361 signature and mint a Supabase session.
 *
 * Everything below the signature check is a replay/phishing control. Verifying the
 * signature alone proves only that *some* wallet signed *some* text — it does not prove the
 * text was our login prompt, issued by us, for this site, recently. Each check closes one
 * of those gaps, so none of them is optional:
 *
 *   nonce   — pins the signature to a challenge WE issued, single-use (cookie is cleared).
 *   domain  — stops a signature farmed on evil.example being replayed here.
 *   uri     — same, for the full origin.
 *   chainId — stops a signature scoped to another chain being reused on Arc.
 *   time    — bounds how long a captured signature stays usable.
 *
 * Smart-contract wallets (Safe, 4337) are supported: verifySiweMessage takes a chain client
 * and falls back to ERC-1271 / ERC-6492 when the signer is not an EOA.
 */
export async function POST(req: NextRequest) {
  let body: { message?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const { message, signature } = body;
  if (typeof message !== 'string' || typeof signature !== 'string' || !signature.startsWith('0x')) {
    return NextResponse.json({ error: 'Missing message or signature.' }, { status: 400 });
  }

  // --- the nonce must be one we issued, and it is burned on use ---
  const expectedNonce = req.cookies.get(NONCE_COOKIE)?.value;
  const parsed = parseSiweMessage(message);

  if (!nonceMatches(parsed.nonce, expectedNonce)) {
    return NextResponse.json(
      { error: 'Login challenge expired or invalid. Please try again.' },
      { status: 401 },
    );
  }

  // --- the message must be scoped to THIS origin ---
  const host = req.headers.get('host') ?? '';
  if (!parsed.domain || parsed.domain !== host) {
    return NextResponse.json({ error: 'Signature was not issued for this site.' }, { status: 401 });
  }

  if (parsed.chainId !== undefined && parsed.chainId !== ARC_CHAIN_ID) {
    return NextResponse.json({ error: 'Signature is scoped to the wrong network.' }, { status: 401 });
  }

  if (!parsed.address || !isAddress(parsed.address)) {
    return NextResponse.json({ error: 'Signature is missing a valid address.' }, { status: 401 });
  }

  let valid = false;
  try {
    valid = await verifySiweMessage(serverPublicClient, {
      message,
      signature: signature as `0x${string}`,
      nonce: expectedNonce,
      domain: host,
      address: parsed.address,
      // Enforces notBefore/expirationTime from the message itself.
      time: new Date(),
    });
  } catch {
    valid = false;
  }

  if (!valid) {
    return NextResponse.json({ error: 'Signature verification failed.' }, { status: 401 });
  }

  const wallet = parsed.address.toLowerCase();
  const { token } = await mintSupabaseJwt(wallet);

  const res = NextResponse.json({ ok: true, wallet });
  res.cookies.set(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge: SESSION_TTL_SECONDS });
  // Burn the nonce so the same signature cannot be submitted twice.
  res.cookies.set(NONCE_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}
