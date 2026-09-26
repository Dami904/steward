// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HealthMath} from "../../src/libraries/HealthMath.sol";
import {VaultHealthFeed} from "../../src/VaultHealthFeed.sol";
import {Types} from "../../src/libraries/Types.sol";

contract HealthMathTest is Test {
    uint40 constant MAX_STALE = 2 days;
    uint32 constant MANDATE_LEAD = 2 days;
    uint16 constant DRAWDOWN_THRESHOLD_BPS = 5000;
    uint128 constant CAP_MANDATE = 1000e18;

    function _snapshot(uint40 ts) internal pure returns (VaultHealthFeed.HealthSnapshot memory) {
        return VaultHealthFeed.HealthSnapshot({
            fromBlock: 1,
            toBlock: 1,
            ts: ts,
            method: Types.METHOD_REQUEST_FINALIZE_VIEW,
            n: 6,
            p50Sec: 3600,
            p90Sec: 3600,
            maxSec: 3600,
            navPerShare: 1e18,
            drawdownBps: 0,
            codehash: bytes32(0),
            flags: 0,
            evidenceHash: bytes32(0)
        });
    }

    /// @dev The bug this locks in: a never-published snapshot (ts == 0) must fail closed
    /// (healthCap == 0) regardless of block.timestamp's absolute magnitude — including in a
    /// fresh chain/test environment where block.timestamp is small, where `nowTs - 0 >
    /// maxStaleSec` alone would NOT have been true and the old code would have wrongly
    /// treated it as fresh.
    function test_unpublished_snapshot_fails_closed_even_at_small_block_timestamp() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(0);
        uint128 cap = HealthMath.deriveHealthCap(s, 1, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, 0, "unpublished snapshot must fail closed regardless of nowTs magnitude");
    }

    function test_unpublished_snapshot_fails_closed_at_realistic_block_timestamp() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(0);
        uint128 cap = HealthMath.deriveHealthCap(s, 1_789_990_226, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, 0);
    }

    /// @dev A future-dated snapshot.ts (never legitimate) must not underflow-revert and must
    /// not be treated as fresh — it's explicitly stale.
    function test_future_dated_snapshot_fails_closed_without_reverting() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(1000);
        uint128 cap = HealthMath.deriveHealthCap(s, 500, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, 0, "future-dated snapshot must be treated as stale, not crash or be trusted");
    }

    function test_fresh_snapshot_within_staleness_window_is_not_restricted() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(1000);
        uint128 cap = HealthMath.deriveHealthCap(s, 1000 + 1 days, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, CAP_MANDATE);
    }

    function test_snapshot_older_than_max_stale_fails_closed() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(1000);
        uint128 cap = HealthMath.deriveHealthCap(s, 1000 + MAX_STALE + 1, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, 0);
    }

    function test_paused_flag_fails_closed_even_if_fresh() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(1000);
        s.flags = Types.FLAG_PAUSED;
        uint128 cap = HealthMath.deriveHealthCap(s, 1000, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, 0);
    }

    function test_codehash_changed_flag_fails_closed_even_if_fresh() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(1000);
        s.flags = Types.FLAG_CODEHASH_CHANGED;
        uint128 cap = HealthMath.deriveHealthCap(s, 1000, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, 0);
    }

    function test_p90_exceeding_mandate_halves_cap_not_zeroes_it() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(1000);
        s.p90Sec = MANDATE_LEAD + 1;
        uint128 cap = HealthMath.deriveHealthCap(s, 1000, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, CAP_MANDATE / 2, "tighten-only: degraded liquidity halves, never zeroes, the cap");
    }

    function test_elevated_drawdown_halves_cap() public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(1000);
        s.drawdownBps = DRAWDOWN_THRESHOLD_BPS / 2; // exactly at the half-threshold boundary
        uint128 cap = HealthMath.deriveHealthCap(s, 1000, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertEq(cap, CAP_MANDATE / 2);
    }

    /// @dev Invariant O-13: this function must never be able to return more than capMandate
    /// — it can only tighten (0, half, or unchanged), never raise.
    function testFuzz_never_exceeds_capMandate(uint40 ts, uint40 nowTs, uint32 p90, uint16 drawdown, uint32 flags) public pure {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot(ts);
        s.p90Sec = p90;
        s.drawdownBps = drawdown;
        s.flags = flags;
        uint128 cap = HealthMath.deriveHealthCap(s, nowTs, MAX_STALE, MANDATE_LEAD, DRAWDOWN_THRESHOLD_BPS, CAP_MANDATE);
        assertLe(cap, CAP_MANDATE);
    }
}
