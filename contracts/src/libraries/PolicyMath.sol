// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure math mirroring spec/accounting.md sections 2 and 4, and
/// packages/engine/src/accounting.ts / packages/engine-py/steward_engine/accounting.py.
/// Solidity's uint division already floors toward zero (equivalent to the TS/Python
/// floorDiv for non-negative operands, which is all that appears here — no signed
/// arithmetic anywhere in this library), so no explicit floorDiv helper is needed the way
/// the off-chain implementations required one for bigint/negative-safe division.
library PolicyMath {
    uint256 internal constant BPS = 10_000;

    /// @dev spec/accounting.md section 2.
    function recognisedPositionValue(
        uint256 shares,
        uint256 navPerShare,
        uint256 navScale,
        uint256 issuerHaircutBps,
        uint256 latencyHaircutBps
    ) internal pure returns (uint256) {
        // navMark is deliberately floored here before the haircut multiplication, matching
        // spec/accounting.md section 2's formula order exactly (and recognisedPositionValue
        // in accounting.ts/accounting.py, which floors at the same point) — this is required
        // for byte-identical results across all three implementations, not a precision bug.
        //
        // shares/navPerShare are plain uint256 here (no on-chain uint128 cap of their own),
        // so a naive `(shares * navPerShare)` can overflow uint256 well before either operand
        // is unrealistically large — a fuzz counterexample found both near uint128::max, still
        // within this project's own money convention. Math.mulDiv computes the exact
        // floor(shares*navPerShare/navScale) via a 512-bit intermediate, so it can't overflow
        // where the real product still fits, and reverts (rather than silently wrapping) only
        // when the true result itself doesn't fit in uint256.
        uint256 navMark = Math.mulDiv(shares, navPerShare, navScale);
        // Haircut terms are each <= BPS (10_000), so their product is <= 1e8 — safe as a plain
        // multiplication regardless of navMark's magnitude. But `navMark * haircutProduct`
        // itself can still overflow uint256 even when the true post-division result (this
        // function's final return value) fits comfortably: navMark alone can already be a
        // ~234-bit number for realistic-looking uint128 shares/navPerShare with a small
        // navScale, and multiplying that by up to 1e8 before dividing pushes the intermediate
        // past 2^256 while the final floor-divided answer stays well under it. Math.mulDiv
        // computes floor(navMark * haircutProduct / (BPS*BPS)) as a single fused operation via
        // a 512-bit intermediate, so it only reverts when the true final result itself doesn't
        // fit — not whenever an unreduced intermediate product doesn't. Also preserves the
        // spec's single-floor semantics (one division, not two sequential ones, which would
        // double-round differently).
        uint256 haircutProduct = (BPS - issuerHaircutBps) * (BPS - latencyHaircutBps);
        return Math.mulDiv(navMark, haircutProduct, BPS * BPS);
    }

    /// @dev spec/accounting.md section 4. Returns (capacity, headroom, overCap, bindingIndex).
    /// bindingIndex: 0=capMandate 1=capLiquid 2=capTier 3=capHealth 4=capacityCapOnChain,
    /// matching CapacityBindingTerm in packages/engine/src/types.ts exactly.
    function computeCapacity(
        uint256 capMandate_,
        uint256 capLiquid_,
        uint256 capTier_,
        uint256 capHealth_,
        uint256 capacityCapOnChain,
        uint256 healthMultiplierBps, // 0, 5000, or 10000
        uint256 exposure
    ) internal pure returns (uint256 capacity, uint256 headroom, uint256 overCap, uint8 bindingIndex) {
        uint256 min = capMandate_;
        bindingIndex = 0;
        if (capLiquid_ < min) {
            min = capLiquid_;
            bindingIndex = 1;
        }
        if (capTier_ < min) {
            min = capTier_;
            bindingIndex = 2;
        }
        if (capHealth_ < min) {
            min = capHealth_;
            bindingIndex = 3;
        }
        if (capacityCapOnChain < min) {
            min = capacityCapOnChain;
            bindingIndex = 4;
        }

        capacity = (min * healthMultiplierBps) / BPS;
        headroom = capacity > exposure ? capacity - exposure : 0;
        overCap = exposure > capacity ? exposure - capacity : 0;
    }

    function capMandate(uint256 maxBps, uint256 maxVaultUsdc, uint256 treasury) internal pure returns (uint256) {
        uint256 byBps = (maxBps * treasury) / BPS;
        return byBps < maxVaultUsdc ? byBps : maxVaultUsdc;
    }

    function capLiquid(uint256 treasury, uint256 reserveAmt) internal pure returns (uint256) {
        return treasury > reserveAmt ? treasury - reserveAmt : 0;
    }
}
