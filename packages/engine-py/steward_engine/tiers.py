"""spec/tiers.md sections 2-6. Mirrors packages/engine/src/tiers.ts exactly."""

from __future__ import annotations
from dataclasses import dataclass, replace
from .types import TIER_SCHEDULE, TierState, TierLimits

BPS = 10000


def accrue_risk(state: TierState, now: int) -> TierState:
    dt = max(0, now - state.lastTs)
    return replace(state, riskAcc=state.riskAcc + state.lastExposure * dt, lastTs=now)


def record_exposure(state: TierState, now: int, exposure: int) -> TierState:
    accrued = accrue_risk(state, now)
    peak = exposure if exposure > accrued.peakExposure else accrued.peakExposure
    return replace(accrued, lastExposure=exposure, peakExposure=peak)


def record_receipt(state: TierState) -> TierState:
    return replace(state, receiptsSinceEntry=state.receiptsSinceEntry + 1)


@dataclass
class PromotionCheck:
    eligible: bool
    failedConditions: list[str]


def check_promotion(
    state: TierState,
    now: int,
    time_unit_seconds: int,
    paused: bool,
    mandate_expired: bool,
    evidence_stale: bool,
) -> PromotionCheck:
    failed: list[str] = []
    if state.tier >= len(TIER_SCHEDULE) - 1:
        return PromotionCheck(eligible=False, failedConditions=["already at max tier"])

    limits: TierLimits = tier_limits_for(state.tier)
    accrued = accrue_risk(state, now)

    dwell_ok = now - state.tierEnteredAt >= limits.minDwellUnits * time_unit_seconds
    if not dwell_ok:
        failed.append("minDwell")

    risk_units = accrued.riskAcc // time_unit_seconds
    if not (risk_units >= limits.minRiskUnits):
        failed.append("minRiskUnits")

    peak_required = (limits.maxVault * limits.peakRequiredBps) // BPS
    if not (accrued.peakExposure >= peak_required):
        failed.append("peakRequired")

    if not (state.receiptsSinceEntry >= limits.minReceipts):
        failed.append("minReceipts")

    if not (state.incidentsSinceEntry == 0):
        failed.append("incidentsSinceEntry")

    if paused:
        failed.append("paused")
    if mandate_expired:
        failed.append("mandateExpired")
    if evidence_stale:
        failed.append("evidenceStale")

    return PromotionCheck(eligible=len(failed) == 0, failedConditions=failed)


def graduate(state: TierState, now: int) -> TierState:
    return TierState(
        tier=state.tier + 1,
        tierEnteredAt=now,
        riskAcc=0,
        peakExposure=0,
        receiptsSinceEntry=0,
        incidentCount=state.incidentCount,
        lastIncidentAt=state.lastIncidentAt,
        lastExposure=state.lastExposure,
        lastTs=now,
        incidentsSinceEntry=0,
    )


def apply_incident(state: TierState, incident: str, now: int) -> TierState:
    base = replace(
        state,
        incidentCount=state.incidentCount + 1,
        incidentsSinceEntry=state.incidentsSinceEntry + 1,
        lastIncidentAt=now,
    )
    if incident == "LOOSEN_VETOED":
        return _demote_one_tier(base, now)
    if incident in ("OWNER_PAUSE", "OVERCAP_GRACE_EXCEEDED"):
        return _demote_to_zero(base, now)
    raise ValueError(f"unknown incident type: {incident}")


def _demote_one_tier(state: TierState, now: int) -> TierState:
    new_tier = max(0, state.tier - 1)
    return replace(
        state, tier=new_tier, tierEnteredAt=now, riskAcc=0, peakExposure=0,
        receiptsSinceEntry=0, incidentsSinceEntry=0,
    )


def _demote_to_zero(state: TierState, now: int) -> TierState:
    return replace(
        state, tier=0, tierEnteredAt=now, riskAcc=0, peakExposure=0,
        receiptsSinceEntry=0, incidentsSinceEntry=0,
    )


def tier_limits_for(tier: int) -> TierLimits:
    # onchain-access-control skill, check 1: fail closed on an out-of-range key. Explicit
    # bounds check because Python list indexing silently wraps on negative indices
    # (TIER_SCHEDULE[-1] would return T3 instead of raising) — a fail-open bug TS's plain
    # array indexing doesn't have, but this codebase doesn't get to assume that either way.
    if tier < 0 or tier >= len(TIER_SCHEDULE):
        raise ValueError(f"tier_limits_for: no such tier {tier} (schedule has 0..{len(TIER_SCHEDULE) - 1})")
    return TIER_SCHEDULE[tier]
