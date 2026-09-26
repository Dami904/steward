import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.types import Mandate, VaultReadState, ALLOW, REFUSE
from steward_engine.policy import check_deposit, DepositCheckInputs
from steward_engine.accounting import CapacityInputs

# Mirrors packages/engine/test/policy.test.ts exactly. See that file's header for why this
# guard (ADVERSE_CLAIM/UNGROUNDED_CLAIM must never force REFUSE alone) needed a direct test
# independent of the TS/Python differential fixtures.

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


def test_adverse_claim_present_alone_with_headroom_still_covering_amount_allows():
    result = check_deposit(DepositCheckInputs(
        amount=100,
        mandate=mandate,
        vault=vault,
        capacityInputs=CapacityInputs(
            treasury=10000, capMandate=1000, capLiquid=1000, capTier=1000, capHealth=1000,
            capacityCapOnChain=1000, healthMultiplierBps=10000, exposure=0,
        ),
        liquidAfter=9900, reserveAmt=0, dailyActionsSoFar=0, evidenceFresh=True,
        adverseClaimPresent=True, ungroundedClaimPresent=False,
        now=1000, mandateExpiry=9999999999, paused=False,
        tierMaxTx=1000, tierActionsPerDay=100,
    ))
    assert result.verdict == ALLOW


def test_ungrounded_claim_present_alone_allows():
    result = check_deposit(DepositCheckInputs(
        amount=100,
        mandate=mandate,
        vault=vault,
        capacityInputs=CapacityInputs(
            treasury=10000, capMandate=1000, capLiquid=1000, capTier=1000, capHealth=1000,
            capacityCapOnChain=1000, healthMultiplierBps=10000, exposure=0,
        ),
        liquidAfter=9900, reserveAmt=0, dailyActionsSoFar=0, evidenceFresh=True,
        adverseClaimPresent=False, ungroundedClaimPresent=True,
        now=1000, mandateExpiry=9999999999, paused=False,
        tierMaxTx=1000, tierActionsPerDay=100,
    ))
    assert result.verdict == ALLOW


def test_adverse_claim_reason_bit_present_on_allow_receipt():
    result = check_deposit(DepositCheckInputs(
        amount=100,
        mandate=mandate,
        vault=vault,
        capacityInputs=CapacityInputs(
            treasury=10000, capMandate=1000, capLiquid=1000, capTier=1000, capHealth=1000,
            capacityCapOnChain=1000, healthMultiplierBps=10000, exposure=0,
        ),
        liquidAfter=9900, reserveAmt=0, dailyActionsSoFar=0, evidenceFresh=True,
        adverseClaimPresent=True, ungroundedClaimPresent=False,
        now=1000, mandateExpiry=9999999999, paused=False,
        tierMaxTx=1000, tierActionsPerDay=100,
    ))
    ADVERSE_CLAIM_BIT = 12
    assert (result.reasons & (1 << ADVERSE_CLAIM_BIT)) != 0


def test_adverse_claim_that_reduces_capacity_via_health_multiplier_still_refuses():
    result = check_deposit(DepositCheckInputs(
        amount=100,
        mandate=mandate,
        vault=vault,
        capacityInputs=CapacityInputs(
            treasury=10000, capMandate=50, capLiquid=50, capTier=50, capHealth=50,
            capacityCapOnChain=50, healthMultiplierBps=5000, exposure=0,
        ),
        liquidAfter=9900, reserveAmt=0, dailyActionsSoFar=0, evidenceFresh=True,
        adverseClaimPresent=True, ungroundedClaimPresent=False,
        now=1000, mandateExpiry=9999999999, paused=False,
        tierMaxTx=1000, tierActionsPerDay=100,
    ))
    assert result.verdict == REFUSE


# Mirrors the tier-limit tests in packages/engine/test/policy.test.ts: the contract caps a
# deposit at min(tier maxTx, mandate maxTxUsdc) and daily actions at
# min(tier actionsPerDay, mandate maxActionsPerDay); the engine once checked only the mandate.
from dataclasses import replace
from steward_engine.types import OVER_MAX_TX, RATE_LIMIT


def _tier_case(amount, tierMaxTx, tierActionsPerDay, dailyActionsSoFar=0, mandateMaxTx=1000, mandateActions=100):
    return check_deposit(DepositCheckInputs(
        amount=amount,
        mandate=replace(mandate, maxTxUsdc=mandateMaxTx, maxActionsPerDay=mandateActions),
        vault=vault,
        capacityInputs=CapacityInputs(
            treasury=10000, capMandate=1000, capLiquid=1000, capTier=1000, capHealth=1000,
            capacityCapOnChain=1000, healthMultiplierBps=10000, exposure=0,
        ),
        liquidAfter=9900, reserveAmt=0, dailyActionsSoFar=dailyActionsSoFar, evidenceFresh=True,
        adverseClaimPresent=False, ungroundedClaimPresent=False,
        now=1000, mandateExpiry=9999999999, paused=False,
        tierMaxTx=tierMaxTx, tierActionsPerDay=tierActionsPerDay,
    ))


def _has(mask, bit):
    return (mask >> bit) & 1 == 1


def test_tier_max_tx_caps_deposit_even_when_mandate_allows_more():
    r = _tier_case(150, tierMaxTx=120, tierActionsPerDay=100)
    assert r.verdict == REFUSE
    assert _has(r.reasons, OVER_MAX_TX)


def test_exactly_tier_max_tx_is_allowed():
    assert _tier_case(120, tierMaxTx=120, tierActionsPerDay=100).verdict == ALLOW


def test_mandate_tighter_than_tier_still_binds():
    assert _has(_tier_case(250, tierMaxTx=300, tierActionsPerDay=100, mandateMaxTx=200).reasons, OVER_MAX_TX)


def test_tier_actions_per_day_rate_limits_even_when_mandate_allows_more():
    r = _tier_case(100, tierMaxTx=1000, tierActionsPerDay=4, dailyActionsSoFar=4)
    assert r.verdict == REFUSE
    assert _has(r.reasons, RATE_LIMIT)
    assert _tier_case(100, tierMaxTx=1000, tierActionsPerDay=4, dailyActionsSoFar=3).verdict == ALLOW
