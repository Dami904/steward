// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyMath} from "../../src/libraries/PolicyMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Fuzz-test companion to test/halmos/PolicyMathSymbolic.t.sol. Halmos (symbolic
/// execution) proves check_capMandate_never_exceeds_maxVaultUsdc,
/// check_capLiquid_never_exceeds_treasury, and
/// check_computeCapacity_headroom_and_overCap_mutually_exclusive for ALL inputs up to
/// uint128. It could NOT decide check_computeCapacity_never_exceeds_min_of_inputs or
/// check_recognisedPositionValue_never_exceeds_navMark within any tried timeout (up to 180s,
/// confirmed not a bit-width scaling artifact — a uint40-bounded version times out too) — the
/// chained multiply/divide in both is classic nonlinear-arithmetic territory that SMT solvers
/// struggle with regardless of backend (tried z3-default, yices, attempted bitwuzla but it
/// requires a network download Halmos refuses by default). This is a real, open verification
/// gap on those two properties, documented in spec/DECISIONS.md — not silently treated as
/// "proven". These fuzz tests give probabilistic (not exhaustive) coverage of the same five
/// properties in the meantime, at the default 256 runs.
contract PolicyMathTest is Test {
    function testFuzz_capMandate_never_exceeds_maxVaultUsdc(uint128 maxBps, uint128 maxVaultUsdc, uint128 treasury)
        public
        pure
    {
        uint256 result = PolicyMath.capMandate(maxBps, maxVaultUsdc, treasury);
        assertLe(result, maxVaultUsdc);
    }

    function testFuzz_capLiquid_never_exceeds_treasury(uint128 treasury, uint128 reserveAmt) public pure {
        uint256 result = PolicyMath.capLiquid(treasury, reserveAmt);
        assertLe(result, treasury);
    }

    /// The property Halmos could not decide exhaustively — see file header.
    function testFuzz_computeCapacity_never_exceeds_min_of_inputs(
        uint128 capMandate_,
        uint128 capLiquid_,
        uint128 capTier_,
        uint128 capHealth_,
        uint128 capacityCapOnChain,
        uint16 healthMultiplierBpsRaw,
        uint128 exposure
    ) public pure {
        uint256 healthMultiplierBps = bound(healthMultiplierBpsRaw, 0, 10_000);

        uint256 minCap = capMandate_;
        if (capLiquid_ < minCap) minCap = capLiquid_;
        if (capTier_ < minCap) minCap = capTier_;
        if (capHealth_ < minCap) minCap = capHealth_;
        if (capacityCapOnChain < minCap) minCap = capacityCapOnChain;

        (uint256 capacity,,,) = PolicyMath.computeCapacity(
            capMandate_, capLiquid_, capTier_, capHealth_, capacityCapOnChain, healthMultiplierBps, exposure
        );
        assertLe(capacity, minCap);
    }

    function testFuzz_computeCapacity_headroom_and_overCap_mutually_exclusive(
        uint128 capMandate_,
        uint128 capLiquid_,
        uint128 capTier_,
        uint128 capHealth_,
        uint128 capacityCapOnChain,
        uint16 healthMultiplierBpsRaw,
        uint128 exposure
    ) public pure {
        uint256 healthMultiplierBps = bound(healthMultiplierBpsRaw, 0, 10_000);

        (, uint256 headroom, uint256 overCap,) = PolicyMath.computeCapacity(
            capMandate_, capLiquid_, capTier_, capHealth_, capacityCapOnChain, healthMultiplierBps, exposure
        );
        assertTrue(headroom == 0 || overCap == 0);
    }

    /// Regression: a fuzz run on the first version of this test suite found that
    /// PolicyMath.recognisedPositionValue overflow-reverted (Solidity 0x11 panic) on this
    /// exact input, because `shares * navPerShare` was computed as a plain uint256
    /// multiplication that overflows once both operands approach uint128::max — realistic
    /// under this project's own uint128 money convention, not a contrived edge case. Fixed by
    /// switching that step to OpenZeppelin's Math.mulDiv (512-bit intermediate, no overflow
    /// where the true floor result still fits in uint256).
    function test_recognisedPositionValue_does_not_overflow_near_uint128_max() public pure {
        uint256 shares = 340282366920938463463374607431768211453;
        uint256 navPerShare = 340282366920938463463374607431768211455;
        uint256 navScale = 4612922;
        uint256 issuerHaircutBps = 13;
        uint256 latencyHaircutBps = 227;

        uint256 navMark = Math.mulDiv(shares, navPerShare, navScale);
        uint256 result =
            PolicyMath.recognisedPositionValue(shares, navPerShare, navScale, issuerHaircutBps, latencyHaircutBps);
        assertLe(result, navMark);
    }

    /// The other property Halmos could not decide exhaustively — see file header.
    function testFuzz_recognisedPositionValue_never_exceeds_navMark(
        uint128 shares,
        uint128 navPerShare,
        uint128 navScaleRaw,
        uint16 issuerHaircutBpsRaw,
        uint16 latencyHaircutBpsRaw
    ) public pure {
        uint256 navScale = bound(navScaleRaw, 1, type(uint128).max);
        uint256 issuerHaircutBps = bound(issuerHaircutBpsRaw, 0, 10_000);
        uint256 latencyHaircutBps = bound(latencyHaircutBpsRaw, 0, 10_000);

        // Math.mulDiv here too — a plain `shares * navPerShare` in the *test's own* comparison
        // value would overflow for the same near-uint128::max inputs this fuzzer explores,
        // independent of whatever PolicyMath itself does internally.
        uint256 navMark = Math.mulDiv(shares, navPerShare, navScale);
        uint256 result =
            PolicyMath.recognisedPositionValue(shares, navPerShare, navScale, issuerHaircutBps, latencyHaircutBps);
        assertLe(result, navMark);
    }
}
