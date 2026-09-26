"""Types for the deterministic policy engine, mirroring packages/engine/src/types.ts
field-for-field. See /spec/accounting.md, /spec/tiers.md, /spec/health.md for the source
of truth; this file has no logic."""

from __future__ import annotations
from dataclasses import dataclass, field, replace
from typing import Optional

# --- Verdict (spec/accounting.md section 5) ---
ALLOW = 0
ALLOW_CLAMPED = 1
NEEDS_APPROVAL = 2
REFUSE = 3

# --- Reason bits (spec/accounting.md section 5). Order fixed, must match types.ts. ---
OK = 0
HOLD_NOOP = 1
MANDATE_INVALID = 2
MANDATE_EXPIRED = 3
AGENT_MISMATCH = 4
TARGET_NOT_ALLOWED = 5
OVER_CAPACITY = 6
OVER_MAX_TX = 7
BELOW_RESERVE = 8
STALE_EVIDENCE = 9
CODEHASH_CHANGED = 10
DRAWDOWN_PAUSE = 11
ADVERSE_CLAIM = 12
UNGROUNDED_CLAIM = 13
RATE_LIMIT = 14
ABOVE_APPROVAL_THRESHOLD = 15
HARD_CAP = 16
PROPOSAL_INVALID = 17
MODEL_FAILED_OUTPUT = 18
OWNER_PAUSED = 19
MANDATORY_DERISK = 20


def reason_mask(bits: list[int]) -> int:
    mask = 0
    for bit in bits:
        mask |= 1 << bit
    return mask


# --- Capacity binding term (spec/accounting.md section 4 / spec/tiers.md section 5) ---
CAP_MANDATE = 0
CAP_LIQUID = 1
CAP_TIER = 2
CAP_HEALTH = 3
CAP_CAPACITY_CAP_ON_CHAIN = 4


@dataclass
class Mandate:
    maxTxUsdc: int
    maxBps: int  # out of 10000
    maxVaultUsdc: int
    minLiquidUsdc: int
    maxActionsPerDay: int
    expiry: int  # unix seconds
    loosenDelay: int
    feeBps: int
    maxFeeBps: int
    operator: str
    issuerHaircutBps: int
    latencyHaircutBpsPerDay: int
    latencyHaircutMaxBps: int
    leadFloorDays: int
    latencySafety: float
    bufferDays: int
    approvalAbove: int


@dataclass
class VaultReadState:
    navPerShare: int
    shares: int
    liquid: int
    finalizedNotYetClaimed: int
    pendingRedemptionExpectedHaircut: int
    minDepositAssets: int
    minRedeemAssets: int
    paused: bool
    codehash: str
    expectedCodehash: str


@dataclass
class EvidenceState:
    stale: bool
    corroboratedSevereAdverse: bool
    singlePathAdverse: bool
    observedLatencyDays: float
    drawdownBps: int
    drawdownPauseThresholdBps: int


# --- spec/tiers.md section 1 ---
@dataclass
class TierLimits:
    maxTx: int
    maxVault: int
    maxBps: int
    approvalAbove: int
    actionsPerDay: int
    minDwellUnits: int
    minRiskUnits: int
    peakRequiredBps: int
    minReceipts: int


TIER_SCHEDULE: list[TierLimits] = [
    TierLimits(120, 150, 1000, 60, 4, 10, 5, 6000, 10),
    TierLimits(300, 400, 2500, 150, 8, 20, 30, 6000, 20),
    TierLimits(600, 800, 4000, 300, 12, 40, 100, 6000, 30),
    TierLimits(1000, 1200, 6000, 500, 24, 0, 0, 0, 0),
]

HARD_CAP = 1200
DEMO_TIME_UNIT_SECONDS = 60
PRODUCTION_TIME_UNIT_SECONDS = 86400


# --- spec/tiers.md section 2 ---
@dataclass
class TierState:
    tier: int
    tierEnteredAt: int
    riskAcc: int
    peakExposure: int
    receiptsSinceEntry: int
    incidentCount: int
    lastIncidentAt: int
    lastExposure: int
    lastTs: int
    incidentsSinceEntry: int


def initial_tier_state(now: int, start_tier: int = 0) -> TierState:
    return TierState(
        tier=start_tier,
        tierEnteredAt=now,
        riskAcc=0,
        peakExposure=0,
        receiptsSinceEntry=0,
        incidentCount=0,
        lastIncidentAt=0,
        lastExposure=0,
        lastTs=now,
        incidentsSinceEntry=0,
    )


# --- spec/health.md sections 2-3 ---
REQUEST_FINALIZE_VIEW = 0
FULFILL_EVENT = 1
CLAIM_EVENT = 2
OWN_REQUESTS = 3
DOC_CONSTANT = 4

FLAG_PAUSED = 1
FLAG_CODEHASH_CHANGED = 2
FLAG_NAV_STALE = 4


@dataclass
class RedeemRequestRecord:
    id: int
    owner: str
    receiver: str
    shares: int
    requestedAt: int
    processedAt: int
    status: str  # "None" | "Pending" | "Finalized" | "Rejected"


@dataclass
class HealthSnapshot:
    fromBlock: int
    toBlock: int
    ts: int
    method: int
    n: int
    p50Sec: int
    p90Sec: int
    maxSec: int
    navPerShare: int
    drawdownBps: int
    codehash: str
    flags: int
    evidenceHash: str


@dataclass
class PolicyResult:
    verdict: int
    reasons: int
    capacity: int
    headroom: int
    overCap: int
    bindingTerm: int
