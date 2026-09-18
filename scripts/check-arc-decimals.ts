/**
 * Arc network configuration check.
 *
 *   npm run check:arc
 *
 * Resolves audit finding C-5: the app asserts `decimals: 18` for a USDC-denominated chain
 * and hardcodes 18 at every parseUnits call site. If Arc's native unit is actually 6
 * decimals at the RPC boundary, every amount in PayNode is wrong by a factor of 10^12 —
 * a "100 USDC" project would demand 100 trillion, and every transaction would fail.
 *
 * WHAT "DECIMALS" ACTUALLY MEANS HERE, because this trips people up:
 *
 *   At the EVM protocol level the native unit is ALWAYS integer wei. `msg.value`, balances
 *   and gas are plain integers; the chain has no opinion about where a decimal point goes.
 *   `nativeCurrency.decimals` is purely a DISPLAY convention that wallets and viem's
 *   formatEther/parseUnits use to turn those integers into human numbers.
 *
 *   So the question is not "what does the RPC return" — it is "how many integer units is
 *   one USDC on this chain". This script gathers the evidence that answers it and then
 *   asks you to confirm against a block explorer, because only the explorer (or Arc's own
 *   docs) states the intended convention authoritatively.
 *
 * Exit code 0 = checks ran. Non-zero = a hard mismatch worth blocking a deploy on.
 */

import { config as loadEnv } from 'dotenv';
import { createPublicClient, http, formatUnits, type Address } from 'viem';

// Next.js reads .env.local, but `dotenv/config` defaults to .env — loading the wrong file
// would make this script check an empty config and report a false pass.
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL;
const EXPECTED_CHAIN_ID = process.env.NEXT_PUBLIC_ARC_CHAIN_ID;
const CONFIGURED_DECIMALS = Number(process.env.NEXT_PUBLIC_ARC_DECIMALS ?? 18);
const EXPLORER = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? '';

/** Address the app previously hardcoded as USDC. If it holds code, it can be interrogated. */
const USDC_PRECOMPILE = '0x3600000000000000000000000000000000000000' as Address;

const ERC20_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

const ok = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const warn = (s: string) => console.log(`  \x1b[33m!\x1b[0m ${s}`);
const bad = (s: string) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
const head = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

let hardFailures = 0;

async function main() {
  if (!RPC) {
    console.error('NEXT_PUBLIC_ARC_RPC_URL is not set. Add it to .env.local first.');
    process.exit(2);
  }

  console.log(`\nArc configuration check\nRPC: ${RPC}`);

  const client = createPublicClient({ transport: http(RPC) });

  // ---------------------------------------------------------------------------
  head('1. Chain identity');
  // ---------------------------------------------------------------------------
  const chainId = await client.getChainId();
  console.log(`  reported chainId: ${chainId}`);

  if (!EXPECTED_CHAIN_ID) {
    warn('NEXT_PUBLIC_ARC_CHAIN_ID is not set — cannot cross-check.');
  } else if (Number(EXPECTED_CHAIN_ID) !== chainId) {
    bad(`MISMATCH: .env says ${EXPECTED_CHAIN_ID}, RPC says ${chainId}.`);
    bad('Every transaction would be signed for the wrong chain. Fix before deploying.');
    hardFailures++;
  } else {
    ok(`matches NEXT_PUBLIC_ARC_CHAIN_ID (${chainId}).`);
  }

  // ---------------------------------------------------------------------------
  head('2. Native USDC precompile');
  // ---------------------------------------------------------------------------
  let precompileDecimals: number | null = null;
  try {
    const code = await client.getCode({ address: USDC_PRECOMPILE });
    if (!code || code === '0x') {
      warn(`no contract code at ${USDC_PRECOMPILE} — this address is not a token on this chain.`);
      warn('(The old lib/contract.ts exported it as USDC_ADDRESS; it was never actually used.)');
    } else {
      const [dec, sym, name] = await Promise.all([
        client.readContract({ address: USDC_PRECOMPILE, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => null),
        client.readContract({ address: USDC_PRECOMPILE, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
        client.readContract({ address: USDC_PRECOMPILE, abi: ERC20_ABI, functionName: 'name' }).catch(() => null),
      ]);
      if (dec !== null) {
        precompileDecimals = Number(dec);
        ok(`${name ?? '?'} (${sym ?? '?'}) reports decimals() = ${precompileDecimals}`);
      } else {
        warn('contract exists but does not implement decimals().');
      }
    }
  } catch (err) {
    warn(`could not query the precompile: ${(err as Error).message}`);
  }

  // ---------------------------------------------------------------------------
  head('3. DECISIVE TEST — native balance vs ERC-20 balance');
  // ---------------------------------------------------------------------------
  //
  // On Arc the SAME asset is exposed two ways, and they do not use the same scale:
  //
  //   eth_getBalance        -> the native unit, 18 decimals. This is what msg.value,
  //                            gas and PayNodeEscrowV2 all operate in.
  //   USDC.balanceOf        -> the ERC-20 view, 6 decimals, matching canonical USDC.
  //
  // So the precompile's decimals() answers a DIFFERENT question than the one we need.
  // PayNode escrows native value, so the native scale is the one that matters.
  //
  // Reading the same address both ways settles it: the ratio between the two numbers
  // IS the decimal offset, with no interpretation required.
  let nativeDecimals: number | null = null;
  try {
    const bn = await client.getBlockNumber();
    const sampled = new Set<string>();

    for (let i = 0n; i < 6n && sampled.size < 8; i++) {
      const b = await client.getBlock({ blockNumber: bn - i, includeTransactions: true });
      for (const t of b.transactions as unknown as { from?: string; to?: string }[]) {
        if (t.from) sampled.add(t.from.toLowerCase());
        if (t.to) sampled.add(t.to.toLowerCase());
      }
    }

    const offsets: number[] = [];
    for (const a of [...sampled].slice(0, 6)) {
      const native = await client.getBalance({ address: a as Address });
      if (native === 0n) continue;

      let erc20: bigint | null = null;
      try {
        erc20 = (await client.readContract({
          address: USDC_PRECOMPILE,
          abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view',
                  inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
          functionName: 'balanceOf',
          args: [a as Address],
        })) as bigint;
      } catch { /* precompile may not expose balanceOf */ }

      if (!erc20 || erc20 === 0n) continue;

      // balanceOf truncates sub-6-decimal dust, so compare digit counts rather than
      // demanding an exact 1e12 ratio.
      const offset = native.toString().length - erc20.toString().length;
      offsets.push(offset);
      console.log(`  ${a}`);
      console.log(`    native ${native}  |  erc20 ${erc20}  |  offset 10^${offset}`);
    }

    if (offsets.length > 0) {
      const modal = offsets.sort((x, y) => offsets.filter(v => v === x).length - offsets.filter(v => v === y).length).pop()!;
      if (precompileDecimals !== null) {
        nativeDecimals = precompileDecimals + modal;
        ok(`ERC-20 scale ${precompileDecimals} + observed offset 10^${modal} => native is ${nativeDecimals} decimals.`);
      }
    } else {
      warn('no address exposed both balances — falling back to magnitude evidence.');
    }
  } catch (err) {
    warn(`could not sample balances: ${(err as Error).message}`);
  }

  // ---------------------------------------------------------------------------
  head('4. Corroborating magnitude evidence');
  // ---------------------------------------------------------------------------
  // Gas prices are the most reliable tell available without an explorer. On an 18-decimal
  // chain a base fee is typically 1e8..1e11 integer units (0.1–100 gwei). On a 6-decimal
  // chain the same economic price is a far smaller integer.
  const block = await client.getBlock();
  const gasPrice = await client.getGasPrice();

  console.log(`  latest block:  ${block.number}`);
  console.log(`  baseFeePerGas: ${block.baseFeePerGas ?? 'n/a'}`);
  console.log(`  gasPrice:      ${gasPrice}`);

  const typicalTxCost = gasPrice * 21_000n;
  console.log(`\n  A basic 21,000-gas transfer costs ${typicalTxCost} integer units.`);
  console.log(`    interpreted as  6 decimals -> ${formatUnits(typicalTxCost, 6)} USDC`);
  console.log(`    interpreted as 18 decimals -> ${formatUnits(typicalTxCost, 18)} USDC`);
  console.log('\n  Exactly one of those is a plausible transaction fee. That is your answer.');

  const asSix = Number(formatUnits(typicalTxCost, 6));
  const asEighteen = Number(formatUnits(typicalTxCost, 18));
  const plausible = (v: number) => v > 0.000001 && v < 10;

  let inferred: number | null = null;
  if (plausible(asSix) && !plausible(asEighteen)) inferred = 6;
  else if (plausible(asEighteen) && !plausible(asSix)) inferred = 18;

  if (inferred) ok(`magnitude evidence suggests ${inferred} decimals.`);
  else warn('inconclusive from gas alone — rely on the explorer check below.');

  // ---------------------------------------------------------------------------
  head('5. Verdict');
  // ---------------------------------------------------------------------------
  console.log(`  NEXT_PUBLIC_ARC_DECIMALS is currently ${CONFIGURED_DECIMALS}`);

  // Precedence matters. An earlier version of this script preferred the precompile's
  // decimals() and would have told you to set 6 — causing the exact 10^12 error it
  // exists to prevent. decimals() describes the ERC-20 VIEW; PayNode escrows NATIVE
  // value, so the balance-ratio result (section 3) is authoritative and the gas
  // magnitude only corroborates it.
  const evidence = nativeDecimals ?? inferred;

  if (evidence === null) {
    warn('No conclusive automated evidence. Do the manual check below before mainnet.');
  } else if (evidence === CONFIGURED_DECIMALS) {
    ok(`configuration agrees with the native scale (${evidence}).`);
    if (precompileDecimals !== null && precompileDecimals !== evidence) {
      console.log(
        `\n  Note: the ERC-20 view reports ${precompileDecimals} decimals for the same asset.\n` +
        `  That is expected and is NOT a conflict. Use ${precompileDecimals} only if you ever\n` +
        `  add an ERC-20 transfer path; native msg.value stays at ${evidence}.`,
      );
    }
  } else {
    bad(`CONFLICT: native scale is ${evidence}, configuration says ${CONFIGURED_DECIMALS}.`);
    bad(`Every amount in PayNode would be off by 10^${Math.abs(evidence - CONFIGURED_DECIMALS)}.`);
    bad(`Set NEXT_PUBLIC_ARC_DECIMALS=${evidence} and re-run.`);
    hardFailures++;
  }

  // ---------------------------------------------------------------------------
  head("6. Manual confirmation (do not skip)");
  // ---------------------------------------------------------------------------
  console.log('  Automated inference is evidence, not proof. Confirm it directly:');
  console.log('');
  console.log('    a. Open any funded address in the explorer:');
  console.log(`       ${EXPLORER || '<set NEXT_PUBLIC_ARC_EXPLORER_URL>'}/address/<your address>`);
  console.log('    b. Note the balance the explorer DISPLAYS.');
  console.log('    c. Compare with the raw integer below for the same address.');
  console.log('');
  console.log('    npx tsx -e "import{createPublicClient,http}from\'viem\';' +
              'createPublicClient({transport:http(process.env.NEXT_PUBLIC_ARC_RPC_URL!)})' +
              '.getBalance({address:\'0xYOURADDRESS\'}).then(console.log)"');
  console.log('');
  console.log('    The number of digits between the raw integer and the displayed value');
  console.log('    IS the decimal count. There is no ambiguity once you have both.');
  console.log('');
  console.log('  Then send ONE real transaction of a known small amount on testnet and');
  console.log('  confirm the explorer shows what you intended. A successful end-to-end');
  console.log('  transfer is the only check that covers wallet display as well as encoding.');

  console.log('');
  if (hardFailures > 0) {
    console.log(`\x1b[31m${hardFailures} hard failure(s). Do not deploy until resolved.\x1b[0m\n`);
    process.exit(1);
  }
  console.log('\x1b[32mNo hard failures. Complete step 5 before mainnet.\x1b[0m\n');
}

main().catch((err) => {
  console.error('\nCheck failed to run:', err);
  process.exit(2);
});
