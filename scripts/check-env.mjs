#!/usr/bin/env node
/**
 * Production environment gate.
 *
 * Why this exists: every NEXT_PUBLIC_* variable is INLINED into the bundle at build time.
 * A missing or wrong value does not fail the build — it ships, and surfaces later as a
 * blank wallet modal, a project pointed at the wrong chain, or an indexer that 401s every
 * minute with no explanation. This turns those into a failed deploy instead.
 *
 * Used two ways:
 *   1. next.config.mjs runs it when VERCEL_ENV=production (or PAYNODE_STRICT_ENV=1), and
 *      throws on any error so the deployment stops before it goes live.
 *   2. `npm run check:env` runs it locally against .env.production (or .env.local) so you can
 *      validate values before pasting them into Vercel.
 */

import { pathToFileURL } from 'node:url';

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'NEXT_PUBLIC_ARC_CHAIN_ID',
  'NEXT_PUBLIC_ARC_RPC_URL',
  'NEXT_PUBLIC_ESCROW_ADDRESS',
  // Without this the indexer's cold start scans from genesis.
  'NEXT_PUBLIC_ESCROW_DEPLOY_BLOCK',
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
  'INDEXER_SECRET',
];

const MIN_SECRET_LENGTH = 32;

export function checkEnv(env) {
  const errors = [];
  const warnings = [];
  const get = (k) => (env[k] ?? '').trim();

  for (const key of REQUIRED) {
    if (!get(key)) errors.push(`${key} is not set.`);
  }

  // --- formats -----------------------------------------------------------------------
  const supaUrl = get('NEXT_PUBLIC_SUPABASE_URL');
  if (supaUrl && !/^https:\/\/[^/\s]+$/.test(supaUrl)) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL must be https://<ref>.supabase.co with no path and no trailing slash.');
  }

  const rpc = get('NEXT_PUBLIC_ARC_RPC_URL');
  if (rpc && !/^https:\/\//.test(rpc)) errors.push('NEXT_PUBLIC_ARC_RPC_URL must be an https:// URL.');
  const rpcBackup = get('NEXT_PUBLIC_ARC_RPC_URL_BACKUP');
  if (rpcBackup && !/^https:\/\//.test(rpcBackup)) {
    errors.push('NEXT_PUBLIC_ARC_RPC_URL_BACKUP must be an https:// URL.');
  }

  const addr = get('NEXT_PUBLIC_ESCROW_ADDRESS');
  if (addr && !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    errors.push('NEXT_PUBLIC_ESCROW_ADDRESS must be a 0x-prefixed 40-hex-character address.');
  }

  for (const key of ['NEXT_PUBLIC_ARC_CHAIN_ID', 'NEXT_PUBLIC_ESCROW_DEPLOY_BLOCK']) {
    const v = get(key);
    if (v && !/^[1-9]\d*$/.test(v)) errors.push(`${key} must be a positive integer (got "${v}").`);
  }

  const decimals = get('NEXT_PUBLIC_ARC_DECIMALS');
  if (!decimals) {
    warnings.push('NEXT_PUBLIC_ARC_DECIMALS is unset; the app will assume 18. Set it explicitly and run `npm run check:arc`.');
  } else if (!/^\d+$/.test(decimals)) {
    errors.push(`NEXT_PUBLIC_ARC_DECIMALS must be an integer (got "${decimals}").`);
  }

  // --- secrets -----------------------------------------------------------------------
  const indexer = get('INDEXER_SECRET');
  if (indexer && indexer.length < MIN_SECRET_LENGTH) {
    errors.push(
      `INDEXER_SECRET is ${indexer.length} characters; the route rejects anything under ${MIN_SECRET_LENGTH}. ` +
        'Generate one with: openssl rand -hex 32',
    );
  }

  const cron = get('CRON_SECRET');
  if (!cron) {
    warnings.push(
      'CRON_SECRET is unset. Vercel Cron sends CRON_SECRET as the Authorization header, so with no CRON_SECRET the ' +
        'scheduled indexer runs will 401. Set it to the same value as INDEXER_SECRET (ignore if you trigger the ' +
        'indexer from an external scheduler instead).',
    );
  } else if (indexer && cron !== indexer) {
    errors.push('CRON_SECRET must equal INDEXER_SECRET, otherwise every Vercel Cron call is rejected with 401.');
  }

  const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && serviceKey === get('NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY equals the anon key. The indexer needs the service_role / secret key.');
  }

  // A secret with a NEXT_PUBLIC_ prefix is shipped to every visitor's browser.
  for (const key of Object.keys(env)) {
    if (key.startsWith('NEXT_PUBLIC_') && /SERVICE_ROLE|SECRET|PRIVATE|JWT/i.test(key)) {
      errors.push(`${key} looks like a secret but has the NEXT_PUBLIC_ prefix, so it would be exposed to browsers.`);
    }
  }

  // --- soft warnings -----------------------------------------------------------------
  const chainName = get('NEXT_PUBLIC_ARC_CHAIN_NAME');
  if (/test/i.test(chainName) || /testnet/i.test(rpc) || /testnet/i.test(get('NEXT_PUBLIC_ARC_EXPLORER_URL'))) {
    warnings.push(
      `Chain config points at a TESTNET (${chainName || rpc}). Fine for a testnet launch; if this is meant to be ` +
        'mainnet, the chain id, RPC, explorer, escrow address and deploy block must all be replaced.',
    );
  }
  if (!rpcBackup) {
    warnings.push('NEXT_PUBLIC_ARC_RPC_URL_BACKUP is unset: a single RPC outage stalls both the UI reads and the indexer.');
  }

  return { errors, warnings };
}

// --- CLI ---------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { config } = await import('dotenv');
  // Real environment wins; then .env.production; then .env.local as a convenience.
  config({ path: '.env.production' });
  config({ path: '.env.local' });

  const { errors, warnings } = checkEnv(process.env);
  for (const w of warnings) console.warn(`  warn   ${w}`);
  for (const e of errors) console.error(`  ERROR  ${e}`);
  console.log(errors.length ? `\n${errors.length} error(s) — do not deploy.` : '\nEnvironment looks deployable.');
  process.exit(errors.length ? 1 : 0);
}
