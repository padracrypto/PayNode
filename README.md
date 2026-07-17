# PayNode: Decentralized Escrow & Payment Gateway on ARC

## 🚀 Overview
PayNode is a trustless, decentralized escrow platform and freelance payment hub built specifically for the **ARC ecosystem**. It bridges the gap between clients and builders by ensuring secure, milestone-based payments using USDC on the ARC Testnet. 

By leveraging smart contracts, PayNode eliminates payment anxiety: funds are locked securely upon project initiation and only released when both parties agree the work has been delivered.

## 🌟 Key Features
- **Decentralized Escrow:** Funds are securely locked in a smart contract, ensuring clients have the funds and builders get paid upon completion.
- **USDC Integration:** Seamless payments using standard ARC Testnet USDC.
- **Real-Time State Sync:** Instant UI updates tied to on-chain events via Supabase.
- **Role-Based Execution:** Only authorized wallets (Client/Freelancer) can trigger state changes (Deliver, Release).

## 🛠️ Tech Stack
- **Frontend:** Next.js, React, TailwindCSS
- **Web3 Integration:** Ethers.js
- **Database:** Supabase (PostgreSQL)
- **Smart Contracts:** Solidity (Deployed and Verified on ARC Testnet)

## 🔗 Smart Contract (ARC Testnet)
Our core escrow logic is deployed and fully verified on the ARC Testnet Explorer:
- **PayNode Escrow Contract:** 0x835393bCaa40d1e8B8D585567D17E38FdF8ABAc8
- **USDC Testnet Token:** 0x3600000000000000000000000000000000000000

## 💻 Escrow Lifecycle (How it works)
1. **Fund (Client):** The client inputs the freelancer's wallet address and pays the project budget in USDC. Funds are locked in the `PayNodeEscrow` contract.
2. **Deliver (Freelancer):** The assigned freelancer completes the work and triggers the "Deliver Work" function on-chain.
3. **Release (Client):** The client reviews the work and triggers the "Release Payment" function, which automatically transfers the USDC to the freelancer's wallet.

## 🚀 Running Locally
To run the PayNode interface locally:

1. Clone the repository.
2. Install dependencies:
   npm install
3. Set up your .env.local with your Supabase credentials.
4. Run the development server:
   npm run dev
5. Open http://localhost:3000 and ensure your MetaMask is connected to the ARC Testnet.