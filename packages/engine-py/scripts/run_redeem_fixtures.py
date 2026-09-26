import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.types import VaultReadState
from steward_engine.policy import check_redeem, RedeemCheckInputs


def main():
    fixtures_path = sys.argv[1]
    with open(fixtures_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    results = []
    for c in raw:
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
        result = check_redeem(RedeemCheckInputs(
            shares=int(c["shares"]),
            previewAssets=int(c["previewAssets"]),
            vault=vault,
            dailyActionsSoFar=c["dailyActionsSoFar"],
            maxActionsPerDay=c["maxActionsPerDay"],
        ))
        results.append({"id": c["id"], "verdict": result.verdict, "reasons": str(result.reasons)})

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
