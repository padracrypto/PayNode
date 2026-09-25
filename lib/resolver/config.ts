import 'server-only';

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { createPublicClient, fallback, http } from 'viem';
import { arc, ARC_RPC_URLS } from '../paynode';

/**
 * Server-only configuration for the autonomous dispute resolver.
 *
 * The private key here signs EIP-712 attestations that move real escrow. It is the second
 * most dangerous secret in the project after SUPABASE_JWT_SECRET, and unlike that one it
 * cannot be rotated instantly: `initiateResolverUpdate` -> 7-day timelock ->
 * `applyResolverUpdate`, and even then the rotation governs only projects funded AFTER it
 * takes effect (see `resolverEpoch` in PayNodeEscrowV2). A leak is therefore a 7-day
 * minimum incident with a long tail of already-funded projects still pinned to the leaked
 * key. Treat accordingly: never NEXT_PUBLIC_, never logged, never returned in a response.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[resolver] Missing server env var ${name}. Set it in .env.local (dev) and in the ` +
        `Vercel project settings (prod), marked Sensitive.`,
    );
  }
  return v;
}

/* -------------------------------------------------------------------------- */
/*                                   SIGNER                                   */
/* -------------------------------------------------------------------------- */

let memoisedAccount: PrivateKeyAccount | null = null;

/**
 * The resolver signing account.
 *
 * Memoised because deriving the public key from the private key is not free and every
 * request would otherwise redo it. Reading the env var lazily (rather than at module load)
 * keeps an unconfigured deployment from crashing routes that never touch the resolver.
 */
export function resolverAccount(): PrivateKeyAccount {
  if (memoisedAccount) return memoisedAccount;

  const raw = requireEnv('RESOLVER_PRIVATE_KEY').trim();
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    // Do not include the value, or a truncated form of it, in this message.
    throw new Error('[resolver] RESOLVER_PRIVATE_KEY must be a 32-byte hex private key.');
  }

  const account = privateKeyToAccount(key);

  /**
   * Fail fast on a key/address mismatch.
   *
   * RESOLVER_SIGNER_ADDRESS is not used to sign anything — it exists purely so that a
   * deployment configured with the WRONG key is a startup error rather than a stream of
   * `BadAttestation` reverts discovered by whichever party tried to submit a ruling. Set it
   * to the address announced in `ResolverUpdateInitiated`.
   */
  const expected = process.env.RESOLVER_SIGNER_ADDRESS;
  if (expected && expected.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `[resolver] RESOLVER_PRIVATE_KEY derives ${account.address}, but ` +
        `RESOLVER_SIGNER_ADDRESS is ${expected}. Refusing to sign with an unexpected key.`,
    );
  }

  memoisedAccount = account;
  return account;
}

/* -------------------------------------------------------------------------- */
/*                                   CHAIN                                    */
/* -------------------------------------------------------------------------- */

/**
 * Read-only chain client for the resolver's preflight checks.
 *
 * Separate from `lib/indexer/core.ts`'s client only because importing that module pulls in
 * `ws` and the whole indexer surface. Same fallback transport so one dead RPC does not
 * strand a dispute.
 */
export const resolverChainClient = createPublicClient({
  chain: arc,
  transport: fallback(ARC_RPC_URLS.map((u) => http(u))),
});

/* -------------------------------------------------------------------------- */
/*                                   MODEL                                    */
/* -------------------------------------------------------------------------- */

/**
 * The arbitration model.
 *
 * `gemini-3.5-flash` because it is what actually works, verified against a live key:
 *
 *   - `gemini-2.5-pro` returns 404 — "no longer available to new users". It is still listed
 *     by models.list(), so the listing is not evidence that a model is reachable.
 *   - every Pro-tier model (`gemini-3.1-pro-preview`, `gemini-pro-latest`) returns 429 on a
 *     free-tier key. Pro needs billing enabled on the Google Cloud project.
 *   - `gemini-3.8-flash` passed once and then returned 503 "high demand" — too flaky to
 *     default to for an endpoint that settles escrow.
 *
 * PREFER A PRO MODEL ONCE BILLING IS ON. This ruling divides the entire escrow and cannot be
 * appealed, which is exactly the workload that repays a more capable model. Set
 * RESOLVER_MODEL=gemini-3.1-pro-preview (or the current stable Pro) and re-run
 * `npm run test:arbitration` to confirm it still passes before pointing real disputes at it.
 *
 * Do NOT set this to an alias like `gemini-pro-latest`. The adjudication standard in
 * arbitrate.ts is deliberately frozen and versioned; a model that silently moves underneath
 * it changes rulings with no commit and no way to explain the change to a losing party.
 */
export const RESOLVER_MODEL = process.env.RESOLVER_MODEL ?? 'gemini-3.5-flash';

const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/**
 * Thinking depth for the arbitration call.
 *
 * `high` is the floor for anything intelligence-sensitive, and a dispute ruling is about as
 * intelligence-sensitive as this codebase gets — the cost of a wrong split is the entire
 * escrow. Do not lower it to save tokens. If you move to a Flash-tier model to cut cost,
 * measure the split it produces against Pro on real disputes first; a cheaper arbitrator
 * that is wrong once has wiped out a lot of saved inference.
 *
 * A function rather than a module-level constant on purpose. Resolving it eagerly would put
 * a throw in this module's import path, and Next.js imports route modules at build time —
 * so a typo in one env var would fail the whole deployment, including every route that has
 * nothing to do with arbitration.
 */
export function resolverThinkingLevel(): ThinkingLevel {
  const raw = (process.env.RESOLVER_THINKING_LEVEL ?? 'high').toLowerCase();
  const level = THINKING_LEVELS[raw];
  if (!level) {
    // Throw rather than fall back to the default. A typo silently downgrading every future
    // ruling is exactly the kind of quiet degradation nobody notices until a bad split.
    throw new Error(
      `[resolver] RESOLVER_THINKING_LEVEL must be one of ` +
        `${Object.keys(THINKING_LEVELS).join(', ')}; got "${raw}".`,
    );
  }
  return level;
}

/* -------------------------------------------------------------------------- */
/*                                GEMINI CLIENT                               */
/* -------------------------------------------------------------------------- */

let memoisedGenAI: GoogleGenAI | null = null;

/**
 * The Gemini client.
 *
 * Constructed lazily and memoised, for the same reason as the signer: a deployment that
 * never arbitrates a dispute should not fail to boot over an unset key, and re-reading the
 * environment on every request buys nothing.
 *
 * `apiKey` is passed explicitly rather than left to the SDK's env lookup. The SDK also
 * accepts GOOGLE_API_KEY and a Vertex AI credential path, and silently picking up whichever
 * of those happens to be set in a Vercel project is not a behaviour worth inheriting for a
 * call that signs money away — the key this service uses should be the one named here.
 */
export function geminiClient(): GoogleGenAI {
  if (!memoisedGenAI) {
    memoisedGenAI = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  }
  return memoisedGenAI;
}

/**
 * How long a freshly signed attestation stays submittable, in seconds.
 *
 * This is the `deadline` field the contract checks. It is a liveness bound, not a replay
 * guard — replay is handled by the project reaching a terminal status (on-chain) and by the
 * unique ruling row (off-chain). Long enough that a party who is travelling can still
 * submit; short enough that a ruling made on stale evidence cannot be sat on for a month
 * and sprung later.
 */
export const ATTESTATION_TTL_SECONDS = Number(
  process.env.RESOLVER_ATTESTATION_TTL_SECONDS ?? 7 * 24 * 60 * 60,
);
