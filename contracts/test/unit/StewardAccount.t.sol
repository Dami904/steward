// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StewardAccount} from "../../src/StewardAccount.sol";
import {StewardFactory} from "../../src/StewardFactory.sol";
import {ConductRegistry} from "../../src/ConductRegistry.sol";
import {VaultHealthFeed} from "../../src/VaultHealthFeed.sol";
import {ManagedVaultAdapter} from "../../src/adapters/ManagedVaultAdapter.sol";
import {Types} from "../../src/libraries/Types.sol";
import {IManagedVault} from "../../src/interfaces/IManagedVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockManagedVault} from "../mocks/MockManagedVault.sol";

contract StewardAccountTest is Test {
    MockERC20 usdc;
    MockManagedVault vault;
    ManagedVaultAdapter adapter;
    ConductRegistry registry;
    VaultHealthFeed healthFeed;
    StewardFactory factory;
    StewardAccount account;

    address admin = makeAddr("admin");
    address owner = makeAddr("owner");
    address agentKey = makeAddr("agent");
    address guardian = makeAddr("guardian");
    address stranger = makeAddr("stranger");

    uint128 constant HARD_CAP = 1200e18;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        vault = new MockManagedVault(address(usdc));
        adapter = new ManagedVaultAdapter(address(vault));
        registry = new ConductRegistry(admin);
        healthFeed = new VaultHealthFeed(admin);
        factory = new StewardFactory(address(usdc), address(adapter), address(healthFeed), address(registry));

        vm.prank(admin);
        registry.registerFactory(address(factory));

        Types.Mandate memory mandate = Types.Mandate({
            maxTxUsdc: 1000e18,
            maxBps: 10000,
            maxVaultUsdc: 1200e18,
            minLiquidUsdc: 0,
            maxActionsPerDay: 100,
            expiry: uint40(block.timestamp + 365 days),
            loosenDelay: 1 days,
            issuerHaircutBps: 0,
            latencyHaircutBpsPerDay: 0,
            latencyHaircutMaxBps: 0,
            leadFloorDays: 2,
            approvalAbove: 500e18
        });
        Types.Envelope memory envelope =
            Types.Envelope({capacityCap: 1000e18, capCeiling: 1200e18, reserveUsdc: 0, paused: false});

        vm.prank(owner);
        address acct = factory.createAccount(owner, agentKey, guardian, HARD_CAP, mandate, envelope, 0);
        account = StewardAccount(acct);

        // Fund the account with idle USDC (what an owner would do after creation).
        usdc.mint(address(account), 10000e18);

        // Publish a healthy snapshot so deposits aren't blocked by a default-zero (stale)
        // health feed — this exercises the fail-closed default separately, in its own test.
        vm.prank(admin);
        healthFeed.registerReporter(admin);
        _publishHealthySnapshot();
    }

    function _publishHealthySnapshot() internal {
        vm.prank(admin);
        healthFeed.publish(
            address(vault),
            VaultHealthFeed.HealthSnapshot({
                fromBlock: uint64(block.number),
                toBlock: uint64(block.number),
                ts: uint40(block.timestamp),
                method: Types.METHOD_REQUEST_FINALIZE_VIEW,
                n: 6,
                p50Sec: 3600,
                p90Sec: 7200,
                maxSec: 86400,
                navPerShare: 1e18,
                drawdownBps: 0,
                codehash: bytes32(0),
                flags: 0,
                evidenceHash: bytes32(0)
            })
        );
    }

    // ============================================================
    // Deposit
    // ============================================================

    function test_deposit_happy_path() public {
        // T0's maxTx is 120e18 (spec/tiers.md) — below the mandate's 1000e18 ceiling, so the
        // tier limit binds; deposit up to it, not the larger mandate figure.
        vm.prank(agentKey);
        account.deposit(120e18, 1, bytes32("r1"), 0, "");

        assertEq(account.exposure(), 120e18);
        assertEq(account.totalDeposited(), 120e18);
        assertEq(account.nextSeq(), 2);
        assertEq(vault.balanceOf(address(account)), 120e18);
    }

    function test_deposit_reverts_on_bad_sequence() public {
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.BadSequence.selector);
        account.deposit(200e18, 2, bytes32("r1"), 0, ""); // should be seq 1
    }

    function test_deposit_reverts_when_not_agent() public {
        vm.prank(stranger);
        vm.expectRevert(StewardAccount.NotAgent.selector);
        account.deposit(200e18, 1, bytes32("r1"), 0, "");
    }

    function test_deposit_reverts_when_paused() public {
        vm.prank(owner);
        account.pause(1, bytes32("r1"), 0, "");

        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.Paused.selector);
        account.deposit(200e18, 2, bytes32("r2"), 0, "");
    }

    function test_deposit_reverts_below_vault_minimum() public {
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.BelowVaultMinimum.selector);
        account.deposit(50e18, 1, bytes32("r1"), 0, ""); // vault min is 100e18
    }

    function test_deposit_reverts_over_max_tx() public {
        // T0's tier maxTx is 120e18 (spec/tiers.md), below the mandate's 1000e18 ceiling —
        // the tier limit should bind first.
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.OverMaxTx.selector);
        account.deposit(121e18, 1, bytes32("r1"), 0, "");
    }

    function test_deposit_reverts_over_capacity_from_tier_ceiling() public {
        // T0's tier maxVault is 150e18. Two deposits totalling more than that should the
        // second one revert on capacity, even though maxTx (120e18) allows each individually.
        vm.startPrank(agentKey);
        account.deposit(120e18, 1, bytes32("r1"), 0, "");
        vm.expectRevert(StewardAccount.OverCapacity.selector);
        account.deposit(120e18, 2, bytes32("r2"), 0, "");
        vm.stopPrank();
    }

    function test_deposit_reverts_below_reserve() public {
        vm.prank(owner);
        account.setReserve(9999e18); // reserve larger than the account's idle USDC

        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.BelowReserve.selector);
        account.deposit(120e18, 1, bytes32("r1"), 0, "");
    }

    function test_deposit_reverts_over_hard_cap() public {
        vm.prank(owner);
        account.setCap(HARD_CAP); // remove the tier/envelope ceiling as the binding constraint
        vm.prank(owner);
        account.setMandate(
            Types.Mandate({
                maxTxUsdc: HARD_CAP,
                maxBps: 10000,
                maxVaultUsdc: HARD_CAP,
                minLiquidUsdc: 0,
                maxActionsPerDay: 1000,
                expiry: uint40(block.timestamp + 365 days),
                loosenDelay: 1 days,
                issuerHaircutBps: 0,
                latencyHaircutBpsPerDay: 0,
                latencyHaircutMaxBps: 0,
                leadFloorDays: 2,
                approvalAbove: HARD_CAP
            })
        );
        // Graduate all the way to T3 so tier ceilings don't bind either — deposit/accrue/
        // dwell through each tier using vm.warp, matching the demo time unit.
        _graduateToMax(); // totalDeposited = exposure = 600e18 afterwards

        // hardCap gates lifetime totalDeposited (monotonic), while every other cap gates
        // current exposure (reducible via redemption) and is itself capped by hardCap — so
        // HardCapExceeded can only fire once totalDeposited and exposure have diverged.
        // Redeem the full position first: totalDeposited stays at 600e18, exposure drops to 0.
        uint256 shares = vault.balanceOf(address(account));
        uint64 seq = account.nextSeq();
        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(uint128(shares), seq++, bytes32("full-redeem"), 0, "");
        vault.finalizeRedeem(reqId);
        vm.prank(agentKey);
        account.reconcileRedemption(reqId, seq++, bytes32("full-reconcile"), 0, "");
        assertEq(account.exposure(), 0);
        assertEq(account.totalDeposited(), 600e18);

        usdc.mint(address(account), 10000e18);

        // totalDeposited(600e18) + 700e18 = 1300e18 > hardCap(1200e18), while
        // exposureAfter(0 + 700e18) is comfortably within every exposure-based cap.
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.HardCapExceeded.selector);
        account.deposit(700e18, seq, bytes32("over"), 0, "");
    }

    function test_deposit_fails_closed_when_no_health_snapshot_published() public {
        // Fresh vault/feed pair with nothing published — healthOf() returns the zero-value
        // default snapshot, which HealthMath.deriveHealthCap must treat as stale (ts=0) and
        // return healthCap=0, blocking deposits by default (onchain-access-control check 1).
        MockManagedVault vault2 = new MockManagedVault(address(usdc));
        ManagedVaultAdapter adapter2 = new ManagedVaultAdapter(address(vault2));
        VaultHealthFeed feed2 = new VaultHealthFeed(admin);
        StewardFactory factory2 = new StewardFactory(address(usdc), address(adapter2), address(feed2), address(registry));
        vm.prank(admin);
        registry.registerFactory(address(factory2));

        Types.Mandate memory mandate = Types.Mandate({
            maxTxUsdc: 1000e18,
            maxBps: 10000,
            maxVaultUsdc: 1200e18,
            minLiquidUsdc: 0,
            maxActionsPerDay: 100,
            expiry: uint40(block.timestamp + 365 days),
            loosenDelay: 1 days,
            issuerHaircutBps: 0,
            latencyHaircutBpsPerDay: 0,
            latencyHaircutMaxBps: 0,
            leadFloorDays: 2,
            approvalAbove: 500e18
        });
        Types.Envelope memory envelope =
            Types.Envelope({capacityCap: 1000e18, capCeiling: 1200e18, reserveUsdc: 0, paused: false});
        vm.prank(owner);
        address acct2 = factory2.createAccount(owner, agentKey, guardian, HARD_CAP, mandate, envelope, 0);
        usdc.mint(acct2, 10000e18);

        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.OverCapacity.selector);
        StewardAccount(acct2).deposit(120e18, 1, bytes32("r1"), 0, "");
    }

    // ============================================================
    // requestRedeem / reconcileRedemption
    // ============================================================

    function test_requestRedeem_and_reconcile_happy_path() public {
        vm.prank(agentKey);
        account.deposit(120e18, 1, bytes32("d1"), 0, "");

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(120e18, 2, bytes32("rr1"), 0, "");
        assertEq(account.exposure(), 120e18, "exposure unchanged at request time");

        vault.finalizeRedeem(reqId);

        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");
        assertEq(account.exposure(), 0, "exposure reduced after reconcile");
    }

    function test_reconcileRedemption_reverts_if_not_finalized() public {
        vm.prank(agentKey);
        account.deposit(120e18, 1, bytes32("d1"), 0, "");
        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(120e18, 2, bytes32("rr1"), 0, "");

        // Not finalized yet.
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.RequestNotFinalized.selector);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");
    }

    function test_reconcileRedemption_reverts_on_double_reconcile() public {
        vm.prank(agentKey);
        account.deposit(120e18, 1, bytes32("d1"), 0, "");
        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(120e18, 2, bytes32("rr1"), 0, "");
        vault.finalizeRedeem(reqId);
        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");

        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.RequestAlreadyReconciled.selector);
        account.reconcileRedemption(reqId, 4, bytes32("rc2"), 0, "");
    }

    function test_requestRedeem_allowed_while_paused() public {
        vm.prank(agentKey);
        account.deposit(120e18, 1, bytes32("d1"), 0, "");
        vm.prank(owner);
        account.pause(2, bytes32("p1"), 0, "");

        vm.prank(agentKey);
        account.requestRedeem(120e18, 3, bytes32("rr1"), 0, ""); // must not revert
    }

    // ============================================================
    // Tighten / raise: must revert (not silently no-op) on the wrong direction
    // ============================================================

    function test_tightenCap_reverts_on_raise_attempt() public {
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.NotATighteningMove.selector);
        account.tightenCap(1200e18, 1, bytes32("t1"), 0, ""); // current cap is 1000e18
    }

    function test_tightenCap_succeeds_on_real_tighten() public {
        vm.prank(agentKey);
        account.tightenCap(500e18, 1, bytes32("t1"), 0, "");
        (uint128 cap,,,) = account.envelope();
        assertEq(cap, 500e18);
    }

    function test_raiseReserve_reverts_on_lower_attempt() public {
        vm.prank(owner);
        account.setReserve(100e18);

        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.NotARaisingMove.selector);
        account.raiseReserve(50e18, 1, bytes32("r1"), 0, "");
    }

    function test_raiseReserve_succeeds_on_real_raise() public {
        vm.prank(guardian);
        account.raiseReserve(50e18, 1, bytes32("r1"), 0, "");
        (,, uint128 reserve,) = account.envelope();
        assertEq(reserve, 50e18);
    }

    // ============================================================
    // Pause / incidents
    // ============================================================

    function test_owner_pause_is_an_incident_and_demotes_to_zero() public {
        _graduateToTier1();
        assertEq(_tier(), 1);

        uint64 seq = account.nextSeq();
        vm.prank(owner);
        account.pause(seq, bytes32("p1"), 0, "");

        assertEq(_tier(), 0, "owner pause demotes to T0");
    }

    function test_agent_pause_is_not_an_incident() public {
        _graduateToTier1();
        assertEq(_tier(), 1);

        uint64 seq = account.nextSeq();
        vm.prank(agentKey);
        account.pause(seq, bytes32("p1"), 0, "");

        assertEq(_tier(), 1, "agent pause does not demote");
    }

    function test_guardian_pause_is_not_an_incident() public {
        _graduateToTier1();
        assertEq(_tier(), 1);

        uint64 seq = account.nextSeq();
        vm.prank(guardian);
        account.pause(seq, bytes32("p1"), 0, "");

        assertEq(_tier(), 1, "guardian pause does not demote");
    }

    // ============================================================
    // Loosen propose/cancel/apply
    // ============================================================

    function test_proposeLoosenCap_reverts_above_ceiling() public {
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.LoosenAboveCeiling.selector);
        account.proposeLoosenCap(2000e18, 1, bytes32("l1"), 0, ""); // ceiling is 1200e18
    }

    function test_applyLoosen_reverts_before_delay_elapses() public {
        vm.prank(agentKey);
        account.proposeLoosenCap(1100e18, 1, bytes32("l1"), 0, "");

        vm.expectRevert(StewardAccount.LoosenDelayNotElapsed.selector);
        account.applyLoosen();
    }

    function test_applyLoosen_succeeds_after_delay() public {
        vm.prank(agentKey);
        account.proposeLoosenCap(1100e18, 1, bytes32("l1"), 0, "");

        vm.warp(block.timestamp + 1 days + 1);
        account.applyLoosen();

        (uint128 cap,,,) = account.envelope();
        assertEq(cap, 1100e18);
    }

    function test_cancelLoosen_is_an_incident_and_demotes_one_tier() public {
        _graduateToTier1();
        assertEq(_tier(), 1);

        uint64 seq = account.nextSeq();
        vm.prank(agentKey);
        account.proposeLoosenCap(1100e18, seq, bytes32("l1"), 0, "");

        vm.prank(guardian);
        account.cancelLoosen();

        assertEq(_tier(), 0, "vetoed loosen demotes one tier");
        assertFalse(account.loosenPending());
    }

    // ============================================================
    // Helpers
    // ============================================================

    function _tier() internal view returns (uint8 tier) {
        (tier,,,,,,,,,) = account.tierState();
    }

    /// @dev Deposits, accrues dwell time, and graduates the account from T0 to T1, meeting
    /// every condition in spec/tiers.md section 3 for T0's schedule. Tracks `seq` locally
    /// rather than re-reading account.nextSeq() inline — vm.prank only covers the single
    /// next external call, and an inline account.nextSeq() call (itself a call to
    /// `account`) would consume the prank before the intended call executes.
    function _graduateToTier1() internal {
        uint64 seq = account.nextSeq();
        vm.prank(agentKey);
        account.deposit(120e18, seq++, bytes32("g1"), 0, ""); // peak >= 90e18 required (60% of 150e18)

        for (uint256 i = 0; i < 9; i++) {
            vm.prank(agentKey);
            account.logDecision(seq++, bytes32(abi.encodePacked("g", i)), Types.ALLOW, 0, "");
        } // 10 receipts total (1 deposit + 9 logDecision), meets T0's minReceipts=10

        vm.warp(block.timestamp + 10 * Types.DEMO_TIME_UNIT_SECONDS + 1); // clears minDwell=10 units
        account.graduate();
    }

    function _graduateToMax() internal {
        uint64 seq = account.nextSeq();

        // T0 -> T1
        vm.prank(agentKey);
        account.deposit(120e18, seq++, bytes32("m0"), 0, "");
        for (uint256 i = 0; i < 9; i++) {
            vm.prank(agentKey);
            account.logDecision(seq++, bytes32(abi.encodePacked("m0-", i)), Types.ALLOW, 0, "");
        }
        vm.warp(block.timestamp + 10 * Types.DEMO_TIME_UNIT_SECONDS + 1);
        account.graduate();

        // T1 -> T2: needs peak >= 240e18 (60% of 400e18), 20 receipts, dwell 20 units.
        vm.prank(owner);
        account.setCap(1200e18);
        usdc.mint(address(account), 10000e18);
        vm.prank(agentKey);
        account.deposit(240e18, seq++, bytes32("m1"), 0, "");
        for (uint256 i = 0; i < 19; i++) {
            vm.prank(agentKey);
            account.logDecision(seq++, bytes32(abi.encodePacked("m1-", i)), Types.ALLOW, 0, "");
        }
        vm.warp(block.timestamp + 20 * Types.DEMO_TIME_UNIT_SECONDS + 1);
        account.graduate();

        // T2 -> T3: needs peak >= 480e18 (60% of 800e18); cumulative exposure after this
        // deposit is 360e18 + 240e18 = 600e18, clearing it. 30 receipts, dwell 40 units.
        vm.prank(agentKey);
        account.deposit(240e18, seq++, bytes32("m2"), 0, "");
        for (uint256 i = 0; i < 29; i++) {
            vm.prank(agentKey);
            account.logDecision(seq++, bytes32(abi.encodePacked("m2-", i)), Types.ALLOW, 0, "");
        }
        vm.warp(block.timestamp + 40 * Types.DEMO_TIME_UNIT_SECONDS + 1);
        account.graduate();
    }
}
