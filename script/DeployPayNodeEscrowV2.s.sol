// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PayNodeEscrowV2} from "../contracts/PayNodeEscrowV2.sol";

/**
 * Deploys PayNodeEscrowV2. Every constructor argument comes from the environment so nothing
 * is hardcoded per network, and nothing here ever touches a private key: signing is done by
 * Foundry from an encrypted keystore (`--account`) or a hardware wallet, never from an env var.
 *
 *   ESCROW_OWNER            owner (Ownable2Step). On mainnet use a multisig, not a hot key.
 *   ESCROW_RESOLVER_SIGNER  key that signs autonomous-resolver rulings. Keep it DIFFERENT from
 *                           the owner. address(0) disables the autonomous resolver entirely.
 *   ESCROW_FEE_RECIPIENT    receives protocol fees. Must be non-zero even when the fee is 0.
 *   ESCROW_FEE_BPS          protocol fee in basis points, 0..500.
 *
 * Simulate (sends nothing, needs no key):
 *   forge script script/DeployPayNodeEscrowV2.s.sol --rpc-url $RPC --sender $DEPLOYER
 * Deploy for real: add  --broadcast --account <keystore-name> --sender $DEPLOYER
 */
contract DeployPayNodeEscrowV2 is Script {
    function run() external returns (PayNodeEscrowV2 escrow) {
        address owner = vm.envAddress("ESCROW_OWNER");
        address resolverSigner = vm.envAddress("ESCROW_RESOLVER_SIGNER");
        address feeRecipient = vm.envAddress("ESCROW_FEE_RECIPIENT");
        uint256 feeBps = vm.envUint("ESCROW_FEE_BPS");

        // Fail here, before spending gas, with a message — the constructor's own reverts are
        // only bare custom errors.
        require(owner != address(0), "ESCROW_OWNER is zero");
        require(feeRecipient != address(0), "ESCROW_FEE_RECIPIENT is zero");
        require(feeBps <= 500, "ESCROW_FEE_BPS above the 500 bps cap");

        console2.log("chainId        :", block.chainid);
        console2.log("owner          :", owner);
        console2.log("resolverSigner :", resolverSigner);
        console2.log("feeRecipient   :", feeRecipient);
        console2.log("feeBps         :", feeBps);
        if (owner == resolverSigner) {
            console2.log("WARNING: owner and resolverSigner are the same key. Separate them for mainnet.");
        }

        vm.startBroadcast();
        escrow = new PayNodeEscrowV2(owner, resolverSigner, feeRecipient, uint16(feeBps));
        vm.stopBroadcast();

        console2.log("PayNodeEscrowV2:", address(escrow));
    }
}
