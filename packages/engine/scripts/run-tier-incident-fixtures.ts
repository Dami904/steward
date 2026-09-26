import { readFileSync } from "node:fs";
import { applyIncident } from "../src/tiers.ts";
import type { TierState, IncidentType } from "../src/types.ts";

const fixturesPath = process.argv[2];
if (fixturesPath === undefined) {
  throw new Error("usage: node run-tier-incident-fixtures.ts <fixtures.json>");
}
interface RawTierState {
  tier: number; tierEnteredAt: number; riskAcc: string; peakExposure: string;
  receiptsSinceEntry: number; incidentCount: number; lastIncidentAt: number;
  lastExposure: string; lastTs: number; incidentsSinceEntry: number;
}
interface RawIncidentCase {
  id: string; tierState: RawTierState; incident: string; now: number;
}

const raw: RawIncidentCase[] = JSON.parse(readFileSync(fixturesPath, "utf8"));

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
  const after = applyIncident(toState(c.tierState), c.incident as IncidentType, c.now);
  return {
    id: c.id,
    tier: after.tier,
    tierEnteredAt: after.tierEnteredAt,
    riskAcc: after.riskAcc.toString(),
    peakExposure: after.peakExposure.toString(),
    receiptsSinceEntry: after.receiptsSinceEntry,
    incidentCount: after.incidentCount,
    incidentsSinceEntry: after.incidentsSinceEntry,
    lastIncidentAt: after.lastIncidentAt,
  };
});

console.log(JSON.stringify(results, null, 2));
