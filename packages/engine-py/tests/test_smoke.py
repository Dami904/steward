import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.types import (
    Mandate,
    VaultReadState,
    RedeemRequestRecord,
    TIER_SCHEDULE,
    DEMO_TIME_UNIT_SECONDS,
    initial_tier_state,
    REFUSE,
)
from steward_engine.health import build_request_finalize_snapshot
from steward_engine.policy import check_deposit, DepositCheckInputs
from steward_engine.accounting import CapacityInputs
from steward_engine.tiers import check_promotion, record_exposure, record_receipt, tier_limits_for
import pytest


def test_request_finalize_view_snapshot_matches_phase0_sample_shape():
    records = [
        RedeemRequestRecord(1, "0xe8ea6365c329130fd47d4d1ca0ae59caf49fa9c4", "0xe8ea6365c329130fd47d4d1ca0ae59caf49fa9c4", 1 * 10**18, 1780978493, 1780978720, "Rejected"),
        RedeemRequestRecord(2, "0x90b999e6fa9a1ab97bcd2978c21c155ebcbf42c6", "0x90b999e6fa9a1ab97bcd2978c21c155ebcbf42c6", 1 * 10**17, 1781068088, 0, "Pending"),
        RedeemRequestRecord(8, "0xbaaa6d4fa49cbb4aae8777657ec73b2bff97b445", "0xbaaa6d4fa49cbb4aae8777657ec73b2bff97b445", 188 * 10**18, 1786806693, 1787903313, "Finalized"),
    ]
    snap = build_request_finalize_snapshot(records, 123166105, 1789980000, 1091152000000000000, 0, "0xabc", "0xabc", False, False)
    assert snap.n == 1
    assert snap.maxSec == 1787903313 - 1786806693


def test_deposit_below_min_deposit_assets_is_proposal_invalid():
    mandate = Mandate(
        maxTxUsdc=1000, maxBps=10000, maxVaultUsdc=1200, minLiquidUsdc=0,
        maxActionsPerDay=100, expiry=9999999999, loosenDelay=0,
        feeBps=0, maxFeeBps=0, operator="0x0",
        issuerHaircutBps=0, latencyHaircutBpsPerDay=0, latencyHaircutMaxBps=0,
        leadFloorDays=1, latencySafety=1, bufferDays=0, approvalAbove=10000,
    )
    vault = VaultReadState(
        navPerShare=10**18, shares=0, liquid=10000, finalizedNotYetClaimed=0,
        pendingRedemptionExpectedHaircut=0, minDepositAssets=100, minRedeemAssets=100,
        paused=False, codehash="0xabc", expectedCodehash="0xabc",
    )
    result = check_deposit(DepositCheckInputs(
        amount=50,
        mandate=mandate,
        vault=vault,
        capacityInputs=CapacityInputs(
            treasury=10000, capMandate=1000, capLiquid=1000, capTier=1000, capHealth=1000,
            capacityCapOnChain=1000, healthMultiplierBps=10000, exposure=0,
        ),
        liquidAfter=9950, reserveAmt=0, dailyActionsSoFar=0, evidenceFresh=True,
        adverseClaimPresent=False, ungroundedClaimPresent=False,
        now=1000, mandateExpiry=9999999999, paused=False,
        tierMaxTx=1000, tierActionsPerDay=100,
    ))
    assert result.verdict == REFUSE


def test_tier_promotion_predicate_one_field_short_of_every_condition_fails():
    now = 1000
    state = initial_tier_state(now, 0)
    check = check_promotion(state, now + 1, DEMO_TIME_UNIT_SECONDS, False, False, False)
    assert check.eligible is False
    assert "minDwell" in check.failedConditions


def test_tier_promotion_predicate_all_six_conditions_met_at_exact_boundary():
    t0 = TIER_SCHEDULE[0]
    entered_at = 0
    state = initial_tier_state(entered_at, 0)
    dwell_seconds = t0.minDwellUnits * DEMO_TIME_UNIT_SECONDS
    state = record_exposure(state, entered_at, (t0.maxVault * t0.peakRequiredBps) // 10000)
    state.riskAcc = t0.minRiskUnits * DEMO_TIME_UNIT_SECONDS
    for _ in range(t0.minReceipts):
        state = record_receipt(state)

    check = check_promotion(state, entered_at + dwell_seconds, DEMO_TIME_UNIT_SECONDS, False, False, False)
    assert check.eligible is True


def test_tier_limits_for_fails_closed_on_out_of_range_tier():
    with pytest.raises(ValueError, match="no such tier 4"):
        tier_limits_for(4)
    with pytest.raises(ValueError, match="no such tier -1"):
        tier_limits_for(-1)
    tier_limits_for(0)
    tier_limits_for(len(TIER_SCHEDULE) - 1)
