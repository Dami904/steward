import { readFileSync } from "node:fs";
import { checkPromotion } from "../src/tiers.ts";
import type { TierState } from "../src/types.ts";

const fixturesPath = process.argv[2];
if (fixturesPath === undefined) {
  throw new Error("usage: node run-tier-promotion-fixtures.ts <fixtures.json>");
}
interface RawTierState {
  tier: number; tierEnteredAt: number; riskAcc: string; peakExposure: string;
  receiptsSinceEntry: number; incidentCount: number; lastIncidentAt: number;
  lastExposure: string; lastTs: number; incidentsSinceEntry: number;
}
interface RawPromotionCase {
  id: string; tierState: RawTierState; now: number; timeUnitSeconds: number;
  paused: boolean; mandateExpired: boolean; evidenceStale: boolean;
}

const raw: RawPromotionCase[] = JSON.parse(readFileSync(fixturesPath, "utf8"));

function bi(v: string): bigint {
  return BigInt(v);
}

function toState(s: RawTierState): TierState {
  return {
    tier: s.tier,
    tierEnteredAt: s.tierEnteredAt,
    riskAcc: bi(s.riskAcc),
    peakExposure: bi(s.peakExposure),
    receiptsSinceEntry: s.receiptsSinceEntry,
    incidentCount: s.incidentCount,
    lastIncidentAt: s.lastIncidentAt,
    lastExposure: bi(s.lastExposure),
    lastTs: s.lastTs,
    incidentsSinceEntry: s.incidentsSinceEntry,
  };
}

const results = raw.map((c) => {
  const check = checkPromotion(toState(c.tierState), c.now, c.timeUnitSeconds, {
    paused: c.paused,
    mandateExpired: c.mandateExpired,
    evidenceStale: c.evidenceStale,
  });
  return { id: c.id, eligible: check.eligible, failedConditions: [...check.failedConditions].sort() };
});

console.log(JSON.stringify(results, null, 2));
