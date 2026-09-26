// Types for the deterministic policy engine.
// Canonical encoding, field order, and formulas: see /spec/accounting.md, /spec/tiers.md,
// /spec/health.md. This file has no logic — only shapes shared with packages/engine-py.

export type Action = "DEPOSIT" | "REDEEM" | "HOLD";

// Node's --experimental-strip-types mode only erases type syntax; it does not compile
// TS `enum` (which emits runtime code). Every enum in this file is a plain `as const`
// object instead, so packages/engine can run unbuilt. Values/order are still the
// canonical encoding other implementations must match.
export const Verdict = {
  ALLOW: 0,
  ALLOW_CLAMPED: 1,
  NEEDS_APPROVAL: 2,
  REFUSE: 3,
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

// Bit positions fixed by spec/accounting.md section 5. Do not reorder.
export const ReasonBit = {
  OK: 0,
  HOLD_NOOP: 1,
  MANDATE_INVALID: 2,
  MANDATE_EXPIRED: 3,
  AGENT_MISMATCH: 4,
  TARGET_NOT_ALLOWED: 5,
  OVER_CAPACITY: 6,
  OVER_MAX_TX: 7,
  BELOW_RESERVE: 8,
  STALE_EVIDENCE: 9,
  CODEHASH_CHANGED: 10,
  DRAWDOWN_PAUSE: 11,
  ADVERSE_CLAIM: 12,
  UNGROUNDED_CLAIM: 13,
  RATE_LIMIT: 14,
  ABOVE_APPROVAL_THRESHOLD: 15,
  HARD_CAP: 16,
  PROPOSAL_INVALID: 17,
  MODEL_FAILED_OUTPUT: 18,
  OWNER_PAUSED: 19,
  MANDATORY_DERISK: 20,
} as const;
export type ReasonBit = (typeof ReasonBit)[keyof typeof ReasonBit];

export function reasonMask(bits: ReasonBit[]): bigint {
  let mask = 0n;
  for (const bit of bits) mask |= 1n << BigInt(bit);
  return mask;
}

// spec/accounting.md section 4 / spec/tiers.md section 5
export const CapacityBindingTerm = {
  capMandate: 0,
  capLiquid: 1,
  capTier: 2,
  capHealth: 3,
  capacityCapOnChain: 4,
} as const;
export type CapacityBindingTerm = (typeof CapacityBindingTerm)[keyof typeof CapacityBindingTerm];

export interface Mandate {
  maxTxUsdc: bigint;
  maxBps: bigint; // out of 10000
  maxVaultUsdc: bigint;
  minLiquidUsdc: bigint;
  maxActionsPerDay: number;
  expiry: number; // unix seconds
  loosenDelay: number;
  feeBps: bigint;
  maxFeeBps: bigint;
  operator: string;
  issuerHaircutBps: bigint;
  latencyHaircutBpsPerDay: bigint;
  latencyHaircutMaxBps: bigint;
  leadFloorDays: number;
  latencySafety: number; // multiplier, e.g. 1.5
  bufferDays: number;
  approvalAbove: bigint;
}

export interface VaultReadState {
  navPerShare: bigint; // 18-decimal fixed point
  shares: bigint;
  liquid: bigint;
  finalizedNotYetClaimed: bigint;
  pendingRedemptionExpectedHaircut: bigint;
  minDepositAssets: bigint;
  minRedeemAssets: bigint;
  paused: boolean;
  codehash: string;
  expectedCodehash: string;
}

export interface EvidenceState {
  stale: boolean;
  corroboratedSevereAdverse: boolean;
  singlePathAdverse: boolean;
  observedLatencyDays: number;
  drawdownBps: bigint;
  drawdownPauseThresholdBps: bigint;
}

// spec/tiers.md section 1
export interface TierLimits {
  maxTx: bigint;
  maxVault: bigint;
  maxBps: bigint;
  approvalAbove: bigint;
  actionsPerDay: number;
  minDwellUnits: number;
  minRiskUnits: bigint;
  peakRequiredBps: bigint; // fraction of maxVault, out of 10000
  minReceipts: number;
}

export const TIER_SCHEDULE: TierLimits[] = [
  { maxTx: 120n, maxVault: 150n, maxBps: 1000n, approvalAbove: 60n, actionsPerDay: 4, minDwellUnits: 10, minRiskUnits: 5n, peakRequiredBps: 6000n, minReceipts: 10 },
  { maxTx: 300n, maxVault: 400n, maxBps: 2500n, approvalAbove: 150n, actionsPerDay: 8, minDwellUnits: 20, minRiskUnits: 30n, peakRequiredBps: 6000n, minReceipts: 20 },
  { maxTx: 600n, maxVault: 800n, maxBps: 4000n, approvalAbove: 300n, actionsPerDay: 12, minDwellUnits: 40, minRiskUnits: 100n, peakRequiredBps: 6000n, minReceipts: 30 },
  { maxTx: 1000n, maxVault: 1200n, maxBps: 6000n, approvalAbove: 500n, actionsPerDay: 24, minDwellUnits: 0, minRiskUnits: 0n, peakRequiredBps: 0n, minReceipts: 0 },
];

export const HARD_CAP = 1200n;
export const DEMO_TIME_UNIT_SECONDS = 60;
export const PRODUCTION_TIME_UNIT_SECONDS = 86400;

// spec/tiers.md section 2
export interface TierState {
  tier: number; // 0..3
  tierEnteredAt: number;
  riskAcc: bigint;
  peakExposure: bigint;
  receiptsSinceEntry: number;
  incidentCount: number;
  lastIncidentAt: number;
  lastExposure: bigint;
  lastTs: number;
  incidentsSinceEntry: number;
}

export function initialTierState(now: number, startTier = 0): TierState {
  return {
    tier: startTier,
    tierEnteredAt: now,
    riskAcc: 0n,
    peakExposure: 0n,
    receiptsSinceEntry: 0,
    incidentCount: 0,
    lastIncidentAt: 0,
    lastExposure: 0n,
    lastTs: now,
    incidentsSinceEntry: 0,
  };
}

export type IncidentType = "LOOSEN_VETOED" | "OWNER_PAUSE" | "OVERCAP_GRACE_EXCEEDED";

// spec/health.md section 2-3
export const HealthMethod = {
  REQUEST_FINALIZE_VIEW: 0,
  FULFILL_EVENT: 1,
  CLAIM_EVENT: 2,
  OWN_REQUESTS: 3,
  DOC_CONSTANT: 4,
} as const;
export type HealthMethod = (typeof HealthMethod)[keyof typeof HealthMethod];

export const HealthFlag = {
  PAUSED: 1,
  CODEHASH_CHANGED: 2,
  NAV_STALE: 4,
} as const;
export type HealthFlag = (typeof HealthFlag)[keyof typeof HealthFlag];

export interface RedeemRequestRecord {
  id: number;
  owner: string;
  receiver: string;
  shares: bigint;
  requestedAt: number;
  processedAt: number;
  status: "None" | "Pending" | "Finalized" | "Rejected";
}

export interface HealthSnapshot {
  fromBlock: number;
  toBlock: number;
  ts: number;
  method: HealthMethod;
  n: number;
  p50Sec: number;
  p90Sec: number;
  maxSec: number;
  navPerShare: bigint;
  drawdownBps: bigint;
  codehash: string;
  flags: number;
  evidenceHash: string;
}

export interface PolicyResult {
  verdict: Verdict;
  reasons: bigint;
  capacity: bigint;
  headroom: bigint;
  overCap: bigint;
  bindingTerm: CapacityBindingTerm;
}
