// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PolicyMath} from "../../src/libraries/PolicyMath.sol";

/// @notice PolicyMath's own functions are `internal pure` (a library meant to be inlined via
/// `using`/direct calls from StewardAccount, not deployed on its own) — Halmos, like Foundry,
/// needs an actual deployed contract with external/public entry points to call into. This is
/// a pure pass-through, no logic of its own, so a passing symbolic property here is a
/// property of PolicyMath itself, not of anything this harness adds.
contract PolicyMathHarness {
    function recognisedPositionValue(
        uint256 shares,
        uint256 navPerShare,
        uint256 navScale,
        uint256 issuerHaircutBps,
        uint256 latencyHaircutBps
    ) external pure returns (uint256) {
        return PolicyMath.recognisedPositionValue(shares, navPerShare, navScale, issuerHaircutBps, latencyHaircutBps);
    }

    function computeCapacity(
        uint256 capMandate_,
        uint256 capLiquid_,
        uint256 capTier_,
        uint256 capHealth_,
        uint256 capacityCapOnChain,
        uint256 healthMultiplierBps,
        uint256 exposure
    ) external pure returns (uint256 capacity, uint256 headroom, uint256 overCap, uint8 bindingIndex) {
        return PolicyMath.computeCapacity(
            capMandate_, capLiquid_, capTier_, capHealth_, capacityCapOnChain, healthMultiplierBps, exposure
        );
    }

    function capMandate(uint256 maxBps, uint256 maxVaultUsdc, uint256 treasury) external pure returns (uint256) {
        return PolicyMath.capMandate(maxBps, maxVaultUsdc, treasury);
    }

    function capLiquid(uint256 treasury, uint256 reserveAmt) external pure returns (uint256) {
        return PolicyMath.capLiquid(treasury, reserveAmt);
    }
}
