"""spec/accounting.md sections 2-4. Mirrors packages/engine/src/accounting.ts exactly."""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from .types import Mandate, EvidenceState

BPS = 10000


def floor_div(a: int, b: int) -> int:
    if b == 0:
        raise ZeroDivisionError("division by zero")
    # Python's // already floors toward -inf, matching the TS floorDiv implementation.
    return a // b


def ceil_div(a: int, b: int) -> int:
    if b == 0:
        raise ZeroDivisionError("division by zero")
    return floor_div(a + b - 1, b)


def recognised_position_value(
    shares: int,
    nav_per_share: int,
    nav_scale: int,
    issuer_haircut_bps: int,
    latency_haircut_bps: int,
) -> int:
    nav_mark = floor_div(shares * nav_per_share, nav_scale)
    num = nav_mark * (BPS - issuer_haircut_bps) * (BPS - latency_haircut_bps)
    return floor_div(num, BPS * BPS)


def latency_haircut_bps(mandate: Mandate, eff_lead_days: int) -> int:
    grown = mandate.latencyHaircutBpsPerDay * eff_lead_days
    return grown if grown < mandate.latencyHaircutMaxBps else mandate.latencyHaircutMaxBps


def effective_lead_days(
    mandate: Mandate,
    q90_days: Optional[float],
    sample_count: int,
    max_observed_days: Optional[float],
) -> int:
    import math

    if sample_count >= 5 and q90_days is not None:
        return max(mandate.leadFloorDays, math.ceil(q90_days * mandate.latencySafety))
    if sample_count >= 1 and max_observed_days is not None:
        return max(mandate.leadFloorDays, math.ceil(max_observed_days * 2 * mandate.latencySafety))
    return mandate.leadFloorDays


@dataclass
class Obligation:
    due: int
    amount: int


def reserve(min_liquid: int, obligations: list[Obligation], now: int, eff_lead_days: int, buffer_days: int) -> int:
    cutoff = now + eff_lead_days * 86400 + buffer_days * 86400
    total = 0
    for o in obligations:
        if o.due < cutoff:
            total += o.amount
    return min_liquid + total


def evidence_health_multiplier_bps(evidence: EvidenceState, eff_lead_days: int) -> int:
    if (
        evidence.stale
        or evidence.corroboratedSevereAdverse
        or evidence.drawdownBps >= evidence.drawdownPauseThresholdBps
    ):
        return 0
    half_threshold = evidence.drawdownPauseThresholdBps // 2
    if (
        evidence.singlePathAdverse
        or evidence.observedLatencyDays > eff_lead_days
        or evidence.drawdownBps >= half_threshold
    ):
        return 5000
    return 10000


@dataclass
class CapacityInputs:
    treasury: int
    capMandate: int
    capLiquid: int
    capTier: int
    capHealth: int
    capacityCapOnChain: int
    healthMultiplierBps: int
    exposure: int


@dataclass
class CapacityResult:
    capacity: int
    headroom: int
    overCap: int
    bindingIndex: int


def compute_capacity(inputs: CapacityInputs) -> CapacityResult:
    caps = [
        (inputs.capMandate, 0),
        (inputs.capLiquid, 1),
        (inputs.capTier, 2),
        (inputs.capHealth, 3),
        (inputs.capacityCapOnChain, 4),
    ]
    min_val, binding_index = caps[0]
    for v, idx in caps:
        if v < min_val:
            min_val = v
            binding_index = idx
    capacity = floor_div(min_val * inputs.healthMultiplierBps, BPS)
    headroom = capacity - inputs.exposure if capacity > inputs.exposure else 0
    over_cap = inputs.exposure - capacity if inputs.exposure > capacity else 0
    return CapacityResult(capacity=capacity, headroom=headroom, overCap=over_cap, bindingIndex=binding_index)


def cap_mandate(mandate: Mandate, treasury: int) -> int:
    by_bps = floor_div(mandate.maxBps * treasury, BPS)
    return by_bps if by_bps < mandate.maxVaultUsdc else mandate.maxVaultUsdc


def cap_liquid(treasury: int, reserve_amt: int) -> int:
    return treasury - reserve_amt if treasury > reserve_amt else 0
