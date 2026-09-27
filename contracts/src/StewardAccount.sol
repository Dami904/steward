// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Types} from "./libraries/Types.sol";
import {TierEngine} from "./libraries/TierEngine.sol";
import {PolicyMath} from "./libraries/PolicyMath.sol";
import {HealthMath} from "./libraries/HealthMath.sol";
import {IVaultAdapter} from "./interfaces/IVaultAdapter.sol";
import {IManagedVault} from "./interfaces/IManagedVault.sol";
import {VaultHealthFeed} from "./VaultHealthFeed.sol";
import {ConductRegistry} from "./ConductRegistry.sol";

/// @notice One instance per owner, created by StewardFactory. Holds USDC and vault shares
/// directly. Extended with Earned Authority tiers (spec/tiers.md) and the Health Feed
/// (spec/health.md).
///
/// Phase 2 simplifications from the full plan, documented here rather than silently:
/// - No `claim()` function: Phase 0 found the real vault's redemption is operator-settled
///   with automatic payout to `receiver` on `finalizeRedeem` (an operator-only call this
///   contract cannot make) — there is no separate claim step for the depositor. Use
///   `reconcileRedemption` instead, once a request's status flips to Finalized.
/// - `exposure` tracks deposited-minus-reconciled value directly (assets in, minus the
///   value reconciled out on finalize), not a live NAV-revalued/haircut-adjusted
///   recognised position value. The full spec/accounting.md section 2 formula
///   (recognisedPositionValue with issuer/latency haircuts) is implemented in
///   packages/engine as the off-chain source of truth for capacity math; on-chain, this
///   contract enforces the hard envelope (invariant O-02/O-03) using the simpler figure.
///   Full haircut-aware exposure tracking is a documented gap, not an oversight — see
///   docs/LIMITATIONS.md.
/// - No fee-on-yield module: explicitly cut per the plan's own cut order (cut
///   Phase 6 items, then the fee module, before touching envelope/receipts/tiers/health).
/// - `receiptsSinceEntry` (spec/tiers.md "min receipts") increments on the operational
///   actions — deposit, requestRedeem, reconcileRedemption, logDecision — but not on
///   envelope-control actions (tightenCap, raiseReserve, pause, loosen proposals). Phase 1's
///   off-chain engine defines recordReceipt as a primitive but never built the orchestrator
///   that decides when to call it, so this line is a Solidity-side judgment call, not a
///   spec transcription: receipts should reflect the agent doing its actual job (moving
///   capital, reporting decisions), not adjusting safety levers.
contract StewardAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Actions, canonical order matching Action in packages/engine/src/types.ts ---
    uint8 internal constant ACTION_DEPOSIT = 0;
    uint8 internal constant ACTION_REDEEM = 1;
    uint8 internal constant ACTION_HOLD = 2;

    // --- Immutable roles and wiring ---
    address public immutable owner;
    address public immutable agent;
    address public immutable guardian;
    IERC20 public immutable usdc;
    IVaultAdapter public immutable adapter;
    IERC20 public immutable shareToken;
    VaultHealthFeed public immutable healthFeed;
    ConductRegistry public immutable conductRegistry;
    uint128 public immutable hardCap;

    // --- Mutable state ---
    Types.Mandate public mandate;
    Types.Envelope public envelope;
    Types.TierState public tierState;

    uint64 public nextSeq = 1;
    uint128 public totalDeposited;
    uint128 public exposure;

    uint32 public actionsToday;
    uint40 public actionsDay;

    bool public loosenPending;
    uint128 public pendingLoosenCap;
    uint40 public loosenProposedAt;

    mapping(uint256 => uint128) public exposureAtRequest;
    mapping(uint256 => bool) public requestReconciled;

    // The real vault prices a redemption's payout
    // at LIVE NAV when finalize is called, not the price locked at request time, and stores
    // no on-chain-readable record of the actual amount paid afterward — so reconcileRedemption
    // cannot read a trustworthy "received" figure from the vault directly. Instead it's
    // derived from an exact USDC balance delta around the pending window, which requires
    // serializing redemptions (one pending at a time) to stay attributable to a single
    // request: `pendingRequestId` (0 = none in flight) gates requestRedeem, and every OTHER
    // function that can move this contract's own USDC (deposit, withdraw, claimFees) records
    // its effect into `outflowsWhilePending` so reconcileRedemption can net it back out.
    uint256 public pendingRequestId;
    uint128 public balanceAtRequestTime;
    uint128 public outflowsWhilePending;

    // --- Fee-on-yield. Owner-settable, not a
    // constructor param — see FeeOnYield.t.sol's own header comment for why: joining the
    // same "owner has unilateral, unrestricted power over economic terms" category as
    // setMandate/setCap/setCapCeiling/setReserve, rather than becoming a new differently-
    // gated concept that would ripple through every existing constructor call site.
    address public operator;
    uint16 public feeBps;
    uint16 public maxFeeBps;
    uint128 public costBasis;
    uint128 public accruedFees;
    mapping(uint256 => uint128) public basisOutAtRequest;
    // onchain-access-control skill, check 2 (guard the read-then-settle gap): feeBps is
    // owner-mutable at any time, and a redemption's request-to-reconcile window is real time
    // the owner could use to change it. Snapshotting the rate that was active when the agent
    // actually decided to redeem — not whatever rate happens to be live when reconcile is
    // finally called, possibly much later — means the fee charged matches the terms the
    // decision was made under, not whatever the owner moved them to in between.
    mapping(uint256 => uint16) public feeBpsAtRequest;

    event Decision(
        address indexed actor,
        uint64 indexed seq,
        bytes32 indexed receiptHash,
        uint8 action,
        uint128 amount,
        uint8 verdict,
        uint32 reasonMask,
        bytes policyInput
    );
    event Graduated(uint8 fromTier, uint8 toTier, uint128 riskUnits, uint32 receipts);
    event Demoted(uint8 fromTier, uint8 toTier, uint8 incidentType);
    event LoosenProposed(uint128 newCap, uint40 applicableAt);
    event LoosenCancelled(uint128 vetoedCap);
    event LoosenApplied(uint128 newCap);
    event OperatorChanged(address indexed newOperator);
    event FeeTermsChanged(uint16 newFeeBps, uint16 newMaxFeeBps);
    event FeesAccrued(uint256 indexed requestId, uint128 gain, uint128 fee);
    event FeesClaimed(address indexed operator, uint128 amount);

    error NotOwner();
    error NotAgent();
    error NotGuardian();
    error NotAgentOrGuardian();
    error NotOwnerOrGuardian();
    error NotOwnerAgentOrGuardian();
    error BadSequence();
    error Paused();
    error MandateExpired();
    error OverMaxTx();
    error OverCapacity();
    error BelowReserve();
    error BelowVaultMinimum();
    error RateLimited();
    error HardCapExceeded();
    error NoLoosenPending();
    error LoosenDelayNotElapsed();
    error LoosenAboveCeiling();
    error NotEligibleForGraduation();
    error RequestNotFinalized();
    error RequestAlreadyReconciled();
    error RequestNotRejected();
    error RedemptionAlreadyPending();
    error NotATighteningMove();
    error NotARaisingMove();
    error NotOperator();
    error FeeAboveMax();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier onlyAgentOrGuardian() {
        if (msg.sender != agent && msg.sender != guardian) revert NotAgentOrGuardian();
        _;
    }

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner && msg.sender != guardian) revert NotOwnerOrGuardian();
        _;
    }

    modifier onlyOwnerAgentOrGuardian() {
        if (msg.sender != owner && msg.sender != agent && msg.sender != guardian) {
            revert NotOwnerAgentOrGuardian();
        }
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        address owner_,
        address agent_,
        address guardian_,
        address usdc_,
        address adapter_,
        address healthFeed_,
        address conductRegistry_,
        uint128 hardCap_,
        Types.Mandate memory mandate_,
        Types.Envelope memory envelope_,
        uint8 startTier
    ) {
        require(owner_ != address(0) && agent_ != address(0) && guardian_ != address(0), "StewardAccount: zero role");
        require(startTier < Types.TIER_COUNT, "StewardAccount: bad start tier");
        owner = owner_;
        agent = agent_;
        guardian = guardian_;
        usdc = IERC20(usdc_);
        adapter = IVaultAdapter(adapter_);
        shareToken = IERC20(IVaultAdapter(adapter_).vault());
        healthFeed = VaultHealthFeed(healthFeed_);
        conductRegistry = ConductRegistry(conductRegistry_);
        hardCap = hardCap_;
        mandate = mandate_;
        envelope = envelope_;
        // forge-lint: disable-next-line(unsafe-typecast)
        tierState = Types.TierState(startTier, uint40(block.timestamp), 0, 0, 0, 0, 0, 0, uint40(block.timestamp), 0);
    }

    // ============================================================
    // Agent: deposit
    // ============================================================

    /// @dev spec/accounting.md section 6 DEPOSIT rule + spec/tiers.md section 5 effective
    /// limits. Recomputes every check from on-chain state (onchain-access-control skill,
    /// check 3) — `reasons`/`policyInput` are the off-chain engine's supporting evidence for
    /// the receipt, not trusted inputs to the enforcement decision itself.
    function deposit(uint128 assets, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput)
        external
        nonReentrant
        onlyAgent
    {
        if (seq != nextSeq) revert BadSequence();
        if (envelope.paused) revert Paused();
        // mandate.expiry is a day/hour-scale window; validator timestamp manipulation is
        // immaterial here.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > mandate.expiry) revert MandateExpired();
        if (assets < adapter.minDepositAssets()) revert BelowVaultMinimum();

        Types.TierLimits memory limits = Types.tierLimits(tierState.tier);
        uint128 effMaxTx = _min128(limits.maxTx, mandate.maxTxUsdc);
        if (assets > effMaxTx) revert OverMaxTx();

        _checkAndConsumeRateLimit(_min32(limits.actionsPerDay, mandate.maxActionsPerDay));

        // USDC balances/capacity figures are 18-decimal amounts, nowhere near uint128's
        // range (2^128 ~= 3.4e38) for any realistic vault size.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 treasury = uint128(usdc.balanceOf(address(this))) + exposure;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 capMandate_ = uint128(PolicyMath.capMandate(mandate.maxBps, mandate.maxVaultUsdc, treasury));
        uint128 capTier = limits.maxVault;
        uint128 capHealth = _readHealthCap(capMandate_);
        uint128 effectiveMaxVault = _min128(_min128(capMandate_, capTier), _min128(capHealth, envelope.capacityCap));
        effectiveMaxVault = _min128(effectiveMaxVault, hardCap);

        uint128 exposureAfter = exposure + assets;
        if (exposureAfter > effectiveMaxVault) revert OverCapacity();

        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 liquidAfter = uint128(usdc.balanceOf(address(this))) - assets;
        if (liquidAfter < envelope.reserveUsdc + mandate.minLiquidUsdc) revert BelowReserve();

        if (totalDeposited + assets > hardCap) revert HardCapExceeded();

        usdc.forceApprove(address(adapter), assets);
        // Share count isn't tracked on-chain; sharesOf(this) via the adapter is the source
        // of truth when needed.
        // forge-lint: disable-next-line(unused-return)
        adapter.deposit(assets, address(this));

        totalDeposited += assets;
        exposure = exposureAfter;
        costBasis += assets; // spec: "On deposit: basis += assets."
        // This deposit's assets just left for the vault — if a redemption is mid-flight,
        // reconcileRedemption's balance-delta must not mistake this outflow for part of the
        // redemption's payout. See pendingRequestId's declaration above.
        if (pendingRequestId != 0) outflowsWhilePending += assets;
        // forge-lint: disable-next-line(unsafe-typecast)
        tierState = TierEngine.recordExposure(tierState, uint40(block.timestamp), exposure);
        tierState = TierEngine.recordReceipt(tierState);

        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_DEPOSIT, assets, Types.ALLOW, reasons, policyInput);
    }

    // ============================================================
    // Agent or guardian: requestRedeem (risk-reducing, allowed even paused/expired)
    // ============================================================

    function requestRedeem(uint128 shares, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput)
        external
        nonReentrant
        onlyAgentOrGuardian
        returns (uint256 requestId)
    {
        if (seq != nextSeq) revert BadSequence();
        if (pendingRequestId != 0) revert RedemptionAlreadyPending();

        Types.TierLimits memory limits = Types.tierLimits(tierState.tier);
        _checkAndConsumeRateLimit(_min32(limits.actionsPerDay, mandate.maxActionsPerDay));

        // Asset amounts are 18-decimal, nowhere near uint128's range for any realistic vault size.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 previewAssets = uint128(adapter.previewRedeemAssets(shares));
        if (previewAssets < adapter.minRedeemAssets()) revert BelowVaultMinimum();

        // Spec: "On redeem request of s shares: basisOut = floor(basis
        // * s / shares), decrement both." Read BEFORE adapter.requestRedeem below, which
        // transfers these shares out and reduces this contract's own balance.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 sharesBefore = uint128(shareToken.balanceOf(address(this)));
        // Safe: shares <= sharesBefore always (can't redeem more shares than held, enforced
        // by shareToken's own transfer below reverting otherwise), so this ratio is <= 1 and
        // the result can never exceed costBasis, itself already uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 basisOut = sharesBefore > 0 ? uint128((uint256(costBasis) * shares) / sharesBefore) : 0;
        costBasis = costBasis > basisOut ? costBasis - basisOut : 0;

        shareToken.forceApprove(address(adapter), shares);
        requestId = adapter.requestRedeem(shares, address(this));

        exposureAtRequest[requestId] = previewAssets;
        basisOutAtRequest[requestId] = basisOut;
        feeBpsAtRequest[requestId] = feeBps;
        pendingRequestId = requestId;
        // forge-lint: disable-next-line(unsafe-typecast)
        balanceAtRequestTime = uint128(usdc.balanceOf(address(this)));
        outflowsWhilePending = 0;
        tierState = TierEngine.recordReceipt(tierState);

        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_REDEEM, shares, Types.ALLOW, reasons, policyInput);
    }

    // ============================================================
    // Agent or guardian: reconcile a finalized redemption (see contract-level note on why
    // there is no claim() — the real vault pays out automatically on operator finalize)
    // ============================================================

    function reconcileRedemption(uint256 requestId, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput)
        external
        nonReentrant
        onlyAgentOrGuardian
    {
        if (seq != nextSeq) revert BadSequence();
        if (requestReconciled[requestId]) revert RequestAlreadyReconciled();

        // onchain-access-control skill, check 3: recompute the verdict from the vault's own
        // state, don't trust the caller's claim that this request is finalized. Only
        // `status` of the tuple is needed here.
        // forge-lint: disable-next-line(unused-return)
        (,,,,,,, IManagedVault.RequestStatus status) = IManagedVault(adapter.vault()).redeemRequests(requestId);
        if (status != IManagedVault.RequestStatus.Finalized) revert RequestNotFinalized();

        // The real vault prices this payout at LIVE
        // NAV when finalize was called, not the `exposureAtRequest` preview locked in here at
        // request time — confirmed against the real vault's actual verified source, not
        // assumed. It also stores no on-chain-readable record of the amount actually paid, so
        // the true received amount is derived from an exact USDC balance delta instead:
        // starting balance (snapshotted at request time) plus everything ELSE that moved this
        // contract's own USDC since then (deposit/withdraw/claimFees, tracked into
        // outflowsWhilePending as they happen) accounts for every non-redemption change, so
        // whatever's left over is exactly what the vault paid for this one request — valid
        // because requestRedeem's pendingRequestId guard keeps only one redemption
        // attributable to this balance at a time.
        // grossReceipts = "current balance, plus everything that left for a non-redemption
        // reason" = what the balance would be if none of those outflows had happened. That,
        // minus the balance at request time, isolates exactly what the redemption itself
        // added — computed as one addition and one safely-clamped subtraction so there's no
        // intermediate that could underflow (e.g. when outflows exceed the eventual payout).
        uint256 grossReceipts = usdc.balanceOf(address(this)) + outflowsWhilePending;
        // Safe: the ternary only casts when grossReceipts > balanceAtRequestTime, so the
        // subtracted value is always positive and, in USDC's realistic 18-decimal range for
        // any account this system would ever hold, nowhere near uint128's ceiling.
        uint128 reconciledAmount = grossReceipts > balanceAtRequestTime
            // forge-lint: disable-next-line(unsafe-typecast)
            ? uint128(grossReceipts - balanceAtRequestTime)
            : 0;
        requestReconciled[requestId] = true;
        pendingRequestId = 0;
        exposure = reconciledAmount > exposure ? 0 : exposure - reconciledAmount;

        // Spec: "On claim with received assets: gain = max(0, received
        // - basisOut), fee = floor(gain * feeBps / 10000), accrued to operator." `feeBps` is
        // read from the SNAPSHOT taken at request time (onchain-access-control skill, check
        // 2), not whatever feeBps is live now — the owner is free to change fee terms going
        // forward, but not retroactively, on a redemption an agent already decided to make
        // under the old terms.
        uint128 gain = reconciledAmount > basisOutAtRequest[requestId] ? reconciledAmount - basisOutAtRequest[requestId] : 0;
        // Safe: feeBpsAtRequest[requestId] <= PolicyMath.BPS was enforced by setFeeBps at the
        // time it was snapshotted, so this ratio is <= 1 and the result can never exceed
        // gain, itself already uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 fee = uint128((uint256(gain) * feeBpsAtRequest[requestId]) / 10000);
        accruedFees += fee;
        emit FeesAccrued(requestId, gain, fee);

        tierState = TierEngine.recordReceipt(tierState);

        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_HOLD, reconciledAmount, Types.ALLOW, reasons, policyInput);
    }

    // ============================================================
    // Agent or guardian: settle a rejected redemption. requestRedeem debits costBasis
    // unconditionally at request time (before the redemption is known to succeed), and
    // reconcileRedemption only ever handles the Finalized outcome — without this path, a
    // Rejected request's debited costBasis would be gone forever, overstating `gain` (and
    // therefore the fee) on every later real redemption. reliability-auditor finding,

    // ============================================================

    function settleRejectedRedeem(uint256 requestId, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput)
        external
        nonReentrant
        onlyAgentOrGuardian
    {
        if (seq != nextSeq) revert BadSequence();
        if (requestReconciled[requestId]) revert RequestAlreadyReconciled();

        // onchain-access-control skill, check 3: recompute from the vault's own state, don't
        // trust a caller-supplied claim that this request was rejected.
        // forge-lint: disable-next-line(unused-return)
        (,,,,,,, IManagedVault.RequestStatus status) = IManagedVault(adapter.vault()).redeemRequests(requestId);
        if (status != IManagedVault.RequestStatus.Rejected) revert RequestNotRejected();

        requestReconciled[requestId] = true;
        pendingRequestId = 0;
        // Safe: basisOutAtRequest[requestId] was subtracted from costBasis (itself uint128)
        // at request time without underflowing, so adding it back can never overflow either.
        costBasis += basisOutAtRequest[requestId];
        // Returned share amount not needed here — the adapter forwards it to this contract's
        // own balance directly; recoverRejectedShares reverts if anything about the request
        // is wrong, so a swallowed return value here can't hide a silent failure.
        // forge-lint: disable-next-line(unused-return)
        adapter.recoverRejectedShares(requestId);

        tierState = TierEngine.recordReceipt(tierState);

        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_HOLD, 0, Types.ALLOW, reasons, policyInput);
    }

    // ============================================================
    // Always allowed, always logged
    // ============================================================

    function logDecision(uint64 seq, bytes32 receiptHash, uint8 verdict, uint32 reasons, bytes calldata policyInput)
        external
        onlyAgentOrGuardian
    {
        if (seq != nextSeq) revert BadSequence();
        tierState = TierEngine.recordReceipt(tierState);
        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_HOLD, 0, verdict, reasons, policyInput);
    }

    // ============================================================
    // Tightening: immediate, agent/guardian/owner. Asymmetric authority.
    // ============================================================

    /// @dev Reverts (does not silently no-op) if `newCap` isn't actually a tightening move —
    /// a silent no-op here would still emit a Decision event claiming success, misleading
    /// anyone replaying the receipt log about what the on-chain state actually did. Owner
    /// has the unrestricted `setCap` for raising the cap; this function is tighten-only for
    /// every caller, owner included.
    function tightenCap(uint128 newCap, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput)
        external
        onlyOwnerAgentOrGuardian
    {
        if (seq != nextSeq) revert BadSequence();
        if (newCap >= envelope.capacityCap) revert NotATighteningMove();
        envelope.capacityCap = newCap;
        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_HOLD, newCap, Types.ALLOW, reasons, policyInput);
    }

    /// @dev Same reasoning as tightenCap: reverts rather than silently no-opping on the
    /// wrong direction. Owner has the unrestricted `setReserve`.
    function raiseReserve(uint128 newReserve, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput)
        external
        onlyOwnerAgentOrGuardian
    {
        if (seq != nextSeq) revert BadSequence();
        if (newReserve <= envelope.reserveUsdc) revert NotARaisingMove();
        envelope.reserveUsdc = newReserve;
        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_HOLD, newReserve, Types.ALLOW, reasons, policyInput);
    }

    /// @dev Owner pausing is an incident (OWNER_PAUSE, spec/tiers.md section 4) and demotes
    /// to T0. Agent/guardian pausing is the system working defensively, not punished.
    function pause(uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput)
        external
        nonReentrant
        onlyOwnerAgentOrGuardian
    {
        if (seq != nextSeq) revert BadSequence();
        envelope.paused = true;
        if (msg.sender == owner) {
            _applyIncidentAndReport(TierEngine.INCIDENT_OWNER_PAUSE);
        }
        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_HOLD, 0, Types.ALLOW, reasons, policyInput);
    }

    function unpause() external onlyOwner {
        envelope.paused = false;
    }

    // ============================================================
    // Loosening: agent-proposed with a veto window, or owner-immediate.
    // ============================================================

    function proposeLoosenCap(uint128 newCap, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput)
        external
        onlyAgent
    {
        if (seq != nextSeq) revert BadSequence();
        if (newCap > envelope.capCeiling) revert LoosenAboveCeiling();
        pendingLoosenCap = newCap;
        // forge-lint: disable-next-line(unsafe-typecast)
        loosenProposedAt = uint40(block.timestamp);
        loosenPending = true;
        nextSeq += 1;
        emit Decision(msg.sender, seq, receiptHash, ACTION_HOLD, newCap, Types.ALLOW, reasons, policyInput);
        emit LoosenProposed(newCap, loosenProposedAt + mandate.loosenDelay);
    }

    /// @dev Vetoing an agent's loosen proposal is itself an incident (LOOSEN_VETOED,
    /// spec/tiers.md section 4) — demotes one tier.
    function cancelLoosen() external nonReentrant onlyOwnerOrGuardian {
        if (!loosenPending) revert NoLoosenPending();
        uint128 vetoed = pendingLoosenCap;
        loosenPending = false;
        pendingLoosenCap = 0;
        _applyIncidentAndReport(TierEngine.INCIDENT_LOOSEN_VETOED);
        emit LoosenCancelled(vetoed);
    }

    function applyLoosen() external {
        if (!loosenPending) revert NoLoosenPending();
        // loosenDelay is a day-scale window (validator timestamp manipulation is
        // immaterial) and the uint40 cast is safe until year 36812.
        // forge-lint: disable-next-line(block-timestamp,unsafe-typecast)
        if (uint40(block.timestamp) < loosenProposedAt + mandate.loosenDelay) revert LoosenDelayNotElapsed();
        envelope.capacityCap = pendingLoosenCap;
        loosenPending = false;
        emit LoosenApplied(pendingLoosenCap);
    }

    // ============================================================
    // Earned Authority: graduation. Anyone may call. spec/tiers.md section 3.
    // ============================================================

    function graduate() external nonReentrant {
        // Accrue risk into storage *before* checking eligibility, so the riskUnits this
        // function later reports (event + ConductRegistry) reflects the same freshly-accrued
        // figure checkPromotion uses to decide eligibility — not a stale pre-accrual value
        // that could understate it, even fall below the threshold that was just verified.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint40 nowTs = uint40(block.timestamp);
        tierState = TierEngine.accrueRisk(tierState, nowTs);

        uint16 failedMask = TierEngine.checkPromotion(
            tierState,
            nowTs,
            Types.DEMO_TIME_UNIT_SECONDS,
            envelope.paused,
            // mandate.expiry is a day/hour-scale window; validator timestamp manipulation
            // is immaterial here.
            // forge-lint: disable-next-line(block-timestamp)
            block.timestamp > mandate.expiry,
            false // evidenceStale: Phase 3 (SERV evidence layer) not wired in yet
        );
        if (failedMask != 0) revert NotEligibleForGraduation();

        uint8 fromTier = tierState.tier;
        uint128 riskUnitsAtGraduation = tierState.riskAcc / Types.DEMO_TIME_UNIT_SECONDS;
        uint32 receiptsAtGraduation = tierState.receiptsSinceEntry;
        tierState = TierEngine.graduate(tierState, nowTs);

        emit Graduated(fromTier, tierState.tier, riskUnitsAtGraduation, receiptsAtGraduation);
        conductRegistry.report(agent, owner, tierState.tier, riskUnitsAtGraduation, false);
    }

    // ============================================================
    // Owner only
    // ============================================================

    function setMandate(Types.Mandate calldata m) external onlyOwner {
        mandate = m;
    }

    function setCapCeiling(uint128 c) external onlyOwner {
        envelope.capCeiling = c;
    }

    function setCap(uint128 c) external onlyOwner {
        envelope.capacityCap = c;
    }

    function setReserve(uint128 r) external onlyOwner {
        envelope.reserveUsdc = r;
    }

    function withdraw(address to, uint128 amount) external onlyOwner {
        usdc.safeTransfer(to, amount);
        // Same reasoning as deposit(): net this outflow out of any in-flight redemption's
        // balance-delta accounting.
        if (pendingRequestId != 0) outflowsWhilePending += amount;
    }

    // ============================================================
    // Fee-on-yield. Owner configures; operator claims.
    // ============================================================

    // address(0) is a deliberate, reachable value here (unlike owner/agent/guardian, which
    // the constructor requires non-zero) — it's how an owner disables fee claiming
    // (claimFees()'s onlyOperator modifier can never match msg.sender == address(0)), not an
    // input to reject.
    // forge-lint: disable-next-line(missing-zero-check)
    function setOperator(address newOperator) external onlyOwner {
        operator = newOperator;
        emit OperatorChanged(newOperator);
    }

    /// @dev Both set together, not two separate setters: O-09 requires feeBps never exceed
    /// maxFeeBps at any point in time, not just "eventually" — a two-step raise (maxFeeBps
    /// first, feeBps second) would pass through a legal-but-momentarily-confusing
    /// intermediate state for no benefit, so this just requires the caller supply a
    /// consistent pair in one call.
    function setFeeBps(uint16 newFeeBps, uint16 newMaxFeeBps) external onlyOwner {
        // The second bound (both <= 100%) is the one that actually protects O-09's "no path
        // to principal": claimFees() sweeps the account's general USDC balance (no separate
        // yield-only bucket), so a feeBps above 10_000 would let `fee = gain * feeBps /
        // 10_000` exceed `gain` itself — the formula alone doesn't stop that, this bound
        // does. Caught by the compiler's own unsafe-typecast warning on the fee calculation
        // below, not by inspection: reasoning through why the cast was actually safe
        // surfaced that it wasn't, without this check.
        if (newFeeBps > newMaxFeeBps) revert FeeAboveMax();
        if (newMaxFeeBps > PolicyMath.BPS) revert FeeAboveMax();
        feeBps = newFeeBps;
        maxFeeBps = newMaxFeeBps;
        emit FeeTermsChanged(newFeeBps, newMaxFeeBps);
    }

    /// @dev Transfers exactly `accruedFees`, which is only ever incremented by the
    /// gain*feeBps/10000 formula in reconcileRedemption below — never derived from
    /// `costBasis` or a raw balance read. This is the concrete mechanism behind O-09's "no
    /// path to principal": there is no code path from this function to anything but the
    /// accrued-fees ledger.
    function claimFees() external nonReentrant onlyOperator {
        uint128 amount = accruedFees;
        accruedFees = 0;
        usdc.safeTransfer(operator, amount);
        emit FeesClaimed(operator, amount);
        // Same reasoning as deposit()/withdraw(): net this outflow out of any in-flight
        // redemption's balance-delta accounting.
        if (pendingRequestId != 0) outflowsWhilePending += amount;
    }

    // ============================================================
    // Internal
    // ============================================================

    function _applyIncidentAndReport(uint8 incidentType) internal {
        uint8 fromTier = tierState.tier;
        // forge-lint: disable-next-line(unsafe-typecast)
        tierState = TierEngine.applyIncident(tierState, incidentType, uint40(block.timestamp));
        emit Demoted(fromTier, tierState.tier, incidentType);
        conductRegistry.report(agent, owner, tierState.tier, 0, true);
    }

    function _checkAndConsumeRateLimit(uint32 maxPerDay) internal {
        // Days-since-epoch fits uint40 until well past this contract's realistic lifetime.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint40 today = uint40(block.timestamp / 1 days);
        if (today != actionsDay) {
            actionsDay = today;
            actionsToday = 0;
        }
        if (actionsToday >= maxPerDay) revert RateLimited();
        actionsToday += 1;
    }

    function _readHealthCap(uint128 capMandate_) internal view returns (uint128) {
        // forge-lint: disable-next-line(unused-return) -- the snapshot id isn't needed here.
        (VaultHealthFeed.HealthSnapshot memory snapshot,) = healthFeed.healthOf(adapter.vault());
        return HealthMath.deriveHealthCap(
            snapshot,
            // forge-lint: disable-next-line(unsafe-typecast)
            uint40(block.timestamp),
            2 days, // maxStaleSec, matches the real vault's own navStalenessThreshold (Phase 0)
            uint32(mandate.leadFloorDays) * 1 days,
            5000, // drawdownPauseThresholdBps: 50%, matches the vault's own maxNavChangeBps (Phase 0)
            capMandate_
        );
    }

    function _min128(uint128 a, uint128 b) internal pure returns (uint128) {
        return a < b ? a : b;
    }

    function _min32(uint32 a, uint32 b) internal pure returns (uint32) {
        return a < b ? a : b;
    }
}
