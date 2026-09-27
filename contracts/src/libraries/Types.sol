// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Shared structs and constants for StewardAccount, ConductRegistry, and
/// VaultHealthFeed. Field order/values are the canonical encoding from spec/accounting.md
/// section 8 and must stay in sync with packages/engine/src/types.ts.
library Types {
    // --- Verdicts. spec/accounting.md section 5. ---
    uint8 internal constant ALLOW = 0;
    uint8 internal constant ALLOW_CLAMPED = 1;
    uint8 internal constant NEEDS_APPROVAL = 2;
    uint8 internal constant REFUSE = 3;

    // --- Reason bits. spec/accounting.md section 5. Fixed order, do not renumber. ---
    uint8 internal constant R_OK = 0;
    uint8 internal constant R_HOLD_NOOP = 1;
    uint8 internal constant R_MANDATE_INVALID = 2;
    uint8 internal constant R_MANDATE_EXPIRED = 3;
    uint8 internal constant R_AGENT_MISMATCH = 4;
    uint8 internal constant R_TARGET_NOT_ALLOWED = 5;
    uint8 internal constant R_OVER_CAPACITY = 6;
    uint8 internal constant R_OVER_MAX_TX = 7;
    uint8 internal constant R_BELOW_RESERVE = 8;
    uint8 internal constant R_STALE_EVIDENCE = 9;
    uint8 internal constant R_CODEHASH_CHANGED = 10;
    uint8 internal constant R_DRAWDOWN_PAUSE = 11;
    uint8 internal constant R_ADVERSE_CLAIM = 12;
    uint8 internal constant R_UNGROUNDED_CLAIM = 13;
    uint8 internal constant R_RATE_LIMIT = 14;
    uint8 internal constant R_ABOVE_APPROVAL_THRESHOLD = 15;
    uint8 internal constant R_HARD_CAP = 16;
    uint8 internal constant R_PROPOSAL_INVALID = 17;
    uint8 internal constant R_MODEL_FAILED_OUTPUT = 18;
    uint8 internal constant R_OWNER_PAUSED = 19;
    uint8 internal constant R_MANDATORY_DERISK = 20;

    function reasonMask(uint8 bit) internal pure returns (uint32) {
        return uint32(1) << bit;
    }

    // --- Health snapshot method ladder. spec/health.md section 2. ---
    uint8 internal constant METHOD_REQUEST_FINALIZE_VIEW = 0;
    uint8 internal constant METHOD_FULFILL_EVENT = 1;
    uint8 internal constant METHOD_CLAIM_EVENT = 2;
    uint8 internal constant METHOD_OWN_REQUESTS = 3;
    uint8 internal constant METHOD_DOC_CONSTANT = 4;

    uint32 internal constant FLAG_PAUSED = 1;
    uint32 internal constant FLAG_CODEHASH_CHANGED = 2;
    uint32 internal constant FLAG_NAV_STALE = 4;

    // --- Mandate. The plan's struct sketch, extended with the
    // accounting-formula fields from spec/accounting.md sections 2-3. ---
    struct Mandate {
        uint128 maxTxUsdc;
        uint16 maxBps; // out of 10000
        uint128 maxVaultUsdc;
        uint128 minLiquidUsdc;
        uint32 maxActionsPerDay;
        uint40 expiry;
        uint32 loosenDelay;
        uint16 issuerHaircutBps;
        uint16 latencyHaircutBpsPerDay;
        uint16 latencyHaircutMaxBps;
        uint32 leadFloorDays;
        uint128 approvalAbove;
    }

    // --- Envelope. ---
    struct Envelope {
        uint128 capacityCap;
        uint128 capCeiling;
        uint128 reserveUsdc;
        bool paused;
    }

    // --- Tier state. spec/tiers.md section 2. ---
    struct TierState {
        uint8 tier;
        uint40 tierEnteredAt;
        uint128 riskAcc;
        uint128 peakExposure;
        uint32 receiptsSinceEntry;
        uint32 incidentCount;
        uint40 lastIncidentAt;
        uint128 lastExposure;
        uint40 lastTs;
        uint32 incidentsSinceEntry;
    }

    // --- Tier limits. spec/tiers.md section 1 (numbers already carry the Phase 0 fix:
    // floors raised to clear the vault's real 100-unit minDepositAssets). ---
    struct TierLimits {
        uint128 maxTx;
        uint128 maxVault;
        uint16 maxBps;
        uint128 approvalAbove;
        uint32 actionsPerDay;
        uint32 minDwellUnits;
        uint128 minRiskUnits;
        uint16 peakRequiredBps;
        uint32 minReceipts;
    }

    uint8 internal constant TIER_COUNT = 4;
    uint128 internal constant HARD_CAP = 1200e18;
    uint32 internal constant DEMO_TIME_UNIT_SECONDS = 60;
    uint32 internal constant PRODUCTION_TIME_UNIT_SECONDS = 86400;

    function tierLimits(uint8 tier) internal pure returns (TierLimits memory) {
        // onchain-access-control skill, check 1: fail closed on an out-of-range key,
        // matching tierLimitsFor() in packages/engine/src/tiers.ts and
        // packages/engine-py/steward_engine/tiers.py.
        if (tier >= TIER_COUNT) revert("Types: no such tier");
        if (tier == 0) {
            return TierLimits(120e18, 150e18, 1000, 60e18, 4, 10, 5, 6000, 10);
        } else if (tier == 1) {
            return TierLimits(300e18, 400e18, 2500, 150e18, 8, 20, 30, 6000, 20);
        } else if (tier == 2) {
            return TierLimits(600e18, 800e18, 4000, 300e18, 12, 40, 100, 6000, 30);
        } else {
            return TierLimits(1000e18, 1200e18, 6000, 500e18, 24, 0, 0, 0, 0);
        }
    }
}
