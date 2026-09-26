// Generates tier promotion-predicate fixtures (all-met + one-condition-short, per tier)
// and incident/demotion fixtures (each incident type from each tier). Numeric boundaries
// are computed here from TIER_SCHEDULE so they stay correct if the schedule changes.
import { writeFileSync } from "node:fs";

const TIER_SCHEDULE = [
  { maxVault: 150, minDwellUnits: 10, minRiskUnits: 5, peakRequiredBps: 6000, minReceipts: 10 },
  { maxVault: 400, minDwellUnits: 20, minRiskUnits: 30, peakRequiredBps: 6000, minReceipts: 20 },
  { maxVault: 800, minDwellUnits: 40, minRiskUnits: 100, peakRequiredBps: 6000, minReceipts: 30 },
  { maxVault: 1200, minDwellUnits: 0, minRiskUnits: 0, peakRequiredBps: 0, minReceipts: 0 },
];
const TIME_UNIT = 60;

function peakRequired(t) {
  return Math.floor((TIER_SCHEDULE[t].maxVault * TIER_SCHEDULE[t].peakRequiredBps) / 10000);
}

function baseState(tier, enteredAt) {
  return {
    tier, tierEnteredAt: enteredAt, riskAcc: "0", peakExposure: "0",
    receiptsSinceEntry: 0, incidentCount: 0, lastIncidentAt: 0,
    lastExposure: "0", lastTs: enteredAt, incidentsSinceEntry: 0,
  };
}

const promotionCases = [];
for (let tier = 0; tier < 3; tier++) {
  const sched = TIER_SCHEDULE[tier];
  const enteredAt = 0;
  const dwellSeconds = sched.minDwellUnits * TIME_UNIT;
  const riskAccMet = sched.minRiskUnits * TIME_UNIT;
  const peakMet = peakRequired(tier);

  function make(id, overrides, nowOverride) {
    const st = baseState(tier, enteredAt);
    st.riskAcc = String(riskAccMet);
    st.peakExposure = String(peakMet);
    st.receiptsSinceEntry = sched.minReceipts;
    st.lastTs = nowOverride ?? dwellSeconds;
    Object.assign(st, overrides);
    promotionCases.push({
      id: `t${tier}_${id}`, tierState: st, now: nowOverride ?? dwellSeconds,
      timeUnitSeconds: TIME_UNIT, paused: false, mandateExpired: false, evidenceStale: false,
      ...(overrides.__ctx ?? {}),
    });
  }

  make("all_conditions_met_at_exact_boundary", {});
  make("dwell_one_second_short", { lastTs: dwellSeconds - 1 }, dwellSeconds - 1);
  make("risk_one_unit_short", { riskAcc: String(riskAccMet - TIME_UNIT) });
  make("peak_one_short", { peakExposure: String(Math.max(0, peakMet - 1)) });
  make("receipts_one_short", { receiptsSinceEntry: sched.minReceipts - 1 });
  make("incident_since_entry_present", { incidentsSinceEntry: 1 });
  make("paused", { __ctx: { paused: true } });
  make("mandate_expired", { __ctx: { mandateExpired: true } });
  make("evidence_stale", { __ctx: { evidenceStale: true } });
}
// T3: already at max tier, must never promote regardless of state.
promotionCases.push({
  id: "t3_already_at_max_tier", tierState: baseState(3, 0), now: 999999,
  timeUnitSeconds: TIME_UNIT, paused: false, mandateExpired: false, evidenceStale: false,
});

const incidentCases = [];
const incidentTypes = ["LOOSEN_VETOED", "OWNER_PAUSE", "OVERCAP_GRACE_EXCEEDED"];
for (let tier = 0; tier < 4; tier++) {
  for (const incident of incidentTypes) {
    const st = baseState(tier, 0);
    st.riskAcc = "12345";
    st.peakExposure = "678";
    st.receiptsSinceEntry = 7;
    st.incidentCount = 2;
    st.incidentsSinceEntry = 0;
    incidentCases.push({ id: `t${tier}_${incident}`, tierState: st, incident, now: 5000 });
  }
}

writeFileSync("fixtures/differential/tier_promotion_cases.json", JSON.stringify(promotionCases, null, 2) + "\n");
writeFileSync("fixtures/differential/tier_incident_cases.json", JSON.stringify(incidentCases, null, 2) + "\n");
console.log(`wrote ${promotionCases.length} promotion cases, ${incidentCases.length} incident cases`);
