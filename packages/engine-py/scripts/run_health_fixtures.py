import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.types import RedeemRequestRecord
from steward_engine.health import build_request_finalize_snapshot


def main():
    fixtures_path = sys.argv[1]
    with open(fixtures_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    results = []
    for c in raw:
        records = [
            RedeemRequestRecord(
                id=r["id"], owner=r["owner"], receiver=r["receiver"],
                shares=int(r["shares"]), requestedAt=r["requestedAt"],
                processedAt=r["processedAt"], status=r["status"],
            )
            for r in c["records"]
        ]
        snap = build_request_finalize_snapshot(
            records, c["atBlock"], c["ts"], int(c["navPerShare"]), int(c["drawdownBps"]),
            c["codehash"], c["expectedCodehash"], c["navStale"], c["paused"],
        )
        results.append({
            "id": c["id"],
            "method": snap.method,
            "n": snap.n,
            "p50Sec": snap.p50Sec,
            "p90Sec": snap.p90Sec,
            "maxSec": snap.maxSec,
            "flags": snap.flags,
            "evidenceHash": snap.evidenceHash,
        })

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()


