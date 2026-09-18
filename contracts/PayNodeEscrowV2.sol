// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title  PayNodeEscrowV2
 * @notice Native-asset escrow for the PayNode protocol on the Arc network, with
 *         decentralized dispute resolution and a guaranteed liveness backstop.
 *
 * @dev    ARCHITECTURE
 *         ------------
 *         Every project moves through a bounded state machine in which **no reachable
 *         state can hold funds indefinitely**. That property is the contract's core
 *         invariant and should be the primary target of invariant fuzzing:
 *
 *             for all reachable states S, there exists an actor A and a call C
 *             such that A can execute C within a bounded time and funds leave escrow.
 *
 *         DISPUTE RESOLUTION HAS THREE INDEPENDENT PATHS, IN PRIORITY ORDER
 *         ----------------------------------------------------------------
 *          1. Designated arbitrator  - if `projectArbitrator[id] != address(0)`, only that
 *                                      address may call {resolveDispute}. Chosen at creation.
 *          2. Autonomous resolver    - if `projectArbitrator[id] == address(0)`, an EIP-712
 *                                      attestation signed by the project's epoch resolver key
 *                                      may be submitted by anyone via
 *                                      {resolveDisputeWithAttestation}.
 *          3. Mutual 2-of-2          - at any funded stage, either party may
 *                                      {proposeSettlement} and the counterparty may
 *                                      {acceptSettlement}. Requires no third party at all.
 *
 *         And, underneath all three, the unconditional backstop:
 *          4. Stale-dispute breaker  - after {DISPUTE_TIMEOUT}, **anyone** may call
 *                                      {forceResolveStaleDispute}. No permissions, no keys.
 *
 *         WHAT THE OWNER CAN AND CANNOT DO
 *         --------------------------------
 *         The platform owner is deliberately NOT an arbitrator. The owner CAN:
 *           - set `feeBps`, bounded forever by the `constant` {MAX_FEE_BPS};
 *           - set `feeRecipient`;
 *           - {pause}, which blocks only NEW projects and fundings;
 *           - rotate the autonomous resolver key, but only by announcing it publicly and
 *             waiting {RESOLVER_TIMELOCK}, and only for projects funded AFTER it takes effect.
 *         The owner CANNOT: resolve a dispute, move escrowed funds, alter a project, change a
 *         project's arbitrator, change the resolver governing already-locked escrow, or block
 *         any exit path. Pausing cannot strand a single wei.
 *
 *         REMEDIATION MAP (see the pre-mainnet audit of PayNodeEscrow.sol v1)
 *         ------------------------------------------------------------------
 *           C-1  Disputed was terminal & unrecoverable -> paths 1-4 above.
 *           H-1  Late-delivery front-running of refunds -> deadline check in {markDelivered}.
 *           H-2  Revision-then-expire work theft        -> grace extension in {requestRevision}.
 *           H-3  Push-payment DoS by hostile recipient  -> {_send} pull fallback + {withdraw}.
 *           H-4  No reentrancy guard / duplicated state -> `nonReentrant` + `isFunded` removed.
 *           H-7  Unbounded duration disabled refunds    -> {MAX_DURATION_DAYS}, {MAX_REVISIONS_CAP}.
 *
 * @custom:security-contact security@paynode.online
 */
contract PayNodeEscrowV2 is ReentrancyGuard, Pausable, Ownable2Step, EIP712 {
    using ECDSA for bytes32;

    // =====================================================================
    // ERRORS
    // =====================================================================

    /// @notice A required address argument was the zero address.
    error ZeroAddress();
    /// @notice The client and builder, or a party and the arbitrator, are the same address.
    error SelfDeal();
    /// @notice The escrow amount must be greater than zero.
    error ZeroAmount();
    /// @notice Duration must be in the range [1, MAX_DURATION_DAYS].
    error BadDuration();
    /// @notice Requested revision allowance exceeds MAX_REVISIONS_CAP.
    error BadRevisions();
    /// @notice Caller is not the project's client.
    error NotClient();
    /// @notice Caller is not the project's builder.
    error NotBuilder();
    /// @notice Caller is neither the client nor the builder.
    error NotParty();
    /// @notice Caller is not the project's designated arbitrator.
    error NotArbitrator();
    /// @notice This project has no designated arbitrator; use the attestation path.
    error NoArbitratorAssigned();
    /// @notice This project HAS a designated arbitrator; the autonomous path is unavailable.
    error ArbitratorAssigned();
    /// @notice The contract has no active autonomous resolver signer.
    error ResolverDisabled();
    /// @notice No resolver rotation is currently pending.
    error NoPendingResolverUpdate();
    /// @notice The resolver rotation timelock has not yet elapsed.
    error ResolverTimelockActive(uint64 eta);
    /// @notice The attestation signature did not recover to RESOLVER_SIGNER.
    error BadAttestation();
    /// @notice The attestation's validity window has elapsed.
    error AttestationExpired(uint256 deadline);
    /// @notice The project is not in a state that permits this action.
    error BadState(ProjectStatus actual);
    /// @notice msg.value did not exactly match the registered escrow amount.
    error WrongValue(uint256 expected, uint256 sent);
    /// @notice The delivery deadline has already elapsed.
    error DeadlinePassed();
    /// @notice The delivery deadline has not yet elapsed.
    error DeadlineNotPassed();
    /// @notice The builder's 7-day auto-claim window is still open.
    error ReviewPeriodActive(uint64 until);
    /// @notice The 30-day dispute window has not yet elapsed.
    error DisputeWindowActive(uint64 until);
    /// @notice All revisions permitted by this project have been consumed.
    error RevisionsExhausted();
    /// @notice A basis-point value exceeded its permitted maximum.
    error BpsTooHigh(uint16 max);
    /// @notice No settlement has been proposed for this project.
    error NoSettlementProposed();
    /// @notice The accepted terms do not match the proposed terms.
    error SettlementMismatch(uint16 proposed);
    /// @notice A proposer cannot accept their own settlement; the counterparty must.
    error CannotSelfAccept();
    /// @notice Only the party that proposed a settlement may retract it.
    error NotProposer();
    /// @notice The caller has no balance in the pull-payment ledger.
    error NothingToWithdraw();
    /// @notice The pull-payment withdrawal transfer failed.
    error TransferFailed();

    // =====================================================================
    // CONSTANTS
    // =====================================================================

    /// @notice Absolute ceiling on the protocol fee, in basis points (5%).
    /// @dev    Declared `constant`, so it lives in bytecode rather than storage. Neither the
    ///         current owner nor any future owner can raise the fee beyond this value.
    uint16 public constant MAX_FEE_BPS = 500;

    /// @notice Basis-point denominator (100% == 10_000).
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Builder's auto-claim window after delivery, during which the client may act.
    uint64 public constant REVIEW_PERIOD = 7 days;

    /// @notice Deadline extension granted to the builder each time a revision is requested.
    /// @dev    Closes H-2: asking for more work always grants the time to perform it.
    uint64 public constant REVISION_GRACE = 7 days;

    /// @notice Time after which an unresolved dispute becomes permissionlessly resolvable.
    uint64 public constant DISPUTE_TIMEOUT = 30 days;

    /// @notice Mandatory delay between announcing and applying a resolver-key rotation.
    uint64 public constant RESOLVER_TIMELOCK = 7 days;

    /**
     * @notice Builder's share of a stale dispute where work HAD been delivered (50%).
     * @dev    POLICY PARAMETER, NOT A SAFETY PARAMETER. Per protocol specification, a stale
     *         dispute over delivered work splits 50/50. Be aware of the incentive this creates:
     *         a client holding a delivery can expect 0% by doing nothing (the builder claims
     *         after {REVIEW_PERIOD}), but 50% by disputing and waiting out {DISPUTE_TIMEOUT}.
     *         Where no designated arbitrator exists and the autonomous resolver does not
     *         respond, stalling is therefore the client's dominant strategy.
     *
     *         Raising this value toward `BPS_DENOMINATOR` removes that incentive by making a
     *         stale dispute converge on the outcome the client would have received anyway.
     *         Changing it is a one-line edit here; it is intentionally isolated for that reason.
     */
    uint16 public constant STALE_DISPUTE_BUILDER_BPS = 5_000;

    /// @notice Maximum project duration, in days.
    uint256 public constant MAX_DURATION_DAYS = 365;

    /// @notice Maximum number of revisions a project may permit.
    uint8 public constant MAX_REVISIONS_CAP = 10;

    /// @notice Gas forwarded to a recipient on the push leg of a payout.
    /// @dev    Bounded so a hostile recipient cannot burn the payer's gas. Exceeding it is
    ///         harmless: the amount falls through to the {withdrawable} pull ledger.
    uint256 private constant PAYOUT_GAS_STIPEND = 50_000;

    /// @dev EIP-712 typehash for an autonomous resolver attestation.
    bytes32 private constant RESOLUTION_TYPEHASH =
        keccak256("Resolution(uint256 projectId,uint16 builderBps,uint256 deadline)");

    // =====================================================================
    // TYPES
    // =====================================================================

    /// @notice Lifecycle states. Ordinals are load-bearing for the v1 subgraph — do not reorder.
    enum ProjectStatus {
        AwaitingFunds, // 0 - registered, not yet funded
        Funded,        // 1 - escrow held, builder working
        InRevision,    // 2 - client requested changes
        Completed,     // 3 - terminal: builder paid (wholly or partly)
        Disputed,      // 4 - terminal only via paths 1-4; never a dead end
        Cancelled,     // 5 - terminal: abandoned before funding
        Refunded,      // 6 - terminal: client repaid (wholly or partly)
        Delivered      // 7 - work submitted, review period running
    }

    /**
     * @notice Packed project record. Exactly 3 storage slots.
     * @dev    Field order is load-bearing. Reordering silently adds slots and raises the cost
     *         of {createProject} by ~20,000 gas per slot. Verify with `forge inspect
     *         PayNodeEscrowV2 storageLayout` after any change to this struct.
     *
     *         The optional per-project arbitrator is deliberately held in the separate
     *         {projectArbitrator} mapping rather than inline. Adding a 20-byte address here
     *         would force a 4th slot on *every* project; as a sidecar, it is written only when
     *         a designated arbitrator is actually chosen, so projects on the default autonomous
     *         path pay nothing for it.
     */
    struct Project {
        // ---- slot 0: 32/32 bytes ----
        address client;           // 20
        uint64 deadline;          //  8  unix seconds; uint64 overflows in year 2554
        uint8 maxRevisions;       //  1
        uint8 revisionsUsed;      //  1
        uint16 feeBps;            //  2  snapshotted at funding; immune to later fee changes
        // ---- slot 1: 32/32 bytes ----
        address builder;          // 20
        uint64 stateTimestamp;    //  8  deliveredAt, or disputeRaisedAt once Disputed
        ProjectStatus status;     //  1
        ProjectStatus preDispute; //  1  status captured at raiseDispute; drives the stale default
        uint16 resolverEpoch;     //  2  resolver generation snapshotted at funding
        // ---- slot 2 ----
        uint256 amount;
    }

    /// @notice A pending 2-of-2 mutual settlement offer. 1 storage slot.
    struct Settlement {
        address proposer;   // 20
        uint16 builderBps;  //  2
    }

    // =====================================================================
    // STORAGE
    // =====================================================================

    /**
     * @notice Current resolver generation. Incremented by each applied rotation.
     * @dev    Projects snapshot this at {fundProject}, and {resolveDisputeWithAttestation}
     *         validates against the snapshot rather than the live value. A rotation therefore
     *         governs only projects funded AFTER it takes effect; escrow that is already locked
     *         is settled by the key that was live when the client committed their funds.
     *
     *         This is what makes the rotation genuinely trust-preserving. The 7-day timelock
     *         alone would not be: a client whose project is mid-dispute cannot unilaterally
     *         exit within the notice window (only the builder can, via {builderCancel}), so
     *         "exit before the new key takes effect" is not an option they actually hold.
     *         Epoch-pinning gives them the guarantee directly instead of relying on exit.
     */
    uint16 public resolverEpoch;

    /// @notice Resolver generation => the signing key authoritative for that generation.
    mapping(uint16 => address) public resolverAt;

    /// @notice Resolver key awaiting the timelock. Meaningful only when {resolverUpdateEta} != 0.
    /// @dev    May legitimately be `address(0)`, which disables the autonomous path going
    ///         forward, so a pending rotation is detected via the ETA, never via this field.
    address public pendingResolverSigner;

    /// @notice Timestamp at which a pending rotation may be applied. 0 means none pending.
    uint64 public resolverUpdateEta;

    /// @notice Monotonic project counter. The most recent project's id IS this value.
    uint256 public projectCounter;

    /// @notice Protocol fee applied to NEW fundings, in basis points. Always <= MAX_FEE_BPS.
    uint16 public feeBps;

    /// @notice Recipient of protocol fees.
    address public feeRecipient;

    /// @notice Project id => project record.
    mapping(uint256 => Project) public projects;

    /// @notice Project id => designated arbitrator, or address(0) for the autonomous path.
    mapping(uint256 => address) public projectArbitrator;

    /// @notice Project id => pending mutual settlement offer.
    mapping(uint256 => Settlement) public settlements;

    /// @notice Recipient => balance owed after a failed push transfer. Claim via {withdraw}.
    mapping(address => uint256) public withdrawable;

    // =====================================================================
    // EVENTS
    // =====================================================================

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed client,
        address indexed builder,
        address arbitrator,
        uint256 amount,
        uint64 deadline,
        uint8 maxRevisions
    );
    event FundsLocked(uint256 indexed projectId, uint256 amount, uint16 feeBps);
    event WorkDelivered(uint256 indexed projectId, uint64 deliveredAt);
    event RevisionRequested(uint256 indexed projectId, uint8 revisionsLeft, uint64 newDeadline);
    event FundsReleased(uint256 indexed projectId, address indexed builder, uint256 netAmount, uint256 fee);
    event ProjectRefunded(uint256 indexed projectId, address indexed client, uint256 amount);
    event ProjectCancelled(uint256 indexed projectId);
    event DisputeRaised(uint256 indexed projectId, address indexed raisedBy, ProjectStatus preDispute, uint64 raisedAt);

    /// @param resolutionPath 0 = designated arbitrator, 1 = autonomous resolver,
    ///                       2 = mutual 2-of-2, 3 = stale-dispute breaker.
    event DisputeResolved(uint256 indexed projectId, uint16 builderBps, address indexed resolvedBy, uint8 resolutionPath);

    event SettlementProposed(uint256 indexed projectId, address indexed proposer, uint16 builderBps);
    event SettlementWithdrawn(uint256 indexed projectId, address indexed proposer);
    event PaymentDeferred(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event FeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    /// @notice A resolver rotation was announced. Indexers MUST surface this to users.
    event ResolverUpdateInitiated(address indexed newSigner, uint64 eta);
    event ResolverUpdateCancelled(address indexed abandonedSigner);
    event ResolverUpdated(uint16 indexed newEpoch, address indexed oldSigner, address indexed newSigner);

    // =====================================================================
    // MODIFIERS
    // =====================================================================

    modifier onlyClient(uint256 projectId) {
        if (msg.sender != projects[projectId].client) revert NotClient();
        _;
    }

    modifier onlyBuilder(uint256 projectId) {
        if (msg.sender != projects[projectId].builder) revert NotBuilder();
        _;
    }

    modifier onlyParty(uint256 projectId) {
        Project storage p = projects[projectId];
        if (msg.sender != p.client && msg.sender != p.builder) revert NotParty();
        _;
    }

    // =====================================================================
    // CONSTRUCTOR
    // =====================================================================

    /**
     * @param _owner          Protocol owner. Governs fees and pausing only — never disputes.
     * @param _resolverSigner Autonomous resolver signing key for epoch 0. Pass `address(0)` to
     *                        ship with the autonomous path disabled; designated arbitrators,
     *                        mutual settlement and the stale-dispute breaker all remain
     *                        available. Rotatable later via the 7-day timelock.
     * @param _feeRecipient   Destination for protocol fees.
     * @param _feeBps         Initial fee in basis points. Must be <= {MAX_FEE_BPS}. Pass 0 to
     *                        launch fee-free while retaining the ability to enable fees later.
     */
    constructor(
        address _owner,
        address _resolverSigner,
        address _feeRecipient,
        uint16 _feeBps
    ) Ownable(_owner) EIP712("PayNodeEscrow", "2") {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS) revert BpsTooHigh(MAX_FEE_BPS);

        resolverAt[0] = _resolverSigner; // epoch 0
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
    }

    // =====================================================================
    // LIFECYCLE
    // =====================================================================

    /**
     * @notice Register a new escrow agreement. Called by the client; moves no funds.
     * @dev    The arbitrator is nominated by the client here. The builder's acceptance is
     *         implicit: they may inspect {projectArbitrator} and exit at any funded stage via
     *         {builderCancel}, which returns 100% to the client. Builders should verify the
     *         arbitrator before beginning work.
     * @param _builder        Counterparty who will perform the work. Cannot be the client.
     * @param _amount         Exact escrow amount in the chain's native unit (wei-equivalent).
     *                        {fundProject} requires `msg.value` to equal this precisely, so
     *                        clients must pass the exact integer, never a float-derived value.
     * @param _durationInDays Delivery window in days. Range [1, {MAX_DURATION_DAYS}].
     * @param _maxRevisions   Revisions permitted. Range [0, {MAX_REVISIONS_CAP}].
     * @param _arbitrator     Optional third-party arbitrator. Pass `address(0)` to use the
     *                        autonomous resolution path.
     * @return projectId      The new project's id. Equals {projectCounter} after this call.
     */
    function createProject(
        address _builder,
        uint256 _amount,
        uint256 _durationInDays,
        uint8 _maxRevisions,
        address _arbitrator
    ) external whenNotPaused returns (uint256 projectId) {
        if (_builder == address(0)) revert ZeroAddress();
        if (_builder == msg.sender) revert SelfDeal();
        if (_arbitrator == msg.sender || _arbitrator == _builder) revert SelfDeal();
        if (_amount == 0) revert ZeroAmount();
        if (_durationInDays == 0 || _durationInDays > MAX_DURATION_DAYS) revert BadDuration();
        if (_maxRevisions > MAX_REVISIONS_CAP) revert BadRevisions();

        unchecked {
            projectId = ++projectCounter;
        }

        uint64 deadline = uint64(block.timestamp + _durationInDays * 1 days);

        Project storage p = projects[projectId];
        p.client = msg.sender;
        p.deadline = deadline;
        p.maxRevisions = _maxRevisions;
        p.builder = _builder;
        p.amount = _amount;
        // status, revisionsUsed, feeBps, stateTimestamp, preDispute all default to 0.

        // Sidecar write, skipped entirely on the default autonomous path.
        if (_arbitrator != address(0)) projectArbitrator[projectId] = _arbitrator;

        emit ProjectCreated(projectId, msg.sender, _builder, _arbitrator, _amount, deadline, _maxRevisions);
    }

    /**
     * @notice Lock the escrow. Only the client, only once, and only for the exact amount.
     * @dev    Snapshots the live {feeBps} AND {resolverEpoch} into the project, so neither a
     *         subsequent {setFeeBps} nor a subsequent resolver rotation can retroactively alter
     *         the terms of escrow that is already locked.
     */
    function fundProject(uint256 projectId)
        external
        payable
        onlyClient(projectId)
        whenNotPaused
        nonReentrant
    {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.AwaitingFunds) revert BadState(p.status);
        if (msg.value != p.amount) revert WrongValue(p.amount, msg.value);

        p.status = ProjectStatus.Funded;
        p.feeBps = feeBps;
        p.resolverEpoch = resolverEpoch; // same slot as `status`, so effectively free

        emit FundsLocked(projectId, msg.value, p.feeBps);
    }

    /**
     * @notice Builder submits the work, starting the client's {REVIEW_PERIOD}.
     * @dev    FIX H-1. Delivery is rejected once the deadline has elapsed. In v1 this check was
     *         absent, so a late builder could watch the mempool for the client's refund
     *         transaction, front-run it with `markDelivered`, push the project into a state
     *         where refunds revert, and then claim the full escrow after the review period —
     *         extracting 100% having delivered nothing.
     */
    function markDelivered(uint256 projectId) external onlyBuilder(projectId) {
        Project storage p = projects[projectId];
        ProjectStatus s = p.status;
        if (s != ProjectStatus.Funded && s != ProjectStatus.InRevision) revert BadState(s);
        if (block.timestamp > p.deadline) revert DeadlinePassed();

        p.status = ProjectStatus.Delivered;
        p.stateTimestamp = uint64(block.timestamp);

        emit WorkDelivered(projectId, p.stateTimestamp);
    }

    /**
     * @notice Client requests changes, consuming one revision and extending the deadline.
     * @dev    FIX H-2. The extension is what makes this safe. In v1 the deadline never moved,
     *         so a client could accept a delivery, request a revision to void the builder's
     *         claim clock, wait out the original deadline, and take a 100% refund of work
     *         they already possessed. The builder is now always granted {REVISION_GRACE} from
     *         now, and the deadline is only ever extended, never shortened.
     */
    function requestRevision(uint256 projectId) external onlyClient(projectId) {
        Project storage p = projects[projectId];
        ProjectStatus s = p.status;
        if (s != ProjectStatus.Funded && s != ProjectStatus.InRevision && s != ProjectStatus.Delivered) {
            revert BadState(s);
        }

        uint8 used = p.revisionsUsed;
        if (used >= p.maxRevisions) revert RevisionsExhausted();

        unchecked {
            p.revisionsUsed = used + 1;
        }
        p.status = ProjectStatus.InRevision;
        p.stateTimestamp = 0; // void the stale delivery clock

        uint64 extended = uint64(block.timestamp) + REVISION_GRACE;
        if (extended > p.deadline) p.deadline = extended;

        emit RevisionRequested(projectId, p.maxRevisions - p.revisionsUsed, p.deadline);
    }

    /// @notice Client approves and pays the builder in full. Valid at any funded stage.
    function releaseFunds(uint256 projectId) external onlyClient(projectId) nonReentrant {
        Project storage p = projects[projectId];
        ProjectStatus s = p.status;
        if (s != ProjectStatus.Funded && s != ProjectStatus.InRevision && s != ProjectStatus.Delivered) {
            revert BadState(s);
        }

        p.status = ProjectStatus.Completed;
        _clearSettlement(projectId);
        _payBuilder(projectId, p, p.amount);
    }

    /**
     * @notice Builder claims payment after the client ignored a delivery for {REVIEW_PERIOD}.
     * @dev    This is the protocol's protection against an absent client. Note that a dispute
     *         raised during the review period suspends it; resolution then runs through
     *         {resolveDispute}, {acceptSettlement} or {forceResolveStaleDispute}.
     */
    function claimByBuilder(uint256 projectId) external onlyBuilder(projectId) nonReentrant {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Delivered) revert BadState(p.status);

        uint64 unlockAt = p.stateTimestamp + REVIEW_PERIOD;
        if (block.timestamp < unlockAt) revert ReviewPeriodActive(unlockAt);

        p.status = ProjectStatus.Completed;
        _clearSettlement(projectId);
        _payBuilder(projectId, p, p.amount);
    }

    // =====================================================================
    // EXITS
    // =====================================================================

    /// @notice Either party abandons the agreement before it was ever funded.
    function cancelUnfunded(uint256 projectId) external onlyParty(projectId) {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.AwaitingFunds) revert BadState(p.status);

        p.status = ProjectStatus.Cancelled;
        emit ProjectCancelled(projectId);
    }

    /**
     * @notice Builder withdraws from the engagement, returning 100% to the client.
     * @dev    Always available to the builder at any funded stage, with no deadline condition.
     *         This is what makes the client-nominated arbitrator safe: a builder who dislikes
     *         the nominated arbitrator can exit before performing any work.
     */
    function builderCancel(uint256 projectId) external onlyBuilder(projectId) nonReentrant {
        Project storage p = projects[projectId];
        ProjectStatus s = p.status;
        if (s != ProjectStatus.Funded && s != ProjectStatus.InRevision && s != ProjectStatus.Delivered) {
            revert BadState(s);
        }

        p.status = ProjectStatus.Refunded;
        _clearSettlement(projectId);
        _refundClient(projectId, p, p.amount);
    }

    /**
     * @notice Client reclaims the escrow after the builder missed the deadline undelivered.
     * @dev    Deliberately unavailable from {ProjectStatus.Delivered}: once work is submitted
     *         the client must approve, request a revision, or dispute. Combined with the
     *         deadline check in {markDelivered}, this makes the refund/delivery race decidable
     *         rather than gas-auctioned.
     */
    function claimRefund(uint256 projectId) external onlyClient(projectId) nonReentrant {
        Project storage p = projects[projectId];
        ProjectStatus s = p.status;
        if (s != ProjectStatus.Funded && s != ProjectStatus.InRevision) revert BadState(s);
        if (block.timestamp <= p.deadline) revert DeadlineNotPassed();

        p.status = ProjectStatus.Refunded;
        _clearSettlement(projectId);
        _refundClient(projectId, p, p.amount);
    }

    // =====================================================================
    // DISPUTES
    // =====================================================================

    /**
     * @notice Escalate a project to {ProjectStatus.Disputed}.
     * @dev    ASYMMETRIC BY DESIGN. The client may escalate ONLY from {ProjectStatus.Delivered};
     *         the builder may escalate from any funded stage.
     *
     *         The asymmetry is required for safety. A stale dispute over undelivered work
     *         resolves 100% to the client, so if the client could escalate pre-delivery they
     *         would be able to freeze the builder on day one, wait out {DISPUTE_TIMEOUT}, and
     *         recover the entire escrow while the builder was still performing — a full rug of
     *         work in progress. The builder has no mirror-image incentive: every pre-delivery
     *         stale outcome favours the client, so builder escalation is self-punishing and can
     *         safely remain open (it exists so a builder can put an unresponsive client in
     *         front of an arbitrator and be awarded partial payment for work performed).
     */
    function raiseDispute(uint256 projectId) external onlyParty(projectId) {
        Project storage p = projects[projectId];
        ProjectStatus s = p.status;
        if (s != ProjectStatus.Funded && s != ProjectStatus.InRevision && s != ProjectStatus.Delivered) {
            revert BadState(s);
        }
        if (msg.sender == p.client && s != ProjectStatus.Delivered) revert BadState(s);

        p.preDispute = s;
        p.status = ProjectStatus.Disputed;
        p.stateTimestamp = uint64(block.timestamp);

        emit DisputeRaised(projectId, msg.sender, s, p.stateTimestamp);
    }

    /**
     * @notice PATH 1 — the project's designated arbitrator rules on a dispute.
     * @param projectId  The disputed project.
     * @param builderBps Builder's share in basis points; the remainder refunds the client.
     *                   0 = full refund, {BPS_DENOMINATOR} = full release.
     */
    function resolveDispute(uint256 projectId, uint16 builderBps) external nonReentrant {
        address arb = projectArbitrator[projectId];
        if (arb == address(0)) revert NoArbitratorAssigned();
        if (msg.sender != arb) revert NotArbitrator();

        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Disputed) revert BadState(p.status);
        if (builderBps > BPS_DENOMINATOR) revert BpsTooHigh(BPS_DENOMINATOR);

        _settle(projectId, p, builderBps, msg.sender, 0);
    }

    /**
     * @notice PATH 2 — submit an autonomous resolver's signed ruling. Callable by anyone.
     * @dev    Only for projects that opted out of a designated arbitrator. The transaction may
     *         be relayed by any address, so neither party needs gas to have a ruling enforced.
     *
     *         Replay is structurally impossible rather than nonce-guarded: resolution moves the
     *         project to a terminal status, and no path returns a terminal project to
     *         {ProjectStatus.Disputed}, so a given projectId can be resolved at most once.
     *         `deadline` additionally bounds how long an unsubmitted ruling stays live.
     *
     *         The signature is checked against the resolver key of the project's OWN epoch
     *         (snapshotted at funding), not the currently-live key. A rotation therefore cannot
     *         reach backwards into escrow that was already locked under a previous key.
     *
     * @param projectId  The disputed project.
     * @param builderBps Builder's share in basis points.
     * @param deadline   Unix timestamp after which the attestation is no longer accepted.
     * @param signature  EIP-712 signature by the project's epoch resolver over
     *                   `Resolution(uint256 projectId,uint16 builderBps,uint256 deadline)`.
     */
    function resolveDisputeWithAttestation(
        uint256 projectId,
        uint16 builderBps,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (projectArbitrator[projectId] != address(0)) revert ArbitratorAssigned();
        if (block.timestamp > deadline) revert AttestationExpired(deadline);
        if (builderBps > BPS_DENOMINATOR) revert BpsTooHigh(BPS_DENOMINATOR);

        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Disputed) revert BadState(p.status);

        address signer = resolverAt[p.resolverEpoch];
        if (signer == address(0)) revert ResolverDisabled();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(RESOLUTION_TYPEHASH, projectId, builderBps, deadline))
        );
        if (digest.recover(signature) != signer) revert BadAttestation();

        _settle(projectId, p, builderBps, signer, 1);
    }

    /**
     * @notice PATH 3a — offer the counterparty a split, with no third party involved.
     * @dev    Available at any funded stage INCLUDING {ProjectStatus.Disputed}, so the parties
     *         can always settle a dispute between themselves without waiting on an arbitrator,
     *         a resolver, or the 30-day timeout. A new proposal overwrites any previous one.
     * @param builderBps Builder's share in basis points.
     */
    function proposeSettlement(uint256 projectId, uint16 builderBps) external onlyParty(projectId) {
        Project storage p = projects[projectId];
        if (!_isFundedStatus(p.status)) revert BadState(p.status);
        if (builderBps > BPS_DENOMINATOR) revert BpsTooHigh(BPS_DENOMINATOR);

        settlements[projectId] = Settlement({proposer: msg.sender, builderBps: builderBps});
        emit SettlementProposed(projectId, msg.sender, builderBps);
    }

    /// @notice Retract an outstanding settlement offer.
    function withdrawSettlement(uint256 projectId) external onlyParty(projectId) {
        Settlement memory s = settlements[projectId];
        if (s.proposer == address(0)) revert NoSettlementProposed();
        if (s.proposer != msg.sender) revert NotProposer();

        delete settlements[projectId];
        emit SettlementWithdrawn(projectId, msg.sender);
    }

    /**
     * @notice PATH 3b — counterparty accepts the outstanding offer, executing the 2-of-2 split.
     * @dev    `builderBps` must be restated by the accepter and must match the live proposal.
     *         This prevents a proposer from front-running an acceptance by overwriting their
     *         offer with worse terms in the same block: if the terms changed, the acceptance
     *         reverts rather than binding the accepter to something they did not agree to.
     * @param builderBps The exact share being accepted. Must equal the proposed value.
     */
    function acceptSettlement(uint256 projectId, uint16 builderBps)
        external
        onlyParty(projectId)
        nonReentrant
    {
        Settlement memory s = settlements[projectId];
        if (s.proposer == address(0)) revert NoSettlementProposed();
        if (s.proposer == msg.sender) revert CannotSelfAccept();
        if (s.builderBps != builderBps) revert SettlementMismatch(s.builderBps);

        Project storage p = projects[projectId];
        if (!_isFundedStatus(p.status)) revert BadState(p.status);

        _settle(projectId, p, builderBps, msg.sender, 2);
    }

    /**
     * @notice PATH 4 — the unconditional deadlock breaker. Callable by ANYONE.
     * @dev    This function is the reason no reachable state can hold funds forever. It needs
     *         no arbitrator, no resolver key, no owner and no cooperation from either party;
     *         a disinterested third party or a keeper bot can call it.
     *
     *         Outcome, per protocol specification:
     *           - work HAD been delivered when the dispute was raised
     *             -> split {STALE_DISPUTE_BUILDER_BPS} / remainder (50/50);
     *           - work had NOT been delivered
     *             -> 100% refund to the client.
     *
     *         See {STALE_DISPUTE_BUILDER_BPS} for the incentive this 50/50 rule creates.
     */
    function forceResolveStaleDispute(uint256 projectId) external nonReentrant {
        Project storage p = projects[projectId];
        if (p.status != ProjectStatus.Disputed) revert BadState(p.status);

        uint64 unlockAt = p.stateTimestamp + DISPUTE_TIMEOUT;
        if (block.timestamp < unlockAt) revert DisputeWindowActive(unlockAt);

        uint16 builderBps = p.preDispute == ProjectStatus.Delivered ? STALE_DISPUTE_BUILDER_BPS : 0;
        _settle(projectId, p, builderBps, msg.sender, 3);
    }

    // =====================================================================
    // INTERNAL SETTLEMENT & PAYMENTS
    // =====================================================================

    /**
     * @dev Terminal settlement shared by every resolution path. Effects precede interactions:
     *      status and the settlement slot are written before any value leaves the contract.
     */
    function _settle(
        uint256 projectId,
        Project storage p,
        uint16 builderBps,
        address resolvedBy,
        uint8 resolutionPath
    ) private {
        uint256 total = p.amount;
        uint256 builderShare = (total * builderBps) / BPS_DENOMINATOR;
        uint256 clientShare = total - builderShare;

        p.status = builderShare == 0 ? ProjectStatus.Refunded : ProjectStatus.Completed;
        _clearSettlement(projectId);

        emit DisputeResolved(projectId, builderBps, resolvedBy, resolutionPath);

        if (builderShare != 0) _payBuilder(projectId, p, builderShare);
        if (clientShare != 0) _refundClient(projectId, p, clientShare);
    }

    /// @dev Pays the builder net of the project's snapshotted protocol fee.
    function _payBuilder(uint256 projectId, Project storage p, uint256 gross) private {
        uint256 fee = (gross * p.feeBps) / BPS_DENOMINATOR;
        uint256 net = gross - fee;

        if (fee != 0) _send(feeRecipient, fee);
        _send(p.builder, net);

        emit FundsReleased(projectId, p.builder, net, fee);
    }

    /// @dev Refunds the client. Refunds are never charged a protocol fee.
    function _refundClient(uint256 projectId, Project storage p, uint256 amount) private {
        _send(p.client, amount);
        emit ProjectRefunded(projectId, p.client, amount);
    }

    /**
     * @dev FIX H-3. Gas-capped push with a pull fallback.
     *
     *      v1 used `require(success)` on every payout, so any recipient whose `receive()`
     *      reverted or consumed unbounded gas could permanently brick that project — and
     *      because `.call` forwards all remaining gas, could also burn the caller's budget on
     *      every attempt. Here a failed push is credited to {withdrawable} instead of
     *      reverting, so a hostile or broken recipient inconveniences only themselves and can
     *      never block the counterparty's funds.
     */
    function _send(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount, gas: PAYOUT_GAS_STIPEND}("");
        if (!ok) {
            withdrawable[to] += amount;
            emit PaymentDeferred(to, amount);
        }
    }

    /// @dev Clears any pending offer. No-op when the slot is already empty.
    function _clearSettlement(uint256 projectId) private {
        if (settlements[projectId].proposer != address(0)) delete settlements[projectId];
    }

    /// @dev True for every status in which the contract is holding escrowed value.
    function _isFundedStatus(ProjectStatus s) private pure returns (bool) {
        return s == ProjectStatus.Funded || s == ProjectStatus.InRevision || s == ProjectStatus.Delivered
            || s == ProjectStatus.Disputed;
    }

    // =====================================================================
    // PULL PAYMENTS
    // =====================================================================

    /// @notice Withdraw funds credited by a failed push transfer.
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        withdrawable[msg.sender] = 0; // effect precedes interaction

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    // =====================================================================
    // OWNER GOVERNANCE (no authority over disputes or escrowed funds)
    // =====================================================================

    /**
     * @notice Set the protocol fee for future fundings.
     * @dev    Bounded by the `constant` {MAX_FEE_BPS}, so the ceiling is enforced in bytecode
     *         and cannot be raised by any owner, present or future. Because {fundProject}
     *         snapshots `feeBps` into each project, changes here never affect a project whose
     *         escrow is already locked.
     */
    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert BpsTooHigh(MAX_FEE_BPS);
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /// @notice Update the protocol fee destination.
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /**
     * @notice Halt new projects and new fundings.
     * @dev    Intentionally narrow: `whenNotPaused` guards only {createProject} and
     *         {fundProject}. Every exit — release, claim, cancel, refund, all four resolution
     *         paths, and {withdraw} — stays open while paused, so pausing can never strand
     *         funds that are already escrowed.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume new projects and fundings.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // RESOLVER ROTATION (7-day timelock)
    // ---------------------------------------------------------------------

    /**
     * @notice Announce a rotation of the autonomous resolver signing key.
     * @dev    Step 1 of 2. Emits {ResolverUpdateInitiated} with the earliest application time.
     *         The rotation cannot take effect for {RESOLVER_TIMELOCK}, and even once applied it
     *         binds only projects funded from that point onward — see {resolverEpoch}.
     *         Calling again before applying replaces the pending rotation and restarts the clock.
     * @param newSigner The incoming key. `address(0)` retires the autonomous path entirely,
     *                  leaving arbitrators, mutual settlement and the stale breaker in place.
     */
    function initiateResolverUpdate(address newSigner) external onlyOwner {
        pendingResolverSigner = newSigner;
        uint64 eta = uint64(block.timestamp) + RESOLVER_TIMELOCK;
        resolverUpdateEta = eta;
        emit ResolverUpdateInitiated(newSigner, eta);
    }

    /// @notice Abandon a pending resolver rotation before it takes effect.
    function cancelResolverUpdate() external onlyOwner {
        if (resolverUpdateEta == 0) revert NoPendingResolverUpdate();
        address abandoned = pendingResolverSigner;
        delete pendingResolverSigner;
        delete resolverUpdateEta;
        emit ResolverUpdateCancelled(abandoned);
    }

    /**
     * @notice Apply a rotation whose timelock has elapsed, opening a new resolver epoch.
     * @dev    Step 2 of 2. Projects funded before this call keep their previous epoch's key.
     */
    function applyResolverUpdate() external onlyOwner {
        uint64 eta = resolverUpdateEta;
        if (eta == 0) revert NoPendingResolverUpdate();
        if (block.timestamp < eta) revert ResolverTimelockActive(eta);

        address oldSigner = resolverAt[resolverEpoch];
        address newSigner = pendingResolverSigner;

        uint16 newEpoch;
        unchecked {
            newEpoch = ++resolverEpoch;
        }
        resolverAt[newEpoch] = newSigner;

        delete pendingResolverSigner;
        delete resolverUpdateEta;

        emit ResolverUpdated(newEpoch, oldSigner, newSigner);
    }

    // =====================================================================
    // VIEWS
    // =====================================================================

    /// @notice True while the contract holds escrowed value for this project.
    /// @dev    Replaces v1's stored `isFunded` flag, which duplicated `status` and could desync.
    function isFunded(uint256 projectId) external view returns (bool) {
        return _isFundedStatus(projects[projectId].status);
    }

    /// @notice Timestamp at which the builder may {claimByBuilder}, or 0 if not delivered.
    function claimableAt(uint256 projectId) external view returns (uint64) {
        Project storage p = projects[projectId];
        return p.status == ProjectStatus.Delivered ? p.stateTimestamp + REVIEW_PERIOD : 0;
    }

    /// @notice Timestamp at which {forceResolveStaleDispute} unlocks, or 0 if not disputed.
    function staleResolvableAt(uint256 projectId) external view returns (uint64) {
        Project storage p = projects[projectId];
        return p.status == ProjectStatus.Disputed ? p.stateTimestamp + DISPUTE_TIMEOUT : 0;
    }

    /// @notice The resolver key currently authoritative for NEWLY funded projects.
    /// @dev    To learn which key governs an existing project, read `resolverAt(p.resolverEpoch)`.
    function resolverSigner() external view returns (address) {
        return resolverAt[resolverEpoch];
    }

    /// @notice The resolver key that will settle attestations for an already-funded project.
    function resolverFor(uint256 projectId) external view returns (address) {
        return resolverAt[projects[projectId].resolverEpoch];
    }

    /// @notice The EIP-712 digest a resolver must sign for {resolveDisputeWithAttestation}.
    /// @dev    Exposed so the off-chain resolver and the frontend can verify a ruling before
    ///         submission rather than reconstructing the domain separator independently.
    function resolutionDigest(uint256 projectId, uint16 builderBps, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(RESOLUTION_TYPEHASH, projectId, builderBps, deadline)));
    }

    // No receive() or fallback(): stray native transfers revert rather than becoming
    // unaccounted dust that no function could ever pay out.
}
