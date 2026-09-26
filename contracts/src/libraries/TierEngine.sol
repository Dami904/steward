// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Types} from "./Types.sol";

/// @notice Mirrors packages/engine/src/tiers.ts and packages/engine-py/steward_engine/tiers.py
/// exactly. Pure functions over Types.TierState — spec/tiers.md sections 2-6.
library TierEngine {
    function accrueRisk(Types.TierState memory state, uint40 nowTs) internal pure returns (Types.TierState memory) {
        uint40 dt = nowTs > state.lastTs ? nowTs - state.lastTs : 0;
        state.riskAcc = state.riskAcc + state.lastExposure * dt;
        state.lastTs = nowTs;
        return state;
    }

    function recordExposure(Types.TierState memory state, uint40 nowTs, uint128 exposure)
        internal
        pure
        returns (Types.TierState memory)
    {
        state = accrueRisk(state, nowTs);
        if (exposure > state.peakExposure) state.peakExposure = exposure;
        state.lastExposure = exposure;
        return state;
    }

    function recordReceipt(Types.TierState memory state) internal pure returns (Types.TierState memory) {
        state.receiptsSinceEntry += 1;
        return state;
    }

    /// @dev spec/tiers.md section 3. All six conditions must hold. Returns a bitmask of
    /// which conditions failed (bit i set = condition i failed), 0 means eligible. Bit
    /// layout: 0=dwell 1=risk 2=peak 3=receipts 4=incidents 5=paused 6=mandateExpired
    /// 7=evidenceStale 8=alreadyMaxTier.
    function checkPromotion(
        Types.TierState memory state,
        uint40 nowTs,
        uint32 timeUnitSeconds,
        bool paused,
        bool mandateExpired,
        bool evidenceStale
    ) internal pure returns (uint16 failedMask) {
        if (state.tier >= Types.TIER_COUNT - 1) {
            return uint16(1) << 8;
        }

        Types.TierLimits memory limits = Types.tierLimits(state.tier);
        Types.TierState memory accrued = accrueRisk(state, nowTs);

        if (nowTs - state.tierEnteredAt < uint40(limits.minDwellUnits) * timeUnitSeconds) {
            failedMask |= (uint16(1) << 0);
        }
        uint128 riskUnits = accrued.riskAcc / timeUnitSeconds;
        if (riskUnits < limits.minRiskUnits) {
            failedMask |= (uint16(1) << 1);
        }
        uint128 peakRequired = (limits.maxVault * limits.peakRequiredBps) / 10_000;
        if (accrued.peakExposure < peakRequired) {
            failedMask |= (uint16(1) << 2);
        }
        if (state.receiptsSinceEntry < limits.minReceipts) {
            failedMask |= (uint16(1) << 3);
        }
        if (state.incidentsSinceEntry != 0) {
            failedMask |= (uint16(1) << 4);
        }
        if (paused) failedMask |= (uint16(1) << 5);
        if (mandateExpired) failedMask |= (uint16(1) << 6);
        if (evidenceStale) failedMask |= (uint16(1) << 7);
    }

    /// @dev Caller must have already validated checkPromotion(...) == 0. Mirrors graduate()
    /// in tiers.ts/tiers.py: only performs the state transition, no re-validation here.
    function graduate(Types.TierState memory state, uint40 nowTs) internal pure returns (Types.TierState memory) {
        return Types.TierState({
            tier: state.tier + 1,
            tierEnteredAt: nowTs,
            riskAcc: 0,
            peakExposure: 0,
            receiptsSinceEntry: 0,
            incidentCount: state.incidentCount,
            lastIncidentAt: state.lastIncidentAt,
            lastExposure: state.lastExposure,
            lastTs: nowTs,
            incidentsSinceEntry: 0
        });
    }

    uint8 internal constant INCIDENT_LOOSEN_VETOED = 0;
    uint8 internal constant INCIDENT_OWNER_PAUSE = 1;
    uint8 internal constant INCIDENT_OVERCAP_GRACE_EXCEEDED = 2;

    /// @dev spec/tiers.md section 4.
    function applyIncident(Types.TierState memory state, uint8 incidentType, uint40 nowTs)
        internal
        pure
        returns (Types.TierState memory)
    {
        state.incidentCount += 1;
        state.incidentsSinceEntry += 1;
        state.lastIncidentAt = nowTs;

        if (incidentType == INCIDENT_LOOSEN_VETOED) {
            uint8 newTier = state.tier > 0 ? state.tier - 1 : 0;
            state.tier = newTier;
        } else if (incidentType == INCIDENT_OWNER_PAUSE || incidentType == INCIDENT_OVERCAP_GRACE_EXCEEDED) {
            state.tier = 0;
        } else {
            revert("TierEngine: unknown incident type");
        }

        state.tierEnteredAt = nowTs;
        state.riskAcc = 0;
        state.peakExposure = 0;
        state.receiptsSinceEntry = 0;
        state.incidentsSinceEntry = 0;
        return state;
    }
}
