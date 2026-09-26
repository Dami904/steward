// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Types} from "./Types.sol";
import {VaultHealthFeed} from "../VaultHealthFeed.sol";

/// @notice spec/health.md section 4: tighten-only consumption. A real library (not an
/// internal function stuck inside VaultHealthFeed) so StewardAccount can call it directly
/// on a snapshot it read from VaultHealthFeed.healthOf(). Mirrors deriveHealthCap in
/// health.ts/health.py exactly.
library HealthMath {
    /// @dev Never raises anything (invariant O-13) — the only possible outputs are 0, half
    /// of capMandate, or capMandate unchanged.
    function deriveHealthCap(
        VaultHealthFeed.HealthSnapshot memory s,
        uint40 nowTs,
        uint40 maxStaleSec,
        uint32 mandateLeadTimeSec,
        uint16 drawdownPauseThresholdBps,
        uint128 capMandate
    ) internal pure returns (uint128) {
        // onchain-access-control skill, check 1 (default-deny): a vault nothing has ever
        // been published for reads back as the zero-value struct, `s.ts == 0`. That must
        // resolve to stale/denied explicitly, not by accident of `block.timestamp` being
        // large enough on a real chain that `nowTs - 0` alone would exceed maxStaleSec —
        // relying on that would make the fail-closed property depend on absolute chain age
        // rather than being true by construction (e.g. it silently breaks in any
        // environment, such as a fresh test/fork, where block.timestamp starts near zero).
        //
        // `s.ts > nowTs` (a future-dated snapshot — never legitimate, whether from a buggy
        // or malicious registered reporter) is checked next so the `||` short-circuits
        // before `nowTs - s.ts` can underflow. Without this, a bad timestamp would revert
        // every deposit (denial of service) instead of the intended fail-closed healthCap=0.
        bool stale = s.ts == 0 || s.ts > nowTs || (nowTs - s.ts) > maxStaleSec;
        bool hardStop = stale || (s.flags & Types.FLAG_PAUSED) != 0 || (s.flags & Types.FLAG_CODEHASH_CHANGED) != 0;
        if (hardStop) return 0;

        uint16 halfPauseThreshold = drawdownPauseThresholdBps / 2;
        bool p90ExceedsMandate = s.p90Sec > mandateLeadTimeSec;
        bool drawdownElevated = s.drawdownBps >= halfPauseThreshold;
        if (p90ExceedsMandate || drawdownElevated) {
            return capMandate / 2;
        }

        return capMandate;
    }
}
