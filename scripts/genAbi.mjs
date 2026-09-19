import { readFileSync, writeFileSync } from 'node:fs';

const abi = JSON.parse(readFileSync('contracts/out/abi.json', 'utf8'));

const header = `// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Source: contracts/PayNodeEscrowV2.sol
// Regenerate with:  npm run abi
//   (forge inspect PayNodeEscrowV2 abi --json > contracts/out/abi.json && node scripts/genAbi.mjs)
//
// The \`as const\` assertion is load-bearing: it is what gives wagmi/viem full type
// inference on args and return values. Removing it silently degrades every call site
// in the app to \`any\`.
`;

const body = `export const PAYNODE_ESCROW_ABI = ${JSON.stringify(abi, null, 2)} as const;\n`;

writeFileSync('lib/paynode.abi.ts', header + '\n' + body);
