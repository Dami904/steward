import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.types import TierState
from steward_engine.tiers import check_promotion


def to_state(s):
    return TierState(
        tier=s["tier"],
        tierEnteredAt=s["tierEnteredAt"],
        riskAcc=int(s["riskAcc"]),
        peakExposure=int(s["peakExposure"]),
        receiptsSinceEntry=s["receiptsSinceEntry"],
        incidentCount=s["incidentCount"],
        lastIncidentAt=s["lastIncidentAt"],
        lastExposure=int(s["lastExposure"]),
        lastTs=s["lastTs"],
        incidentsSinceEntry=s["incidentsSinceEntry"],
    )


def main():
    fixtures_path = sys.argv[1]
    with open(fixtures_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    results = []
    for c in raw:
        check = check_promotion(
            to_state(c["tierState"]), c["now"], c["timeUnitSeconds"],
            c["paused"], c["mandateExpired"], c["evidenceStale"],
        )
        results.append({
            "id": c["id"],
            "eligible": check.eligible,
            "failedConditions": sorted(check.failedConditions),
        })

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
