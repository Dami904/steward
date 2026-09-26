import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.types import TierState
from steward_engine.tiers import apply_incident


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
        after = apply_incident(to_state(c["tierState"]), c["incident"], c["now"])
        results.append({
            "id": c["id"],
            "tier": after.tier,
            "tierEnteredAt": after.tierEnteredAt,
            "riskAcc": str(after.riskAcc),
            "peakExposure": str(after.peakExposure),
            "receiptsSinceEntry": after.receiptsSinceEntry,
            "incidentCount": after.incidentCount,
            "incidentsSinceEntry": after.incidentsSinceEntry,
            "lastIncidentAt": after.lastIncidentAt,
        })

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
