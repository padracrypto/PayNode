#!/usr/bin/env tsx
/**
 * Go-live gate for the autonomous dispute resolver.
 *
 * Why this exists: every way the resolver can be misconfigured produces the SAME symptom —
 * a `BadAttestation` or `ResolverDisabled` revert, discovered by whichever party tried to
 * submit a ruling, long after the signature was issued and the tokens were spent. The
 * configuration is also unusually unforgiving: a wrong key cannot be swapped out, it has to
 * go through `initiateResolverUpdate` and a 7-day timelock.
 *
 * So check it from the chain, before it matters:
 *
 *   npx tsx --env-file=.env.local scripts/check-resolver.ts
 *
 * Run it now, run it again the moment `applyResolverUpdate()` lands, and run it after any
 * change to RESOLVER_PRIVATE_KEY or NEXT_PUBLIC_ESCROW_ADDRESS.
 */

import { createPublicClient, fallback, http, hashTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arc, ARC_RPC_URLS, escrowContract, resolutionTypedData, PROTOCOL } from '../lib/paynode';

const ZERO = '0x0000000000000000000000000000000000000000';

const client = createPublicClient({
  chain: arc,
  transport: fallback(ARC_RPC_URLS.map((u) => http(u))),
});

const problems: string[] = [];
const warnings: string[] = [];

const fail = (m: string) => problems.push(m);
const warn = (m: string) => warnings.push(m);

function derivedAddress(): `0x${string}` | null {
  const raw = process.env.RESOLVER_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    fail('RESOLVER_PRIVATE_KEY is set but is not a 32-byte hex private key.');
    return null;
  }
  return privateKeyToAccount(key).address;
}

async function main() {
  console.log(`\nEscrow  ${escrowContract.address}  (chain ${escrowContract.chainId})\n`);

  const [epoch, pending, eta, block] = await Promise.all([
    client.readContract({ ...escrowContract, functionName: 'resolverEpoch' }),
    client.readContract({ ...escrowContract, functionName: 'pendingResolverSigner' }),
    client.readContract({ ...escrowContract, functionName: 'resolverUpdateEta' }),
    client.getBlock(),
  ]);

  const liveSigner = (await client.readContract({
    ...escrowContract,
    functionName: 'resolverAt',
    args: [epoch],
  })) as `0x${string}`;

  console.log(`Current epoch        ${epoch}`);
  console.log(`resolverAt[${epoch}]        ${liveSigner}${liveSigner === ZERO ? '   <- autonomous path DISABLED for this epoch' : ''}`);

  /* ---- pending rotation ---- */
  if (eta && Number(eta) !== 0) {
    const remaining = Number(eta) - Number(block.timestamp);
    console.log(`\nPending rotation     ${pending}`);
    console.log(`Applies at           ${new Date(Number(eta) * 1000).toISOString()}`);
    console.log(
      remaining <= 0
        ? `                     MATURE — applyResolverUpdate() is callable now`
        : `                     ${(remaining / 86400).toFixed(2)} days remaining ` +
          `(timelock is ${PROTOCOL.RESOLVER_TIMELOCK_SECONDS / 86400} days)`,
    );
  } else {
    console.log('\nPending rotation     (none)');
  }

  /* ---- our key ---- */
  const ours = derivedAddress();
  if (!ours) {
    fail('RESOLVER_PRIVATE_KEY is not set; the resolver cannot sign anything.');
  } else {
    console.log(`\nThis service signs as ${ours}`);

    const declared = process.env.RESOLVER_SIGNER_ADDRESS;
    if (declared && declared.toLowerCase() !== ours.toLowerCase()) {
      fail(`RESOLVER_SIGNER_ADDRESS is ${declared} but the key derives ${ours}.`);
    } else if (!declared) {
      warn('RESOLVER_SIGNER_ADDRESS is unset — set it so a wrong key fails at startup.');
    }

    const isLive = liveSigner.toLowerCase() === ours.toLowerCase();
    const isPending = String(pending).toLowerCase() === ours.toLowerCase();

    if (isLive) {
      console.log(`  -> authoritative for projects funded under epoch ${epoch}. Ready.`);
    } else if (isPending) {
      console.log(
        `  -> NOT yet authoritative. It becomes the epoch-${Number(epoch) + 1} key once ` +
          `applyResolverUpdate() is called,\n     and will then govern only projects funded ` +
          `AFTER that transaction.`,
      );
      warn(
        'Until the rotation is applied, /api/dispute/resolve will decline every project ' +
          'with reason "epoch_mismatch" or "resolver_disabled". That is correct behaviour, ' +
          'not a bug.',
      );
    } else {
      fail(
        `This key is neither the live epoch-${epoch} signer (${liveSigner}) nor the pending ` +
          `signer (${pending}). Nothing it signs can be submitted.`,
      );
    }
  }

  /* ---- epoch reachability ---- */
  if (liveSigner === ZERO) {
    warn(
      `resolverAt[${epoch}] is the zero address, so every project funded under epoch ${epoch} ` +
        `is permanently outside the autonomous path — resolveDisputeWithAttestation reverts ` +
        `with ResolverDisabled for all of them, whatever key is rotated in later. Those ` +
        `projects can only settle via a designated arbitrator, mutual settlement, or ` +
        `forceResolveStaleDispute after ${PROTOCOL.DISPUTE_TIMEOUT_SECONDS / 86400} days.`,
    );
  }

  /* ---- EIP-712 domain parity ---- */
  const probe = { id: 1n, bps: 5000, deadline: BigInt(Number(block.timestamp) + 3600) };
  const local = hashTypedData(resolutionTypedData(probe.id, probe.bps, probe.deadline));
  const onChain = (await client.readContract({
    ...escrowContract,
    functionName: 'resolutionDigest',
    args: [probe.id, probe.bps, probe.deadline],
  })) as `0x${string}`;

  if (local.toLowerCase() === onChain.toLowerCase()) {
    console.log(`\nEIP-712 domain       matches the contract (${local.slice(0, 18)}…)`);
  } else {
    fail(
      `EIP-712 domain mismatch: locally ${local}, contract ${onChain}. Check ` +
        `NEXT_PUBLIC_ESCROW_ADDRESS and NEXT_PUBLIC_ARC_CHAIN_ID.`,
    );
  }

  /* ---- supporting config ---- */
  for (const name of ['RESOLVER_SECRET', 'GEMINI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!process.env[name]) fail(`${name} is not set.`);
  }
  const secret = process.env.RESOLVER_SECRET;
  if (secret && secret.length < 32) {
    fail('RESOLVER_SECRET is shorter than 32 characters; the route rejects all requests.');
  }

  /* ---- report ---- */
  for (const w of warnings) console.log(`\nNOTE   ${w}`);
  for (const p of problems) console.log(`\nERROR  ${p}`);

  console.log(
    problems.length === 0
      ? `\n${warnings.length ? 'Configuration is consistent, with notes above.' : 'Configuration is consistent.'}\n`
      : `\n${problems.length} problem(s). Do not enable the resolver until these are fixed.\n`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\ncheck-resolver failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
