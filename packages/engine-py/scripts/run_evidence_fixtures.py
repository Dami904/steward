"""Differential test harness (Python side). Mirrors
packages/engine/scripts/run-evidence-fixtures.ts field-for-field. spec/evidence.md P-16."""

import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.evidence import (
    RawClaim,
    ground_claims,
    corroborate,
    derive_evidence_flags,
    hash_claim_set,
)


def main():
    fixtures_path = sys.argv[1]
    with open(fixtures_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    results = []
    for c in raw:
        claims_a = [RawClaim(**rc) for rc in c["claimsA"]]
        claims_b = [RawClaim(**rc) for rc in c["claimsB"]]

        grounded_a, ungrounded_count_a = ground_claims(c["sourceText"], claims_a)
        grounded_b, ungrounded_count_b = ground_claims(c["sourceText"], claims_b)
        assessed = corroborate(grounded_a, grounded_b)
        flags = derive_evidence_flags(assessed)
        claim_set_hash = hash_claim_set(assessed)

        corroborated_count = len([a for a in assessed if a.status == "CORROBORATED"])
        single_count = len([a for a in assessed if a.status == "SINGLE"])

        results.append({
            "id": c["id"],
            "groundedCountA": len(grounded_a),
            "groundedCountB": len(grounded_b),
            "ungroundedCountA": ungrounded_count_a,
            "ungroundedCountB": ungrounded_count_b,
            "corroboratedCount": corroborated_count,
            "singleCount": single_count,
            "corroboratedSevereAdverse": flags.corroboratedSevereAdverse,
            "singlePathAdverse": flags.singlePathAdverse,
            "claimSetHash": claim_set_hash,
        })

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
