// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PayNodeEscrowV2} from "../contracts/PayNodeEscrowV2.sol";

contract Reverter {
    receive() external payable { revert("nope"); }
}

contract PayNodeEscrowV2Test is Test {
    PayNodeEscrowV2 esc;

    address owner  = address(0xA0);
    address client = address(0xC1);
    address builder= address(0xB1);
    address arb    = address(0xAB);
    address feeTo  = address(0xFEE);
    address randos = address(0x9999);

    uint256 resolverPk = 0xBEEF;
    address resolver;

    function setUp() public {
        resolver = vm.addr(resolverPk);
        esc = new PayNodeEscrowV2(owner, resolver, feeTo, 200); // 2% fee
        vm.deal(client, 1000 ether);
        vm.deal(builder, 1 ether);
    }

    function _create(address _arb) internal returns (uint256 id) {
        vm.prank(client);
        id = esc.createProject(builder, 10 ether, 30, 2, _arb);
    }

    function _fund(uint256 id) internal {
        vm.prank(client);
        esc.fundProject{value: 10 ether}(id);
    }

    // ---------- core happy path + fee ----------
    function test_ReleaseAppliesSnapshottedFee() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.releaseFunds(id);
        assertEq(builder.balance, 1 ether + 9.8 ether); // 2% fee
        assertEq(feeTo.balance, 0.2 ether);
    }

    function test_FeeHikeCannotTouchInflightProject() public {
        uint256 id = _create(address(0));
        _fund(id);                                   // snapshots 200 bps
        vm.prank(owner); esc.setFeeBps(500);         // owner hikes to max
        vm.prank(client); esc.releaseFunds(id);
        assertEq(feeTo.balance, 0.2 ether);          // still 2%, not 5%
    }

    function test_FeeCannotExceedHardCap() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PayNodeEscrowV2.BpsTooHigh.selector, uint16(500)));
        esc.setFeeBps(501);
    }

    // ---------- H-1: late delivery front-running ----------
    function test_H1_LateDeliveryIsRejected() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.warp(block.timestamp + 31 days);
        vm.prank(builder);
        vm.expectRevert(PayNodeEscrowV2.DeadlinePassed.selector);
        esc.markDelivered(id);                       // cannot front-run the refund

        vm.prank(client); esc.claimRefund(id);       // client gets everything back
        assertEq(client.balance, 1000 ether);
    }

    // ---------- H-2: revision-then-expire work theft ----------
    function test_H2_RevisionExtendsDeadline() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.warp(block.timestamp + 29 days);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.requestRevision(id);  // would have expired in 1 day

        vm.warp(block.timestamp + 2 days);           // past the ORIGINAL deadline
        vm.prank(client);
        vm.expectRevert(PayNodeEscrowV2.DeadlineNotPassed.selector);
        esc.claimRefund(id);                         // grace period protects the builder
    }

    // ---------- H-3: hostile recipient cannot brick escrow ----------
    function test_H3_RevertingBuilderFallsBackToPullLedger() public {
        Reverter bad = new Reverter();
        vm.prank(client);
        uint256 id = esc.createProject(address(bad), 10 ether, 30, 2, address(0));
        _fund(id);

        vm.prank(client); esc.releaseFunds(id);      // does NOT revert
        assertEq(esc.withdrawable(address(bad)), 9.8 ether);
        assertEq(uint8(_status(id)), uint8(PayNodeEscrowV2.ProjectStatus.Completed));
    }

    // ---------- C-1 / path 4: the deadlock breaker ----------
    function test_Path4_StaleDisputeDelivered_SplitsFiftyFifty() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        vm.warp(block.timestamp + 30 days);
        vm.prank(randos);  esc.forceResolveStaleDispute(id);   // ANY address

        assertEq(builder.balance, 1 ether + 4.9 ether);        // 50% less 2% fee
        assertEq(client.balance, 1000 ether - 10 ether + 5 ether);
    }

    function test_Path4_StaleDisputeUndelivered_RefundsClient() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.raiseDispute(id);               // builder escalates pre-delivery
        vm.warp(block.timestamp + 30 days);
        vm.prank(randos);  esc.forceResolveStaleDispute(id);
        assertEq(client.balance, 1000 ether);                  // 100% back
    }

    function test_Path4_NotBeforeTimeout() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);
        vm.warp(block.timestamp + 29 days);
        vm.expectRevert();
        esc.forceResolveStaleDispute(id);
    }

    // ---------- client cannot rug work-in-progress ----------
    function test_ClientCannotDisputeBeforeDelivery() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(
            PayNodeEscrowV2.BadState.selector, PayNodeEscrowV2.ProjectStatus.Funded));
        esc.raiseDispute(id);
    }

    // ---------- path 1: designated arbitrator ----------
    function test_Path1_DesignatedArbitratorRules() public {
        uint256 id = _create(arb);
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        vm.prank(randos);
        vm.expectRevert(PayNodeEscrowV2.NotArbitrator.selector);
        esc.resolveDispute(id, 7000);

        vm.prank(arb); esc.resolveDispute(id, 7000);           // 70/30
        assertEq(builder.balance, 1 ether + 6.86 ether);       // 7 ether less 2%
    }

    function test_Path1_UnavailableWithoutArbitrator() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);
        vm.prank(arb);
        vm.expectRevert(PayNodeEscrowV2.NoArbitratorAssigned.selector);
        esc.resolveDispute(id, 7000);
    }

    // ---------- path 2: autonomous resolver attestation ----------
    function test_Path2_AttestationResolves() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        uint256 dl = block.timestamp + 1 hours;
        bytes32 digest = esc.resolutionDigest(id, 6000, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(resolverPk, digest);

        vm.prank(randos);                                       // relayed by anyone
        esc.resolveDisputeWithAttestation(id, 6000, dl, abi.encodePacked(r, s, v));
        assertEq(builder.balance, 1 ether + 5.88 ether);        // 6 ether less 2%
    }

    function test_Path2_RejectsForgedSignature() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        uint256 dl = block.timestamp + 1 hours;
        bytes32 digest = esc.resolutionDigest(id, 10000, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(uint256(0xBAD), digest);
        vm.expectRevert(PayNodeEscrowV2.BadAttestation.selector);
        esc.resolveDisputeWithAttestation(id, 10000, dl, abi.encodePacked(r, s, v));
    }

    function test_Path2_BlockedWhenArbitratorDesignated() public {
        uint256 id = _create(arb);
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        uint256 dl = block.timestamp + 1 hours;
        bytes32 digest = esc.resolutionDigest(id, 10000, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(resolverPk, digest);
        vm.expectRevert(PayNodeEscrowV2.ArbitratorAssigned.selector);
        esc.resolveDisputeWithAttestation(id, 10000, dl, abi.encodePacked(r, s, v));
    }

    // ---------- path 3: mutual 2-of-2 ----------
    function test_Path3_MutualSettlement() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        vm.prank(client);  esc.proposeSettlement(id, 8000);
        vm.prank(client);
        vm.expectRevert(PayNodeEscrowV2.CannotSelfAccept.selector);
        esc.acceptSettlement(id, 8000);

        vm.prank(builder);
        vm.expectRevert(abi.encodeWithSelector(PayNodeEscrowV2.SettlementMismatch.selector, uint16(8000)));
        esc.acceptSettlement(id, 9000);                          // cannot accept other terms

        vm.prank(builder); esc.acceptSettlement(id, 8000);
        assertEq(builder.balance, 1 ether + 7.84 ether);         // 8 ether less 2%
    }

    // ---------- owner powers are bounded ----------
    function test_OwnerCannotResolveOrPauseExits() public {
        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        vm.prank(owner);
        vm.expectRevert(PayNodeEscrowV2.NoArbitratorAssigned.selector);
        esc.resolveDispute(id, 10000);                           // owner has no say

        vm.prank(owner); esc.pause();
        vm.warp(block.timestamp + 30 days);
        esc.forceResolveStaleDispute(id);                        // exits stay open while paused
    }

    // ---------- resolver rotation timelock ----------
    function test_Timelock_CannotApplyEarly() public {
        vm.prank(owner); esc.initiateResolverUpdate(vm.addr(0xBEEF1));
        vm.prank(owner);
        vm.expectRevert();
        esc.applyResolverUpdate();
    }

    function test_Timelock_AppliesAfterSevenDays() public {
        address newSigner = vm.addr(0xFEED);
        vm.prank(owner); esc.initiateResolverUpdate(newSigner);
        vm.warp(block.timestamp + 7 days);
        vm.prank(owner); esc.applyResolverUpdate();
        assertEq(esc.resolverSigner(), newSigner);
        assertEq(esc.resolverEpoch(), 1);
    }

    function test_Timelock_CanBeCancelled() public {
        vm.prank(owner); esc.initiateResolverUpdate(vm.addr(0xFEED));
        vm.prank(owner); esc.cancelResolverUpdate();
        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        vm.expectRevert(PayNodeEscrowV2.NoPendingResolverUpdate.selector);
        esc.applyResolverUpdate();
        assertEq(esc.resolverSigner(), resolver);
    }

    /// @dev The property that matters: rotation cannot reach backwards into locked escrow.
    function test_Timelock_RotationCannotRetroactivelyGovernFundedEscrow() public {
        uint256 id = _create(address(0));
        _fund(id);                                    // pinned to epoch 0 (old resolver)
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        uint256 evilPk = 0xE711;
        vm.prank(owner); esc.initiateResolverUpdate(vm.addr(evilPk));
        vm.warp(block.timestamp + 7 days);
        vm.prank(owner); esc.applyResolverUpdate();

        // The NEW key cannot settle the OLD project.
        uint256 dl = block.timestamp + 1 hours;
        bytes32 digest = esc.resolutionDigest(id, 10000, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(evilPk, digest);
        vm.expectRevert(PayNodeEscrowV2.BadAttestation.selector);
        esc.resolveDisputeWithAttestation(id, 10000, dl, abi.encodePacked(r, s, v));

        // The key live at funding time still can.
        (v, r, s) = vm.sign(resolverPk, digest);
        esc.resolveDisputeWithAttestation(id, 10000, dl, abi.encodePacked(r, s, v));
        assertEq(esc.resolverFor(id), resolver);
    }

    function test_Timelock_RetiringResolverDisablesPathForNewProjects() public {
        vm.prank(owner); esc.initiateResolverUpdate(address(0));
        vm.warp(block.timestamp + 7 days);
        vm.prank(owner); esc.applyResolverUpdate();

        uint256 id = _create(address(0));
        _fund(id);
        vm.prank(builder); esc.markDelivered(id);
        vm.prank(client);  esc.raiseDispute(id);

        uint256 dl = block.timestamp + 1 hours;
        bytes32 digest = esc.resolutionDigest(id, 10000, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(resolverPk, digest);
        vm.expectRevert(PayNodeEscrowV2.ResolverDisabled.selector);
        esc.resolveDisputeWithAttestation(id, 10000, dl, abi.encodePacked(r, s, v));

        // ...but the deadlock breaker still guarantees liveness.
        vm.warp(block.timestamp + 30 days);
        esc.forceResolveStaleDispute(id);
    }

    // ---------- caps ----------
    function test_DurationAndRevisionCaps() public {
        vm.prank(client);
        vm.expectRevert(PayNodeEscrowV2.BadDuration.selector);
        esc.createProject(builder, 1 ether, 366, 2, address(0));

        vm.prank(client);
        vm.expectRevert(PayNodeEscrowV2.BadRevisions.selector);
        esc.createProject(builder, 1 ether, 30, 11, address(0));
    }

    // ---------- INVARIANT: escrow is always fully accounted for ----------
    function test_Invariant_BalanceMatchesObligations() public {
        uint256 a = _create(address(0)); _fund(a);
        uint256 b = _create(arb);        _fund(b);
        assertEq(address(esc).balance, 20 ether);

        vm.prank(builder); esc.markDelivered(a);
        vm.prank(client);  esc.releaseFunds(a);
        assertEq(address(esc).balance, 10 ether);                // only project b remains

        vm.prank(builder); esc.builderCancel(b);
        assertEq(address(esc).balance, 0);
    }

    function _status(uint256 id) internal view returns (PayNodeEscrowV2.ProjectStatus) {
        // getter order: client, deadline, maxRevisions, revisionsUsed, feeBps,
        //               builder, stateTimestamp, status, preDispute, resolverEpoch, amount
        (,,,,,,, PayNodeEscrowV2.ProjectStatus status,,,) = esc.projects(id);
        return status;
    }
}
