import 'server-only';

import { hashTypedData, verifyTypedData } from 'viem';
import { escrowContract, resolutionTypedData } from '../paynode';
import { ATTESTATION_TTL_SECONDS, resolverAccount, resolverChainClient } from './config';

/**
 * EIP-712 attestation issuance.
 *
 * The typed-data payload itself is NOT redefined here. `resolutionTypedData` in
 * lib/paynode.ts is the single source of truth for the domain and the type, and it already
 * matches the contract's `EIP712("PayNodeEscrow", "2")` and
 * `Resolution(uint256 projectId,uint16 builderBps,uint256 deadline)`. A second copy of a
 * struct definition is how signature schemes drift apart, and the failure mode — a valid
 * signature over the wrong digest — is indistinguishable from a wrong key until someone
 * submits it and eats a `BadAttestation` revert.
 */

export type Attestation = {
  projectId: bigint;
  builderBps: number;
  /** Unix seconds. After this the contract rejects the attestation with AttestationExpired. */
  deadline: bigint;
  signature: `0x${string}`;
  signer: `0x${string}`;
  /** The digest the contract will reconstruct. Stored for support and debugging. */
  digest: `0x${string}`;
};

/**
 * Sign a ruling, then prove to ourselves that the contract will accept it.
 *
 * Three checks run before this returns, in increasing order of cost and authority:
 *
 *   1. Local recovery — does the signature recover to our own address over our own digest?
 *      Catches a malformed key or a viem misuse.
 *   2. Digest parity against the contract's `resolutionDigest` view — does the chain compute
 *      the SAME digest we signed? This is the one that catches domain drift: a chainId
 *      mismatch, a wrong verifyingContract, a contract redeployed at a new address while
 *      NEXT_PUBLIC_ESCROW_ADDRESS still points at the old one. Every one of those produces a
 *      perfectly valid signature over a digest the contract will never reconstruct.
 *   3. `builderBps` bounds, again, immediately before signing.
 *
 * Check 2 costs one eth_call per dispute. Disputes are rare and the alternative is handing a
 * party an attestation that reverts.
 */
export async function signResolution(args: {
  projectId: bigint;
  builderBps: number;
  /** Chain time, from the latest block — not Date.now(). The contract compares block time. */
  nowSeconds: bigint;
  ttlSeconds?: number;
}): Promise<Attestation> {
  const { projectId, builderBps, nowSeconds } = args;

  if (!Number.isInteger(builderBps) || builderBps < 0 || builderBps > 10_000) {
    throw new Error(`[resolver] Refusing to sign builderBps ${builderBps}.`);
  }

  const deadline = nowSeconds + BigInt(args.ttlSeconds ?? ATTESTATION_TTL_SECONDS);

  const account = resolverAccount();
  const typedData = resolutionTypedData(projectId, builderBps, deadline);

  const signature = await account.signTypedData(typedData);
  const digest = hashTypedData(typedData);

  // 1. Local recovery.
  const recovers = await verifyTypedData({ ...typedData, address: account.address, signature });
  if (!recovers) {
    throw new Error('[resolver] Signature does not verify against the resolver address.');
  }

  // 2. Digest parity with the contract.
  const onChainDigest = (await resolverChainClient.readContract({
    ...escrowContract,
    functionName: 'resolutionDigest',
    args: [projectId, builderBps, deadline],
  })) as `0x${string}`;

  if (onChainDigest.toLowerCase() !== digest.toLowerCase()) {
    throw new Error(
      `[resolver] EIP-712 domain mismatch: signed ${digest} but the contract at ` +
        `${escrowContract.address} on chain ${escrowContract.chainId} computes ${onChainDigest}. ` +
        `Check NEXT_PUBLIC_ESCROW_ADDRESS and NEXT_PUBLIC_ARC_CHAIN_ID before signing anything.`,
    );
  }

  return { projectId, builderBps, deadline, signature, signer: account.address, digest };
}

/**
 * The exact call a party (or a relayer) makes to enforce a stored ruling.
 *
 * Returned to the client as data rather than executed here. The contract lets ANYONE relay a
 * ruling — that is the point of the attestation design, so neither party needs the resolver
 * to hold gas — and keeping this service signature-only means the resolver key never needs a
 * funded balance. A key that cannot transact is a smaller target.
 */
export function submissionCall(a: Attestation) {
  return {
    address: escrowContract.address,
    chainId: escrowContract.chainId,
    functionName: 'resolveDisputeWithAttestation' as const,
    args: [a.projectId.toString(), a.builderBps, a.deadline.toString(), a.signature],
  };
}
