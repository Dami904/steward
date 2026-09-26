// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyMathHarness} from "./PolicyMathHarness.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Halmos symbolic tests for PolicyMath — proves each property for ALL possible inputs
/// (within the vm.assume bounds), not just fuzzed samples. `check_`-prefixed functions are
/// Halmos's default test-name convention (confirmed via `halmos --help`); parameters are
/// symbolic automatically, no special cheatcode import needed for primitive types.
///
/// Bounds: inputs are assumed to fit uint128 (this project's own on-chain money convention,
/// e.g. StewardAccount's costBasis/accruedFees) to keep the SMT solver tractable — PolicyMath
/// itself accepts full uint256, so these are the properties within the realistic input domain,
/// not a proof for arbitrary uint256 (that would include values no caller in this codebase
/// could ever actually pass).
contract PolicyMathSymbolicTest is Test {
    PolicyMathHarness harness;

    function setUp() public {
        harness = new PolicyMathHarness();
    }

    /// capMandate can never exceed the hard vault ceiling passed to it.
    function check_capMandate_never_exceeds_maxVaultUsdc(uint256 maxBps, uint256 maxVaultUsdc, uint256 treasury)
        public
        view
    {
        vm.assume(maxBps <= type(uint128).max);
        vm.assume(maxVaultUsdc <= type(uint128).max);
        vm.assume(treasury <= type(uint128).max);

        uint256 result = harness.capMandate(maxBps, maxVaultUsdc, treasury);
        assert(result <= maxVaultUsdc);
    }

    /// capLiquid can never exceed the treasury balance it was computed from.
    function check_capLiquid_never_exceeds_treasury(uint256 treasury, uint256 reserveAmt) public view {
        vm.assume(treasury <= type(uint128).max);
        vm.assume(reserveAmt <= type(uint128).max);

        uint256 result = harness.capLiquid(treasury, reserveAmt);
        assert(result <= treasury);
    }

    /// The core safety property of the capacity system: computeCapacity's output can never
    /// exceed the minimum of the five caps fed into it, even after the health multiplier is
    /// applied (a multiplier > 100% would violate this — this proves that can't happen for any
    /// bps value up to BPS itself, i.e. the multiplier can shrink but never inflate the min-cap).
    function check_computeCapacity_never_exceeds_min_of_inputs(
        uint256 capMandate_,
        uint256 capLiquid_,
        uint256 capTier_,
        uint256 capHealth_,
        uint256 capacityCapOnChain,
        uint256 healthMultiplierBps,
        uint256 exposure
    ) public view {
        vm.assume(capMandate_ <= type(uint128).max);
        vm.assume(capLiquid_ <= type(uint128).max);
        vm.assume(capTier_ <= type(uint128).max);
        vm.assume(capHealth_ <= type(uint128).max);
        vm.assume(capacityCapOnChain <= type(uint128).max);
        vm.assume(healthMultiplierBps <= 10_000);
        vm.assume(exposure <= type(uint128).max);

        uint256 minCap = capMandate_;
        if (capLiquid_ < minCap) minCap = capLiquid_;
        if (capTier_ < minCap) minCap = capTier_;
        if (capHealth_ < minCap) minCap = capHealth_;
        if (capacityCapOnChain < minCap) minCap = capacityCapOnChain;

        (uint256 capacity,,,) = harness.computeCapacity(
            capMandate_, capLiquid_, capTier_, capHealth_, capacityCapOnChain, healthMultiplierBps, exposure
        );
        assert(capacity <= minCap);
    }

    /// headroom and overCap are mutually exclusive — exposure is either under capacity
    /// (headroom > 0, overCap == 0) or at/over it (headroom == 0, overCap >= 0), never both
    /// nonzero at once. A violation here would mean the same account is simultaneously
    /// reported as having room to grow and being over its limit.
    function check_computeCapacity_headroom_and_overCap_mutually_exclusive(
        uint256 capMandate_,
        uint256 capLiquid_,
        uint256 capTier_,
        uint256 capHealth_,
        uint256 capacityCapOnChain,
        uint256 healthMultiplierBps,
        uint256 exposure
    ) public view {
        vm.assume(capMandate_ <= type(uint128).max);
        vm.assume(capLiquid_ <= type(uint128).max);
        vm.assume(capTier_ <= type(uint128).max);
        vm.assume(capHealth_ <= type(uint128).max);
        vm.assume(capacityCapOnChain <= type(uint128).max);
        vm.assume(healthMultiplierBps <= 10_000);
        vm.assume(exposure <= type(uint128).max);

        (, uint256 headroom, uint256 overCap,) = harness.computeCapacity(
            capMandate_, capLiquid_, capTier_, capHealth_, capacityCapOnChain, healthMultiplierBps, exposure
        );
        assert(headroom == 0 || overCap == 0);
    }

    /// Haircuts can only ever reduce recognised value, never inflate it — a genuine
    /// fund-safety property. If this failed, a position could be recorded as worth MORE than
    /// its raw NAV mark after haircuts are applied, which would let capacity checks pass for
    /// exposure that isn't actually backed.
    function check_recognisedPositionValue_never_exceeds_navMark(
        uint256 shares,
        uint256 navPerShare,
        uint256 navScale,
        uint256 issuerHaircutBps,
        uint256 latencyHaircutBps
    ) public view {
        vm.assume(shares <= type(uint128).max);
        vm.assume(navPerShare <= type(uint128).max);
        vm.assume(navScale > 0 && navScale <= type(uint128).max);
        vm.assume(issuerHaircutBps <= 10_000);
        vm.assume(latencyHaircutBps <= 10_000);

        uint256 navMark = Math.mulDiv(shares, navPerShare, navScale);
        uint256 result =
            harness.recognisedPositionValue(shares, navPerShare, navScale, issuerHaircutBps, latencyHaircutBps);
        assert(result <= navMark);
    }
}
