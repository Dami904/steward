// spec/tiers.md sections 2-6. Pure functions over TierState.

import { TIER_SCHEDULE, type TierState, type TierLimits, type IncidentType } from "./types.ts";

const BPS = 10000n;

export function accrueRisk(state: TierState, now: number): TierState {
  const dt = BigInt(Math.max(0, now - state.lastTs));
  return {
    ...state,
    riskAcc: state.riskAcc + state.lastExposure * dt,
    lastTs: now,
  };
}

export function recordExposure(state: TierState, now: number, exposure: bigint): TierState {
  const accrued = accrueRisk(state, now);
  const peak = exposure > accrued.peakExposure ? exposure : accrued.peakExposure;
  return { ...accrued, lastExposure: exposure, peakExposure: peak };
}

export function recordReceipt(state: TierState): TierState {
  return { ...state, receiptsSinceEntry: state.receiptsSinceEntry + 1 };
}

export interface PromotionCheck {
  eligible: boolean;
  failedConditions: string[];
}

// spec/tiers.md section 3. Six conditions, all must hold.
export function checkPromotion(
  state: TierState,
  now: number,
  timeUnitSeconds: number,
  opts: { paused: boolean; mandateExpired: boolean; evidenceStale: boolean },
): PromotionCheck {
  const failed: string[] = [];
  if (state.tier >= TIER_SCHEDULE.length - 1) {
    return { eligible: false, failedConditions: ["already at max tier"] };
  }
  const limits: TierLimits = tierLimitsFor(state.tier);
  const accrued = accrueRisk(state, now);

  const dwellOk = now - state.tierEnteredAt >= limits.minDwellUnits * timeUnitSeconds;
  if (!dwellOk) failed.push("minDwell");

  const riskUnits = accrued.riskAcc / BigInt(timeUnitSeconds);
  const riskOk = riskUnits >= limits.minRiskUnits;
  if (!riskOk) failed.push("minRiskUnits");

  const peakRequired = (limits.maxVault * limits.peakRequiredBps) / BPS;
  const peakOk = accrued.peakExposure >= peakRequired;
  if (!peakOk) failed.push("peakRequired");

  const receiptsOk = state.receiptsSinceEntry >= limits.minReceipts;
  if (!receiptsOk) failed.push("minReceipts");

  const noIncidentsOk = state.incidentsSinceEntry === 0;
  if (!noIncidentsOk) failed.push("incidentsSinceEntry");

  if (opts.paused) failed.push("paused");
  if (opts.mandateExpired) failed.push("mandateExpired");
  if (opts.evidenceStale) failed.push("evidenceStale");

  return { eligible: failed.length === 0, failedConditions: failed };
}

// Caller must have already validated checkPromotion(...).eligible with the real
// timeUnitSeconds/opts; this function only performs the state transition (mirrors the
// on-chain graduate() which trusts its own predicate check, not a second one here).
export function graduate(state: TierState, now: number): TierState {
  return {
    tier: state.tier + 1,
    tierEnteredAt: now,
    riskAcc: 0n,
    peakExposure: 0n,
    receiptsSinceEntry: 0,
    incidentCount: state.incidentCount,
    lastIncidentAt: state.lastIncidentAt,
    lastExposure: state.lastExposure,
    lastTs: now,
    incidentsSinceEntry: 0,
  };
}

// spec/tiers.md section 4
export function applyIncident(state: TierState, incident: IncidentType, now: number): TierState {
  const base = {
    ...state,
    incidentCount: state.incidentCount + 1,
    incidentsSinceEntry: state.incidentsSinceEntry + 1,
    lastIncidentAt: now,
  };
  switch (incident) {
    case "LOOSEN_VETOED":
      return demoteOneTier(base, now);
    case "OWNER_PAUSE":
    case "OVERCAP_GRACE_EXCEEDED":
      return demoteToZero(base, now);
  }
}

function demoteOneTier(state: TierState, now: number): TierState {
  const newTier = Math.max(0, state.tier - 1);
  return { ...state, tier: newTier, tierEnteredAt: now, riskAcc: 0n, peakExposure: 0n, receiptsSinceEntry: 0, incidentsSinceEntry: 0 };
}

function demoteToZero(state: TierState, now: number): TierState {
  return { ...state, tier: 0, tierEnteredAt: now, riskAcc: 0n, peakExposure: 0n, receiptsSinceEntry: 0, incidentsSinceEntry: 0 };
}

// onchain-access-control skill, check 1: an out-of-range key must fail closed, never
// silently resolve to `undefined` (which a caller could then misuse in a min()/comparison
// and end up ALLOW-ing something by accident).
export function tierLimitsFor(tier: number): TierLimits {
  const limits = TIER_SCHEDULE[tier];
  if (limits === undefined) {
    throw new Error(`tierLimitsFor: no such tier ${tier} (schedule has 0..${TIER_SCHEDULE.length - 1})`);
  }
  return limits;
}
