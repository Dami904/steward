"""Differential test harness (Python side). Mirrors
packages/engine/scripts/run-deposit-fixtures.ts field-for-field. spec/accounting.md P-08."""

import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.types import Mandate, VaultReadState
from steward_engine.accounting import CapacityInputs
from steward_engine.policy import check_deposit, DepositCheckInputs


def main():
    fixtures_path = sys.argv[1]
    with open(fixtures_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    results = []
    for c in raw:
        m = c["mandate"]
        mandate = Mandate(
            maxTxUsdc=int(m["maxTxUsdc"]),
            maxBps=int(m["maxBps"]),
            maxVaultUsdc=int(m["maxVaultUsdc"]),
            minLiquidUsdc=int(m["minLiquidUsdc"]),
            maxActionsPerDay=m["maxActionsPerDay"],
            expiry=m["expiry"],
            loosenDelay=m["loosenDelay"],
            feeBps=int(m["feeBps"]),
            maxFeeBps=int(m["maxFeeBps"]),
            operator=m["operator"],
            issuerHaircutBps=int(m["issuerHaircutBps"]),
            latencyHaircutBpsPerDay=int(m["latencyHaircutBpsPerDay"]),
            latencyHaircutMaxBps=int(m["latencyHaircutMaxBps"]),
            leadFloorDays=m["leadFloorDays"],
            latencySafety=m["latencySafety"],
            bufferDays=m["bufferDays"],
            approvalAbove=int(m["approvalAbove"]),
        )
        v = c["vault"]
        vault = VaultReadState(
            navPerShare=int(v["navPerShare"]),
            shares=int(v["shares"]),
            liquid=int(v["liquid"]),
            finalizedNotYetClaimed=int(v["finalizedNotYetClaimed"]),
            pendingRedemptionExpectedHaircut=int(v["pendingRedemptionExpectedHaircut"]),
            minDepositAssets=int(v["minDepositAssets"]),
            minRedeemAssets=int(v["minRedeemAssets"]),
            paused=v["paused"],
            codehash=v["codehash"],
            expectedCodehash=v["expectedCodehash"],
        )
        ci = c["capacityInputs"]
        capacity_inputs = CapacityInputs(
            treasury=int(ci["treasury"]),
            capMandate=int(ci["capMandate"]),
            capLiquid=int(ci["capLiquid"]),
            capTier=int(ci["capTier"]),
            capHealth=int(ci["capHealth"]),
            capacityCapOnChain=int(ci["capacityCapOnChain"]),
            healthMultiplierBps=int(ci["healthMultiplierBps"]),
            exposure=int(ci["exposure"]),
        )

        result = check_deposit(DepositCheckInputs(
            amount=int(c["amount"]),
            mandate=mandate,
            vault=vault,
            capacityInputs=capacity_inputs,
            liquidAfter=int(c["liquidAfter"]),
            reserveAmt=int(c["reserveAmt"]),
            dailyActionsSoFar=c["dailyActionsSoFar"],
            evidenceFresh=c["evidenceFresh"],
            adverseClaimPresent=c["adverseClaimPresent"],
            ungroundedClaimPresent=c["ungroundedClaimPresent"],
            now=c["now"],
            mandateExpiry=c["mandateExpiry"],
            paused=c["paused"],
        ))

        results.append({
            "id": c["id"],
            "verdict": result.verdict,
            "reasons": str(result.reasons),
            "capacity": str(result.capacity),
            "headroom": str(result.headroom),
            "overCap": str(result.overCap),
            "bindingTerm": result.bindingTerm,
        })

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
