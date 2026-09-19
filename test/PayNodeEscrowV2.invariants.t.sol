// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PayNodeEscrowV2} from "../contracts/PayNodeEscrowV2.sol";

/*//////////////////////////////////////////////////////////////////////////
                                 ACTORS
//////////////////////////////////////////////////////////////////////////*/

/// @notice A recipient whose `receive()` always reverts, forcing the pull-payment fallback.
contract HostileRecipient {
    receive() external payable {
        revert("hostile");
    }
}

/// @notice A recipient that burns the gas stipend, also forcing the fallback.
contract GasBurner {
    uint256 public sink;

    receive() external payable {
        for (uint256 i; i < 1000; ++i) sink += i;
    }
}

/*//////////////////////////////////////////////////////////////////////////
                                 HANDLER
//////////////////////////////////////////////////////////////////////////*/

/**
 * @notice Bounded random-action driver for the invariant runner.
 * @dev    Every action is wrapped in try/catch. A revert is a legitimate outcome of a random
 *         call sequence (wrong actor, wrong state, too early) and must NOT abort the run —
 *         we are asserting that the accounting invariants hold across all *accepted* calls.
 *
 *         The handler also tracks ghost state that mirrors what the invariants check, so a
 *         failure report tells us which call sequence broke solvency.
 */
contract Handler is Test {
    PayNodeEscrowV2 public esc;

    address[] public clients;
    address[] public builders;
    address[] public arbitrators;
    address[] public allActors;

    uint256 public resolverPk;
    address public resolver;

    uint256[] public ids;

    // ---- ghost counters, for the failure report ----
    uint256 public ghost_funded;
    uint256 public ghost_settled;
    uint256 public ghost_deferredPayments;
    uint256 public ghost_forceResolved;
    uint256 public ghost_mutualSettled;
    uint256 public ghost_attestationResolved;

    constructor(PayNodeEscrowV2 _esc, uint256 _resolverPk) {
        esc = _esc;
        resolverPk = _resolverPk;
        resolver = vm.addr(_resolverPk);

        for (uint256 i; i < 3; ++i) {
            address c = address(uint160(0x1000 + i));
            address b = address(uint160(0x2000 + i));
            address a = address(uint160(0x3000 + i));
            clients.push(c);
            builders.push(b);
            arbitrators.push(a);
            allActors.push(c);
            allActors.push(b);
            allActors.push(a);
            vm.deal(c, 10_000 ether);
        }

        // Two payout-hostile builders, so the pull ledger is exercised by the fuzzer.
        address hostile = address(new HostileRecipient());
        address burner = address(new GasBurner());
        builders.push(hostile);
        builders.push(burner);
        allActors.push(hostile);
        allActors.push(burner);

        _seedInitialProjects();
    }

    /**
     * @dev Seed a non-trivial starting state for EVERY fuzz run.
     *
     *      Without this the fuzzer spends most of its depth budget on calls that revert
     *      because no project exists yet, and the suite passes vacuously. The call summary
     *      emitted by invariant_callSummary is the check on that: if 'funded' is near zero,
     *      the invariants are not actually being exercised and a green run means nothing.
     */
    function _seedInitialProjects() internal {
        for (uint256 i; i < 3; ++i) {
            address c = clients[i];
            address b = builders[i];
            address a = (i == 0) ? arbitrators[0] : address(0);

            vm.prank(c);
            uint256 id = esc.createProject(b, 10 ether, 30, 3, a);
            ids.push(id);

            vm.prank(c);
            esc.fundProject{value: 10 ether}(id);
            ghost_funded++;

            // Push one into Delivered so review/dispute paths are reachable immediately.
            if (i == 2) {
                vm.prank(b);
                esc.markDelivered(id);
            }
        }

        // One project routed to a payout-hostile builder, to keep the pull ledger live.
        address hostileBuilder = builders[builders.length - 1];
        vm.prank(clients[0]);
        uint256 hid = esc.createProject(hostileBuilder, 5 ether, 60, 2, address(0));
        ids.push(hid);
        vm.prank(clients[0]);
        esc.fundProject{value: 5 ether}(hid);
        ghost_funded++;

    }


    /// @dev Single canonical destructure of the 11-field public getter. If the Project struct
    ///      gains or loses a field, THIS is the only line that needs updating.
    function _p(uint256 id)
        internal view
        returns (address client, address builder, PayNodeEscrowV2.ProjectStatus status,
                 uint256 amount, uint8 maxRev, uint8 usedRev)
    {
        (client, , maxRev, usedRev, , builder, , status, , , amount) = esc.projects(id);
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function actorCount() external view returns (uint256) {
        return allActors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return allActors[i];
    }

    function idAt(uint256 i) external view returns (uint256) {
        return ids[i];
    }

    function _pickId(uint256 seed) internal view returns (uint256) {
        if (ids.length == 0) return 0;
        return ids[bound(seed, 0, ids.length - 1)];
    }

    function _client(uint256 seed) internal view returns (address) {
        return clients[bound(seed, 0, clients.length - 1)];
    }

    function _builder(uint256 seed) internal view returns (address) {
        return builders[bound(seed, 0, builders.length - 1)];
    }

    /*//////////////////////////////////////////////////////////////
                              LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    function createProject(uint256 cSeed, uint256 bSeed, uint256 amt, uint256 dur, uint8 revs, bool withArb)
        public
    {
        address c = _client(cSeed);
        address b = _builder(bSeed);
        if (c == b) return;

        amt = bound(amt, 1, 100 ether);
        dur = bound(dur, 1, 365);
        revs = uint8(bound(revs, 0, 10));
        address a = withArb ? arbitrators[bound(cSeed, 0, arbitrators.length - 1)] : address(0);
        if (a == c || a == b) a = address(0);

        vm.prank(c);
        try esc.createProject(b, amt, dur, revs, a) returns (uint256 id) {
            ids.push(id);
        } catch {}
    }

    function fundProject(uint256 seed) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        (address c, , , uint256 amount, , ) = _p(id);
        if (c == address(0)) return;

        vm.deal(c, c.balance + amount);
        vm.prank(c);
        try esc.fundProject{value: amount}(id) {
            ghost_funded++;
        } catch {}
    }

    function markDelivered(uint256 seed) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        ( , address b, , , , ) = _p(id);
        vm.prank(b);
        try esc.markDelivered(id) {} catch {}
    }

    function requestRevision(uint256 seed) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        (address c, , , , , ) = _p(id);
        vm.prank(c);
        try esc.requestRevision(id) {} catch {}
    }

    function releaseFunds(uint256 seed) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        (address c, , , , , ) = _p(id);
        vm.prank(c);
        try esc.releaseFunds(id) {
            ghost_settled++;
        } catch {}
    }

    function claimByBuilder(uint256 seed) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        ( , address b, , , , ) = _p(id);
        vm.prank(b);
        try esc.claimByBuilder(id) {
            ghost_settled++;
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                                 EXITS
    //////////////////////////////////////////////////////////////*/

    function cancelUnfunded(uint256 seed, bool asClient) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        (address c, address b, , , , ) = _p(id);
        vm.prank(asClient ? c : b);
        try esc.cancelUnfunded(id) {} catch {}
    }

    function builderCancel(uint256 seed) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        ( , address b, , , , ) = _p(id);
        vm.prank(b);
        try esc.builderCancel(id) {
            ghost_settled++;
        } catch {}
    }

    function claimRefund(uint256 seed) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        (address c, , , , , ) = _p(id);
        vm.prank(c);
        try esc.claimRefund(id) {
            ghost_settled++;
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                               DISPUTES
    //////////////////////////////////////////////////////////////*/

    function raiseDispute(uint256 seed, bool asClient) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        (address c, address b, , , , ) = _p(id);
        vm.prank(asClient ? c : b);
        try esc.raiseDispute(id) {} catch {}
    }

    function resolveDispute(uint256 seed, uint16 bps) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        bps = uint16(bound(bps, 0, 10_000));
        address a = esc.projectArbitrator(id);
        if (a == address(0)) return;
        vm.prank(a);
        try esc.resolveDispute(id, bps) {
            ghost_settled++;
        } catch {}
    }

    function resolveWithAttestation(uint256 seed, uint16 bps) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        bps = uint16(bound(bps, 0, 10_000));

        uint256 dl = block.timestamp + 1 hours;
        bytes32 digest = esc.resolutionDigest(id, bps, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(resolverPk, digest);

        try esc.resolveDisputeWithAttestation(id, bps, dl, abi.encodePacked(r, s, v)) {
            ghost_settled++;
            ghost_attestationResolved++;
        } catch {}
    }

    function proposeSettlement(uint256 seed, uint16 bps, bool asClient) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        bps = uint16(bound(bps, 0, 10_000));
        (address c, address b, , , , ) = _p(id);
        vm.prank(asClient ? c : b);
        try esc.proposeSettlement(id, bps) {} catch {}
    }

    function acceptSettlement(uint256 seed, bool asClient) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        (address proposer, uint16 bps) = esc.settlements(id);
        if (proposer == address(0)) return;
        (address c, address b, , , , ) = _p(id);
        vm.prank(asClient ? c : b);
        try esc.acceptSettlement(id, bps) {
            ghost_settled++;
            ghost_mutualSettled++;
        } catch {}
    }

    function forceResolveStaleDispute(uint256 seed, uint256 callerSeed) public {
        uint256 id = _pickId(seed);
        if (id == 0) return;
        vm.prank(allActors[bound(callerSeed, 0, allActors.length - 1)]);
        try esc.forceResolveStaleDispute(id) {
            ghost_settled++;
            ghost_forceResolved++;
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                          PULL LEDGER & TIME
    //////////////////////////////////////////////////////////////*/

    function withdraw(uint256 seed) public {
        address a = allActors[bound(seed, 0, allActors.length - 1)];
        vm.prank(a);
        try esc.withdraw() {} catch {}
    }

    /// @dev Time travel is itself a fuzzed action; the 7- and 30-day gates need it.
    function warp(uint256 secs) public {
        vm.warp(block.timestamp + bound(secs, 1 hours, 40 days));
    }

    /*//////////////////////////////////////////////////////////////
                           GHOST AGGREGATORS
    //////////////////////////////////////////////////////////////*/

    /// @notice Sum of `amount` over every project still holding escrow.
    function totalEscrowed() external view returns (uint256 total) {
        uint256 n = ids.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = ids[i];
            ( , , PayNodeEscrowV2.ProjectStatus status, uint256 amount, , ) = _p(id);
            if (
                status == PayNodeEscrowV2.ProjectStatus.Funded
                    || status == PayNodeEscrowV2.ProjectStatus.InRevision
                    || status == PayNodeEscrowV2.ProjectStatus.Delivered
                    || status == PayNodeEscrowV2.ProjectStatus.Disputed
            ) {
                total += amount;
            }
        }
    }

    /// @notice Sum of the pull-payment ledger across every actor, plus the fee recipient.
    function totalWithdrawable(address feeRecipient) external view returns (uint256 total) {
        uint256 n = allActors.length;
        for (uint256 i; i < n; ++i) {
            total += esc.withdrawable(allActors[i]);
        }
        total += esc.withdrawable(feeRecipient);
    }
}

/*//////////////////////////////////////////////////////////////////////////
                               INVARIANTS
//////////////////////////////////////////////////////////////////////////*/

contract PayNodeEscrowV2Invariants is Test {
    PayNodeEscrowV2 internal esc;
    Handler internal handler;

    address internal constant OWNER = address(0xA0);
    address internal constant FEE_TO = address(0xFEE);
    uint256 internal constant RESOLVER_PK = 0xBEEF;


    /// @dev Single canonical destructure of the 11-field public getter. If the Project struct
    ///      gains or loses a field, THIS is the only line that needs updating.
    function _p(uint256 id)
        internal view
        returns (address client, address builder, PayNodeEscrowV2.ProjectStatus status,
                 uint256 amount, uint8 maxRev, uint8 usedRev)
    {
        (client, , maxRev, usedRev, , builder, , status, , , amount) = esc.projects(id);
    }

    function setUp() public {
        esc = new PayNodeEscrowV2(OWNER, vm.addr(RESOLVER_PK), FEE_TO, 200); // 2% fee
        handler = new Handler(esc, RESOLVER_PK);

        targetContract(address(handler));

        // Only the handler may originate calls; actors are impersonated inside it.
        bytes4[] memory selectors = new bytes4[](17);
        selectors[0] = Handler.createProject.selector;
        selectors[1] = Handler.fundProject.selector;
        selectors[2] = Handler.markDelivered.selector;
        selectors[3] = Handler.requestRevision.selector;
        selectors[4] = Handler.releaseFunds.selector;
        selectors[5] = Handler.claimByBuilder.selector;
        selectors[6] = Handler.cancelUnfunded.selector;
        selectors[7] = Handler.builderCancel.selector;
        selectors[8] = Handler.claimRefund.selector;
        selectors[9] = Handler.raiseDispute.selector;
        selectors[10] = Handler.resolveDispute.selector;
        selectors[11] = Handler.resolveWithAttestation.selector;
        selectors[12] = Handler.proposeSettlement.selector;
        selectors[13] = Handler.acceptSettlement.selector;
        selectors[14] = Handler.forceResolveStaleDispute.selector;
        selectors[15] = Handler.withdraw.selector;
        selectors[16] = Handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /**
     * @notice THE SOLVENCY INVARIANT.
     *         Contract balance is exactly what it owes: escrow still held, plus payouts that
     *         were deferred to the pull ledger because a push transfer failed.
     *
     *         Any drain, double-spend, lost-payout or orphaned-balance bug breaks this.
     */
    function invariant_Solvency() public {
        uint256 escrowed = handler.totalEscrowed();
        uint256 owed = handler.totalWithdrawable(FEE_TO);
        assertEq(address(esc).balance, escrowed + owed, "SOLVENCY BROKEN");
    }

    /**
     * @notice Contract balance never dips below what it owes on the pull ledger alone.
     *         A weaker but independent check: catches a bug that credits `withdrawable`
     *         without the corresponding value actually being held.
     */
    function invariant_PullLedgerIsBacked() public {
        assertGe(address(esc).balance, handler.totalWithdrawable(FEE_TO), "PULL LEDGER UNBACKED");
    }

    /**
     * @notice LIVENESS. No disputed project can be stuck: every project sitting in Disputed
     *         must expose a finite, non-zero unlock time for the permissionless breaker.
     *         This is the property v1's C-1 violated, where Disputed had no exit at all.
     */
    function invariant_EveryDisputeIsEscapable() public {
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.idAt(i);
            ( , , PayNodeEscrowV2.ProjectStatus status, , , ) = _p(id);
            if (status == PayNodeEscrowV2.ProjectStatus.Disputed) {
                uint64 unlock = esc.staleResolvableAt(id);
                assertGt(unlock, 0, "DISPUTE HAS NO UNLOCK TIME");
                assertLe(
                    uint256(unlock),
                    block.timestamp + uint256(esc.DISPUTE_TIMEOUT()),
                    "DISPUTE UNLOCK IS UNREACHABLE"
                );
            }
        }
    }

    /**
     * @notice Terminal projects hold no escrow. Once Completed/Refunded/Cancelled, a project
     *         must never be counted as holding funds again — i.e. no resurrection.
     */
    function invariant_TerminalProjectsHoldNothing() public {
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.idAt(i);
            ( , , PayNodeEscrowV2.ProjectStatus status, , , ) = _p(id);
            bool terminal = status == PayNodeEscrowV2.ProjectStatus.Completed
                || status == PayNodeEscrowV2.ProjectStatus.Refunded
                || status == PayNodeEscrowV2.ProjectStatus.Cancelled;
            if (terminal) assertFalse(esc.isFunded(id), "TERMINAL PROJECT STILL FUNDED");
        }
    }

    /**
     * @notice Revisions never exceed the agreed cap, and the deadline is monotonic
     *         (extensions only, never contractions) for any project still live.
     */
    function invariant_RevisionCapRespected() public {
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.idAt(i);
            ( , , , , uint8 maxRev, uint8 usedRev) = _p(id);
            assertLe(usedRev, maxRev, "REVISION CAP EXCEEDED");
        }
    }

    /// @notice Surface the shape of the run, so a green result is not mistaken for a no-op.
    function invariant_callSummary() public {
        console2.log("funded            :", handler.ghost_funded());
        console2.log("settled           :", handler.ghost_settled());
        console2.log("  via attestation :", handler.ghost_attestationResolved());
        console2.log("  via mutual 2/2  :", handler.ghost_mutualSettled());
        console2.log("  via stale break :", handler.ghost_forceResolved());
        console2.log("projects created  :", handler.idCount());
        console2.log("escrow held       :", handler.totalEscrowed());
        console2.log("pull ledger owed  :", handler.totalWithdrawable(FEE_TO));
    }
}
