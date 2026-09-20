# PayNode — production deployment (paynode.online)

Operator reference for the Vercel + Supabase go-live. Template for the variables:
[`.env.production.example`](.env.production.example). Validate before deploying: `npm run check:env`.

## 0. Decisions in force

1. **Escrow deployed on both networks.** Arc Testnet (chain `5042002`) is staging; Arc Mainnet (chain `5042`)
   was deployed on 2026-09-20. Addresses, deploy blocks, transactions and constructor arguments are recorded in
   [`deployments/`](deployments/) — that folder is the source of truth, the env vars are copies of it. See
   [§6](#6-switching-to-arc-mainnet) before pointing the site at mainnet.
2. **Next.js is pinned at 14.2.35.** A jump to 15.x was deferred to avoid wagmi/RainbowKit breakage right before
   launch. `npm audit --omit=dev` still lists advisories against every 14.x release (fixed only in 15.5.24+ / 16.x).
   Revisit before mainnet.
3. **Vercel Hobby, external cron.** Hobby cron is limited to once per day and a faster schedule makes the
   **deployment fail**, so `vercel.json` contains no `crons`. An external scheduler calls `/api/indexer` with
   `Authorization: Bearer <INDEXER_SECRET>` — see [§3](#3-indexer--cron).

## 1. Order of operations

Do these in order. Step 1 must precede step 3 — the new indexer calls functions that migration 0004 creates
and fails loudly (HTTP 500) without them.

1. **Supabase → SQL editor**, apply in order, each once: `0001_rls_siwe.sql`, `0002_indexer.sql`,
   `0003_projects_created_at.sql`, `0004_indexer_lock.sql`, `0005_arbitrator_read.sql`.
   Then check `select * from public.indexer_state;` returns one row, `id = 'escrow'`.
2. **Vercel → Environment Variables** (scope **Production**): add every variable in §2.
3. **Deploy.** The build runs the environment gate and refuses to ship if anything is missing or malformed.
4. **Verify** with §4.

## 2. Environment variables

`NEXT_PUBLIC_*` values are inlined into the bundle **at build time** and are visible to every visitor.
Changing one requires a redeploy. Secrets must never carry that prefix (the build gate enforces this).

| Key | Secret | Required | Format / where to get it |
|---|:-:|:-:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | yes | `https://<project-ref>.supabase.co` — no path, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | yes | Anon / publishable key. Public by design; RLS enforces access |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | yes | `service_role` (or "secret") key. **Bypasses RLS.** Server-only; used by `/api/indexer`. Tick *Sensitive* |
| `SUPABASE_JWT_SECRET` | **yes** | yes | The **SIWE secret**: the app signs each wallet session as an HS256 JWT with it and PostgREST verifies it. Supabase → Project Settings → API → *Legacy JWT Secret* |
| `NEXT_PUBLIC_ARC_CHAIN_ID` | no | yes | Positive integer |
| `NEXT_PUBLIC_ARC_CHAIN_NAME` | no | no | Display name; defaults to `Arc` |
| `NEXT_PUBLIC_ARC_RPC_URL` | no | yes | `https://…`. **Public** — any API key embedded in the URL is visible to visitors |
| `NEXT_PUBLIC_ARC_RPC_URL_BACKUP` | no | recommended | `https://…`. Failover for browser reads and the indexer. Note SIWE verification uses only the primary |
| `NEXT_PUBLIC_ARC_EXPLORER_URL` | no | recommended | No trailing slash; the app appends `/tx/<hash>` |
| `NEXT_PUBLIC_ARC_DECIMALS` | no | recommended | Integer, native-unit decimals. `18` verified against Arc testnet by `npm run check:arc` |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | no | yes | `0x` + 40 hex. Must be the contract `lib/paynode.abi.ts` was generated from (`npm run abi`) |
| `NEXT_PUBLIC_ESCROW_DEPLOY_BLOCK` | no | yes | Integer block of the deployment. Indexer's start point; unset means it scans from genesis |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | no | yes | From cloud.reown.com. Add `paynode.online` and `www.paynode.online` to that project's allowed domains |
| `INDEXER_SECRET` | **yes** | yes | **≥ 32 characters**: `openssl rand -hex 32`. Shorter values are rejected (HTTP 401) |
| `CRON_SECRET` | **yes** | Pro cron only | **Identical to `INDEXER_SECRET`.** Vercel Cron sends it as `Authorization: Bearer <value>` |
| `INDEXER_CONFIRMATIONS` | no | no | Default `5`. Blocks the indexer stays behind head |
| `INDEXER_MAX_RANGE` | no | **yes on free dRPC** | Default `2000`. Max blocks per `getLogs` call. The free `arc.drpc.org` plan rejects windows over ~100 blocks (measured), so set `100` there |
| `INDEXER_MAX_BLOCKS_PER_RUN` | no | no | Default `20000`. Caps one run so a backfill stays inside the function timeout |
| `INDEXER_POLL_MS` | no | no | Default `15000`. Standalone daemon (`npm run indexer`) only |

`NODE_ENV` and `VERCEL_ENV` are set by Vercel. Do not set them.

Notes:
- **`.env.local` currently has a 31-character `INDEXER_SECRET`.** It is rejected by the route. Generate a fresh one for production anyway.
- **Do not enable the service-role key for Preview** unless previews should write to the production database.
  Prefer a separate Supabase project for previews. Vercel Cron only runs on Production deployments.
- **Use one canonical host.** SIWE messages are bound to the request's `Host`, and the session cookie is host-only,
  so `paynode.online` and `www.paynode.online` are different sessions. Redirect one to the other under Vercel → Domains.

## 3. Indexer & cron

`GET|POST /api/indexer` runs one pass and is the **only** writer of authoritative project state.

**Auth** — one of, matched against `INDEXER_SECRET` in constant time (never accepted in the query string):

```
x-indexer-secret: <secret>
Authorization: Bearer <secret>
```

**Concurrency** — each run takes a database lease (migration 0004). A second overlapping call returns
`200 {"lockedOut": true}` and does nothing. The lease expires by itself if a run is killed, and only the lease
holder can advance the cursor, and only forwards. Replays are also harmless: `apply_project_event` skips any
log at or before a project's last applied `(block, log_index)`.

**Cursor** — table `public.indexer_state` (`id='escrow'`, column `last_indexed_block`), advanced once per
completed block range, so a crash resumes from the last completed range.

### 3a. Hobby plan — external scheduler (current setup)

`vercel.json` has no `crons`. Have any scheduler that can send a header call the endpoint every minute:

```bash
curl -fsS -X POST https://paynode.online/api/indexer -H "Authorization: Bearer $INDEXER_SECRET"
```

Treat any non-2xx as an alert. `CRON_SECRET` is not needed in this mode. Overlapping or duplicated calls are
safe (lease + idempotency above).

### 3b. Pro plan — Vercel Cron (if you upgrade)

Add to `vercel.json`:

```json
{ "crons": [{ "path": "/api/indexer", "schedule": "* * * * *" }] }
```

and set `CRON_SECRET` **identical** to `INDEXER_SECRET` (Vercel sends it as `Authorization: Bearer <value>`).
Cron delivery is best-effort and can duplicate or skip a tick; the lease and idempotency make that safe.

## 4. Verify after deploy

```bash
S=<INDEXER_SECRET>
curl -i https://paynode.online/api/indexer                          # expect 401
curl -s -X POST https://paynode.online/api/indexer -H "Authorization: Bearer $S"
```

| Response | Meaning |
|---|---|
| `200 {"ok":true,"caughtUp":true,…}` | Healthy |
| `200 {"ok":true,"caughtUp":false,…}` | Backfilling; each run makes progress. Persisting for hours = investigate |
| `200 {"lockedOut":true,…}` | Another run held the lease. Normal occasionally |
| `401` | Secret wrong, or shorter than 32 characters (server log says which) |
| `500 … has migration 0004 been applied?` | Apply migration 0004 |
| `500` other | RPC or database error; the cursor was not advanced, the next run retries |

Then: sign in with a wallet, create a small project, fund it, and confirm the row's `status` follows the chain
within about a minute. Alert on any non-2xx from the scheduler.

## 5. Known follow-ups (not blockers for a testnet staging launch)

- **Resolver key = contract owner.** On the testnet deployment `resolverSigner()` and `owner()` are the same
  address. For mainnet, separate them; put `owner` behind a multisig. Nothing in this repo produces resolver
  attestations, so "automatic resolution" needs an off-chain service you operate, or projects should use a designated arbitrator.
- **`feeBps` is 0** on the testnet deployment. Set the fee with `setFeeBps` if the protocol should earn one (cap 500 bps).
- **No UI for `withdraw()`.** A payout whose push fails is credited to `withdrawable[]`; the indexer mirrors it to
  `deferred_payments`, but nothing in the app shows or claims it.
- **Orphaned projects.** The DB row is inserted only after the browser sees the create receipt. If the tab closes
  first, the project exists on-chain with no row, and there is no relink path.
- **Timestamps.** `funded_at` / `settled_at` are the indexer's clock, not block time.
- **Dependencies.** `npm audit --omit=dev` still lists advisories in transitive packages (wallet SDK chain).

## 6. Switching to Arc mainnet

Replacing the RPC and contract values is necessary but **not sufficient**. Testnet state must not leak across:

1. **Use a separate Supabase project for mainnet** (apply migrations `0001`–`0005`). Reusing the staging database
   would leave `indexer_state.last_indexed_block` holding a *testnet* block number, and `projects.blockchain_id`
   values from testnet colliding with mainnet project ids. If you must reuse it, wipe the app tables and reset
   the cursor first (`update public.indexer_state set last_indexed_block = 0, locked_by = null, locked_until = null`).
2. Deploy the escrow to mainnet and, if the contract changed, regenerate the ABI (`npm run abi`) and commit it.
3. Replace **all** of: `NEXT_PUBLIC_ARC_CHAIN_ID`, `NEXT_PUBLIC_ARC_CHAIN_NAME`, `NEXT_PUBLIC_ARC_RPC_URL`,
   `NEXT_PUBLIC_ARC_RPC_URL_BACKUP`, `NEXT_PUBLIC_ARC_EXPLORER_URL`, `NEXT_PUBLIC_ESCROW_ADDRESS`,
   `NEXT_PUBLIC_ESCROW_DEPLOY_BLOCK`. Because they are baked in at build time, **redeploy** afterwards.
4. Re-run `npm run check:arc` against the mainnet RPC, then `npm run check:env`.
5. Address the §5 items that matter for real funds: separate the resolver key from the owner (owner behind a
   multisig), decide `feeBps`, and resolve the Next.js advisories from §0.
6. Add the mainnet domain to the WalletConnect project's allow-list and re-verify §4.

## 7. Deploying the escrow contract

`script/DeployPayNodeEscrowV2.s.sol` reads its constructor arguments from the environment. Signing is done by
Foundry from an encrypted keystore — never put a private key in an env var or a file.

| Variable | Constructor arg | Notes |
|---|---|---|
| `ESCROW_OWNER` | `_owner` | Pause, fee and resolver-rotation authority. **No** power over disputes or escrowed funds. Hand it to a multisig later with `transferOwnership` + `acceptOwnership` (two-step) |
| `ESCROW_RESOLVER_SIGNER` | `_resolverSigner` | Signs autonomous-resolver rulings. `0x000…0` disables that path (disputes then go to the arbitrator, mutual settlement, or the 30-day breaker). Changing it later costs a 7-day timelock and only affects projects funded afterwards |
| `ESCROW_FEE_RECIPIENT` | `_feeRecipient` | Must be non-zero even with a 0% fee; the owner can change it later |
| `ESCROW_FEE_BPS` | `_feeBps` | 0–500 |

```bash
cast wallet import mainnet-deployer --interactive        # once; prompts for the key
export ESCROW_OWNER=0x… ESCROW_RESOLVER_SIGNER=0x… ESCROW_FEE_RECIPIENT=0x… ESCROW_FEE_BPS=0
# simulate first — sends nothing, needs no key
forge script script/DeployPayNodeEscrowV2.s.sol --rpc-url $RPC --sender $DEPLOYER
# deploy
forge script script/DeployPayNodeEscrowV2.s.sol --rpc-url $RPC --sender $DEPLOYER --account mainnet-deployer --broadcast
```

The address is CREATE(deployer, nonce), so it changes if the deployer sends any other transaction first. Take the
address and block from the receipt, not from the simulation:

```bash
node -e "const r=require('./broadcast/DeployPayNodeEscrowV2.s.sol/<chainId>/run-latest.json').receipts[0];console.log(r.contractAddress, parseInt(r.blockNumber,16))"
cast code <addr> --rpc-url $RPC | head -c 12     # must start 0x6080…, never just 0x
cast call <addr> "owner()(address)" --rpc-url $RPC
```

Set `NEXT_PUBLIC_ESCROW_ADDRESS` and `NEXT_PUBLIC_ESCROW_DEPLOY_BLOCK` from that output and redeploy the site, and
record the deployment in `deployments/<network>.json` (`broadcast/` is git-ignored).
Never point the app at an address that has no code: a payable call to it succeeds and simply moves the funds.
