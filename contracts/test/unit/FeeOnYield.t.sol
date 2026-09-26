// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StewardAccount} from "../../src/StewardAccount.sol";
import {StewardFactory} from "../../src/StewardFactory.sol";
import {ConductRegistry} from "../../src/ConductRegistry.sol";
import {VaultHealthFeed} from "../../src/VaultHealthFeed.sol";
import {ManagedVaultAdapter} from "../../src/adapters/ManagedVaultAdapter.sol";
import {Types} from "../../src/libraries/Types.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockManagedVault} from "../mocks/MockManagedVault.sol";

/// @notice serv PLAN_v2.md section 7.6 (Phase 6, spec written in Phase 1, implemented here):
/// "Track costBasis and shares. On deposit: basis += assets. On redeem request of s shares:
/// basisOut = floor(basis * s / shares), decrement both, rounded in the owner's favor. On
/// claim with received assets: gain = max(0, received - basisOut), fee = floor(gain * feeBps
/// / 10000), accrued to operator, never above maxFeeBps. The operator can only claimFees()
/// for accrued amounts. There is no path to principal (O-09)."
///
/// Deliberately NOT added to StewardAccount's constructor/StewardFactory.createAccount — all
/// 8 existing call sites (contracts scripts/tests, scripts/demo-driver.ts) would need updating
/// for a feature this project's own plan explicitly marks "reach, first to cut." Owner-settable
/// post-deployment instead (setOperator/setFeeBps), consistent with this contract's existing
/// trust model: owner already has unrestricted power over the mandate/envelope/cap (setMandate,
/// setCap, setCapCeiling, setReserve are all owner-unilateral); fee terms join that same
/// category rather than becoming a new, differently-gated concept. O-09 is a claim about the
/// RUNTIME relationship between accrued fees and realised gains, not about defending against a
/// malicious owner — that's already explicitly out of scope (docs/THREAT_MODEL.md: "owner key
/// theft: full control").
contract FeeOnYieldTest is Test {
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
    address operator = makeAddr("operator");
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

        usdc.mint(address(account), 10000e18);

        vm.prank(admin);
        healthFeed.registerReporter(admin);
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
    // Configuration
    // ============================================================

    function test_setFeeBps_reverts_if_above_maxFeeBps() public {
        vm.prank(owner);
        vm.expectRevert(StewardAccount.FeeAboveMax.selector);
        account.setFeeBps(2000, 1000); // feeBps > maxFeeBps
    }

    function test_setFeeBps_reverts_when_not_owner() public {
        vm.prank(stranger);
        vm.expectRevert(StewardAccount.NotOwner.selector);
        account.setFeeBps(1000, 2000);
    }

    function test_setOperator_reverts_when_not_owner() public {
        vm.prank(stranger);
        vm.expectRevert(StewardAccount.NotOwner.selector);
        account.setOperator(operator);
    }

    // ============================================================
    // Core mechanics: gain -> fee, loss -> no fee, principal untouched
    // ============================================================

    function test_deposit_increases_costBasis() public {
        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");
        assertEq(account.costBasis(), 100e18);
    }

    function test_redeem_with_gain_accrues_fee_exactly_per_spec() public {
        vm.prank(owner);
        account.setOperator(operator);
        vm.prank(owner);
        account.setFeeBps(1000, 2000); // 10% fee, 20% ceiling

        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");
        assertEq(account.costBasis(), 100e18, "basis after deposit");

        // Simulate 20% NAV appreciation between deposit and redemption — the vault must
        // actually hold the extra assets to pay out, same as real yield would show up as
        // the vault's own balance growing.
        vault.setNavPerShare(1.2e18);
        usdc.mint(address(vault), 20e18);

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        // Redeeming ALL shares -> ALL cost basis comes out with this one request.
        assertEq(account.costBasis(), 0, "basis fully consumed by the only redemption");
        assertEq(account.basisOutAtRequest(reqId), 100e18);

        vault.finalizeRedeem(reqId);

        uint128 operatorBalanceBefore = uint128(usdc.balanceOf(operator));
        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");

        // received = 120e18 (100e18 shares * 1.2e18 NAV), basisOut = 100e18 -> gain = 20e18
        // fee = floor(20e18 * 1000 / 10000) = 2e18 — the exact spec formula, not an
        // approximation.
        assertEq(account.accruedFees(), 2e18, "fee = floor(gain * feeBps / 10000)");

        vm.prank(operator);
        account.claimFees();
        assertEq(account.accruedFees(), 0, "accrued resets after claim");
        assertEq(usdc.balanceOf(operator) - operatorBalanceBefore, 2e18, "operator receives exactly the accrued fee");
    }

    function test_redeem_with_loss_accrues_zero_fee_not_negative() public {
        vm.prank(owner);
        account.setOperator(operator);
        vm.prank(owner);
        account.setFeeBps(1000, 2000);

        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");

        // NAV drops 20% — a real loss, not a gain. Vault already holds enough to pay the
        // reduced amount (it's less than what came in), no extra minting needed. The 20%-
        // reduced payout (80e18) would fall below the vault's own 100e18 minRedeemAssets_
        // floor, so lower it for this scenario — a real constraint the mock's own
        // requestRedeem enforces, caught by actually running this test, not assumed away.
        vault.setNavPerShare(0.8e18);
        vault.setMinRedeemAssets(50e18);

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        vault.finalizeRedeem(reqId);

        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");

        // received = 80e18, basisOut = 100e18 -> gain would be negative, must floor at 0,
        // never charge a fee on a loss.
        assertEq(account.accruedFees(), 0, "no fee on a loss");
    }

    function test_claimFees_reverts_when_not_operator() public {
        vm.prank(owner);
        account.setOperator(operator);

        vm.prank(stranger);
        vm.expectRevert(StewardAccount.NotOperator.selector);
        account.claimFees();
    }

    /// @dev The invariant this test exists to guard: claimFees() can only ever move
    /// `accruedFees` (itself only ever incremented by the gain*feeBps formula in
    /// reconcileRedemption) — never `costBasis`, never a raw balance sweep. Confirms this by
    /// checking the account's own USDC balance drop equals exactly the claimed fee, not more.
    function test_claimFees_never_touches_more_than_accrued() public {
        vm.prank(owner);
        account.setOperator(operator);
        vm.prank(owner);
        account.setFeeBps(1000, 2000);

        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");
        vault.setNavPerShare(1.5e18);
        usdc.mint(address(vault), 50e18);

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        vault.finalizeRedeem(reqId);
        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");

        uint128 accrued = account.accruedFees();
        assertEq(accrued, 5e18, "fee = floor(50e18 gain * 1000 / 10000)");

        uint256 accountBalanceBefore = usdc.balanceOf(address(account));
        vm.prank(operator);
        account.claimFees();
        assertEq(accountBalanceBefore - usdc.balanceOf(address(account)), accrued, "account balance drops by exactly the accrued fee, nothing more");
    }

    // ============================================================
    // onchain-access-control skill, check 2 (guard the read-then-settle gap): a redemption's
    // request-to-reconcile window is real elapsed time the owner could use to change fee
    // terms. The fee charged must match what was active when the agent actually decided to
    // redeem, not whatever the owner moved feeBps to in between.
    // ============================================================

    function test_feeBps_change_after_request_does_not_affect_that_redemption() public {
        vm.prank(owner);
        account.setOperator(operator);
        vm.prank(owner);
        account.setFeeBps(1000, 2000); // 10% at request time

        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");
        vault.setNavPerShare(1.2e18);
        usdc.mint(address(vault), 20e18);

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        assertEq(account.feeBpsAtRequest(reqId), 1000, "snapshotted at request time");

        // Owner raises the fee AFTER the agent already decided to redeem under the old rate.
        vm.prank(owner);
        account.setFeeBps(2000, 2000); // now 20%

        vault.finalizeRedeem(reqId);
        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");

        // Must charge the 10% that was active at request time, not the 20% live at reconcile
        // — if this reads the live feeBps instead of the snapshot, it would be 4e18, not 2e18.
        assertEq(account.accruedFees(), 2e18, "charged the rate from request time, not reconcile time");
    }

    function test_feeBps_lowered_after_request_does_not_retroactively_help_that_redemption_either() public {
        vm.prank(owner);
        account.setOperator(operator);
        vm.prank(owner);
        account.setFeeBps(2000, 2000); // 20% at request time

        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");
        vault.setNavPerShare(1.2e18);
        usdc.mint(address(vault), 20e18);

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");

        vm.prank(owner);
        account.setFeeBps(0, 2000); // owner drops the live rate to 0% after the request

        vault.finalizeRedeem(reqId);
        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");

        // Still the 20% snapshotted at request time (4e18), not the live 0% — the snapshot
        // is symmetric: it protects against the rate moving in EITHER direction after the
        // fact, not just against increases.
        assertEq(account.accruedFees(), 4e18, "snapshot applies regardless of which direction the live rate later moved");
    }

    // ============================================================
    // Rejected redemptions: reliability-auditor finding, spec/DECISIONS.md "Phase 6, second
    // item" review-gate FAIL. requestRedeem unconditionally debits costBasis before the
    // redemption is known to succeed; reconcileRedemption only ever handles the Finalized
    // outcome. Without a path for Rejected, that debited costBasis is gone forever, and any
    // later genuine redemption's `gain` calc is overstated by exactly the erased basis — a
    // direct O-09 violation (fee ends up charged against returned principal, not real yield).
    // Separately, the real vault (mirrored by MockManagedVault.rejectRedeem) mints the
    // rejected shares back to the request's `owner`, which from the vault's point of view is
    // whichever contract called its requestRedeem — that's ManagedVaultAdapter, not
    // StewardAccount, since StewardAccount only ever calls the vault through the adapter. The
    // adapter had no function to forward those shares back out, so they'd be stuck forever.
    // ============================================================

    function test_reconcileRedemption_reverts_on_rejected_request() public {
        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        vault.rejectRedeem(reqId);

        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.RequestNotFinalized.selector);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");
    }

    function test_settleRejectedRedeem_restores_costBasis() public {
        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");
        assertEq(account.costBasis(), 100e18);

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        assertEq(account.costBasis(), 0, "debited at request time");

        vault.rejectRedeem(reqId);

        vm.prank(agentKey);
        account.settleRejectedRedeem(reqId, 3, bytes32("sr1"), 0, "");
        assertEq(account.costBasis(), 100e18, "restored after a rejected request is settled");
    }

    function test_settleRejectedRedeem_returns_shares_to_account() public {
        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        vault.rejectRedeem(reqId);

        vm.prank(agentKey);
        account.settleRejectedRedeem(reqId, 3, bytes32("sr1"), 0, "");
        assertEq(vault.balanceOf(address(account)), 100e18, "shares recovered from the adapter back to the account");
        assertEq(vault.balanceOf(address(adapter)), 0, "nothing left stuck in the adapter");
    }

    function test_settleRejectedRedeem_reverts_if_not_rejected() public {
        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");
        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        // Still Pending — never rejected or finalized.

        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.RequestNotRejected.selector);
        account.settleRejectedRedeem(reqId, 3, bytes32("sr1"), 0, "");
    }

    function test_settleRejectedRedeem_reverts_on_double_settle() public {
        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");
        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        vault.rejectRedeem(reqId);

        vm.prank(agentKey);
        account.settleRejectedRedeem(reqId, 3, bytes32("sr1"), 0, "");

        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.RequestAlreadyReconciled.selector);
        account.settleRejectedRedeem(reqId, 4, bytes32("sr2"), 0, "");
    }

    // ============================================================
    // The real vault's finalizeRedeem prices at LIVE NAV, not the request-time preview —
    // confirmed 2026-09-23 by reading the actual verified source
    // (github.com/IXS-Finance/vault-contracts/blob/main/contracts/ManagedVault.sol, per
    // spec/DECISIONS.md "Phase 6, fourth item"). MockManagedVault.finalizeRedeem is corrected
    // to match. reconcileRedemption previously trusted `exposureAtRequest[requestId]` (the
    // STALE request-time preview) as "received" — wrong whenever NAV moves in the real,
    // multi-day window between request and finalize (Phase 0 measured up to ~12.7 days). The
    // real vault stores no on-chain-readable settled amount, so the fix derives the true
    // received amount from an exact USDC balance delta, which requires serializing
    // redemptions (one pending at a time) to stay attributable to a single request.
    // ============================================================

    function test_reconcileRedemption_uses_actual_received_amount_not_stale_preview() public {
        vm.prank(owner);
        account.setOperator(operator);
        vm.prank(owner);
        account.setFeeBps(1000, 2000); // 10%

        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");

        // NAV is 1.0x at request time -> the STALE preview would say "no gain."
        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        assertEq(account.exposureAtRequest(reqId), 100e18, "preview locked in at 1.0x, before the real move");

        // NAV genuinely rises to 1.3x DURING the real, multi-day request-to-finalize window —
        // the real vault (per its actual source) prices the payout at THIS live rate, not the
        // 1.0x that was true when the agent decided to redeem.
        vault.setNavPerShare(1.3e18);
        usdc.mint(address(vault), 30e18);
        vault.finalizeRedeem(reqId);

        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 3, bytes32("rc1"), 0, "");

        // Real received = 130e18, real basisOut = 100e18 -> real gain = 30e18, fee = 3e18.
        // The old, stale-preview logic would have computed gain = 100e18 (preview) - 100e18
        // (basisOut) = 0, fee = 0 — silently losing the operator's entire entitled fee on
        // every redemption where NAV moves favorably between request and finalize.
        assertEq(account.accruedFees(), 3e18, "fee reflects the REAL payout, not the stale preview");
    }

    function test_requestRedeem_reverts_while_a_redemption_is_already_pending() public {
        // T0's own maxVault tier ceiling (150e18, Types.tierLimits) is smaller than
        // mandate.maxVaultUsdc here, so a single 100e18 deposit + full-balance redeem keeps
        // every other cap out of the way — this test is about the new pending-request guard,
        // not tier/capacity edges.
        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");

        vm.prank(agentKey);
        account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        // Never finalized/rejected -> still pending.

        // The guard fires before any share-balance check, so the exact amount here doesn't
        // matter — even though no shares remain, RedemptionAlreadyPending must fire first.
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.RedemptionAlreadyPending.selector);
        account.requestRedeem(1, 3, bytes32("rr2"), 0, "");
    }

    function test_deposit_while_redemption_pending_does_not_corrupt_received_amount() public {
        vm.prank(owner);
        account.setOperator(operator);
        vm.prank(owner);
        account.setFeeBps(1000, 2000);
        // T0's maxVault ceiling is 150e18; the first 100e18 deposit already uses most of that
        // headroom, so lower the vault's own deposit floor to let a small second deposit
        // through without tripping OverCapacity — this test is about balance-delta isolation,
        // not tier capacity edges.
        vault.setMinDepositAssets(10e18);

        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");

        // A second, unrelated deposit lands WHILE this redemption is still pending — its
        // assets leaving to the vault (funded from setUp's existing 10000e18 idle balance,
        // not a fresh mint, which would itself be an untracked inflow no real on-chain event
        // could produce) must not be misread as part of the redemption payout.
        vm.prank(agentKey);
        account.deposit(40e18, 3, bytes32("d2"), 0, "");

        vault.setNavPerShare(1.2e18);
        usdc.mint(address(vault), 20e18);
        vault.finalizeRedeem(reqId);

        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 4, bytes32("rc1"), 0, "");

        // received = 120e18, basisOut = 100e18 -> gain = 20e18, fee = 2e18 — NOT contaminated
        // by the 40e18 that separately left for the interleaved deposit.
        assertEq(account.accruedFees(), 2e18, "the interleaved deposit's own outflow is netted out correctly");
    }

    /// @dev The exact exploit sequence the reliability-auditor described: without the fix
    /// above, this second, genuinely-gaining redemption would have its `gain` overstated by
    /// the 100e18 of principal that was erased and never restored — a direct O-09 violation.
    function test_rejected_redemption_does_not_let_a_later_real_gain_overstate_fee() public {
        vm.prank(owner);
        account.setOperator(operator);
        vm.prank(owner);
        account.setFeeBps(1000, 2000); // 10%

        vm.prank(agentKey);
        account.deposit(100e18, 1, bytes32("d1"), 0, "");

        vm.prank(agentKey);
        uint256 rejReqId = account.requestRedeem(100e18, 2, bytes32("rr1"), 0, "");
        vault.rejectRedeem(rejReqId);
        vm.prank(agentKey);
        account.settleRejectedRedeem(rejReqId, 3, bytes32("sr1"), 0, "");
        assertEq(account.costBasis(), 100e18, "basis restored, not permanently erased");

        // A genuine 20% gain on the SAME 100e18 principal (still the only deposit ever made).
        vault.setNavPerShare(1.2e18);
        usdc.mint(address(vault), 20e18);

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(100e18, 4, bytes32("rr2"), 0, "");
        vault.finalizeRedeem(reqId);
        vm.prank(agentKey);
        account.reconcileRedemption(reqId, 5, bytes32("rc1"), 0, "");

        // received = 120e18, basisOut = 100e18 (the RESTORED basis) -> gain = 20e18 exactly,
        // fee = 2e18. Without the fix, basisOut would be 0 (never restored), overstating gain
        // to 120e18 and fee to 12e18 — charging fee against real principal, not yield.
        assertEq(account.accruedFees(), 2e18, "fee reflects the real 20e18 gain, not the erased basis");
    }
}
