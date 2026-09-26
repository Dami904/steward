// spec/accounting.md sections 2-4. Pure functions, integer-only, rounding rules as specified.

import type { Mandate, EvidenceState } from "./types.ts";

const BPS = 10000n;

export function floorDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("division by zero");
  if ((a < 0n) !== (b < 0n) && a % b !== 0n) return a / b - 1n;
  return a / b;
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("division by zero");
  return floorDiv(a + b - 1n, b);
}

// spec/accounting.md section 2
export function recognisedPositionValue(
  shares: bigint,
  navPerShare: bigint,
  navScale: bigint,
  issuerHaircutBps: bigint,
  latencyHaircutBps: bigint,
): bigint {
  const navMark = floorDiv(shares * navPerShare, navScale);
  const num = navMark * (BPS - issuerHaircutBps) * (BPS - latencyHaircutBps);
  return floorDiv(num, BPS * BPS);
}

// spec/accounting.md section 2: h_latency
export function latencyHaircutBps(mandate: Mandate, effLeadDays: number): bigint {
  const grown = mandate.latencyHaircutBpsPerDay * BigInt(effLeadDays);
  return grown < mandate.latencyHaircutMaxBps ? grown : mandate.latencyHaircutMaxBps;
}

// spec/accounting.md section 3: effLeadDays from q90 latency (in days) over redemption history.
// q90DaysOrNull is null when n === 0 (no history at all -> mandate constant).
export function effectiveLeadDays(
  mandate: Mandate,
  q90Days: number | null,
  sampleCount: number,
  maxObservedDays: number | null,
): number {
  if (sampleCount >= 5 && q90Days !== null) {
    return Math.max(mandate.leadFloorDays, Math.ceil(q90Days * mandate.latencySafety));
  }
  if (sampleCount >= 1 && maxObservedDays !== null) {
    return Math.max(mandate.leadFloorDays, Math.ceil(maxObservedDays * 2 * mandate.latencySafety));
  }
  return mandate.leadFloorDays;
}

export interface Obligation {
  due: number; // unix seconds
  amount: bigint;
}

// spec/accounting.md section 3: reserve, rounded up (already integer here; kept as a named
// pass-through so the rounding-direction decision is visible at the call site).
export function reserve(minLiquid: bigint, obligations: Obligation[], now: number, effLeadDays: number, bufferDays: number): bigint {
  const cutoff = now + effLeadDays * 86400 + bufferDays * 86400;
  let sum = 0n;
  for (const o of obligations) {
    if (o.due < cutoff) sum += o.amount;
  }
  return minLiquid + sum;
}

export type HealthMultiplier = 0n | 5000n | 10000n; // represented in bps-of-1 (0, 0.5, 1) as 0/5000/10000 out of 10000

export function evidenceHealthMultiplierBps(evidence: EvidenceState, effLeadDays: number): HealthMultiplier {
  if (
    evidence.stale ||
    evidence.corroboratedSevereAdverse ||
    evidence.drawdownBps >= evidence.drawdownPauseThresholdBps
  ) {
    return 0n;
  }
  const halfThreshold = evidence.drawdownPauseThresholdBps / 2n;
  if (
    evidence.singlePathAdverse ||
    evidence.observedLatencyDays > effLeadDays ||
    evidence.drawdownBps >= halfThreshold
  ) {
    return 5000n;
  }
  return 10000n;
}

export interface CapacityInputs {
  treasury: bigint;
  capMandate: bigint;
  capLiquid: bigint;
  capTier: bigint;
  capHealth: bigint;
  capacityCapOnChain: bigint;
  healthMultiplierBps: HealthMultiplier;
  exposure: bigint;
}

export interface CapacityResult {
  capacity: bigint;
  headroom: bigint;
  overCap: bigint;
  bindingIndex: number; // 0=capMandate 1=capLiquid 2=capTier 3=capHealth 4=capacityCapOnChain
}

// spec/accounting.md section 4
export function computeCapacity(inputs: CapacityInputs): CapacityResult {
  const caps: [bigint, number][] = [
    [inputs.capMandate, 0],
    [inputs.capLiquid, 1],
    [inputs.capTier, 2],
    [inputs.capHealth, 3],
    [inputs.capacityCapOnChain, 4],
  ];
  let min = inputs.capMandate;
  let bindingIndex = 0;
  for (const [v, idx] of caps) {
    if (v < min) {
      min = v;
      bindingIndex = idx;
    }
  }
  const capacity = floorDiv(min * inputs.healthMultiplierBps, BPS);
  const headroom = capacity > inputs.exposure ? capacity - inputs.exposure : 0n;
  const overCap = inputs.exposure > capacity ? inputs.exposure - capacity : 0n;
  return { capacity, headroom, overCap, bindingIndex };
}

export function capMandate(mandate: Mandate, treasury: bigint): bigint {
  const byBps = floorDiv(mandate.maxBps * treasury, BPS);
  return byBps < mandate.maxVaultUsdc ? byBps : mandate.maxVaultUsdc;
}

export function capLiquid(treasury: bigint, reserveAmt: bigint): bigint {
  return treasury > reserveAmt ? treasury - reserveAmt : 0n;
}
