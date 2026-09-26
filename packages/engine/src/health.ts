// spec/health.md. Pure functions: build a HealthSnapshot from raw redemption request records,
// and derive the tighten-only healthCap consumed by spec/accounting.md's capacity formula.

import { createHash } from "node:crypto";
import { HealthMethod, HealthFlag, type RedeemRequestRecord, type HealthSnapshot } from "./types.ts";

function percentile(sortedSecs: number[], p: number): number {
  if (sortedSecs.length === 0) return 0;
  const idx = Math.min(sortedSecs.length - 1, Math.ceil((p / 100) * sortedSecs.length) - 1);
  const value = sortedSecs[Math.max(0, idx)];
  // idx is clamped into [0, length - 1] just above, so this is always defined; the check
  // exists only to satisfy noUncheckedIndexedAccess without silently coercing to 0 on a
  // future refactor that breaks that invariant.
  if (value === undefined) throw new Error("percentile: index computation out of bounds");
  return value;
}

// spec/health.md section 2: REQUEST_FINALIZE_VIEW method.
export function buildRequestFinalizeSnapshot(
  records: RedeemRequestRecord[],
  atBlock: number,
  ts: number,
  navPerShare: bigint,
  drawdownBps: bigint,
  codehash: string,
  expectedCodehash: string,
  navStale: boolean,
  paused: boolean,
): HealthSnapshot {
  const finalized = records.filter((r) => r.status === "Finalized" && r.processedAt > 0);
  const latenciesSec = finalized
    .map((r) => r.processedAt - r.requestedAt)
    .sort((a, b) => a - b);

  const n = latenciesSec.length;
  const p50Sec = percentile(latenciesSec, 50);
  const p90Sec = percentile(latenciesSec, 90);
  const lastLatency = latenciesSec[n - 1];
  const maxSec = n > 0 && lastLatency !== undefined ? lastLatency : 0;

  let flags = 0;
  if (paused) flags |= HealthFlag.PAUSED;
  if (codehash.toLowerCase() !== expectedCodehash.toLowerCase()) flags |= HealthFlag.CODEHASH_CHANGED;
  if (navStale) flags |= HealthFlag.NAV_STALE;

  const evidenceHash = hashEvidence(records);

  return {
    fromBlock: atBlock,
    toBlock: atBlock,
    ts,
    method: HealthMethod.REQUEST_FINALIZE_VIEW,
    n,
    p50Sec,
    p90Sec,
    maxSec,
    navPerShare,
    drawdownBps,
    codehash,
    flags,
    evidenceHash,
  };
}

// Canonical serialization for evidenceHash: sorted by id, fixed field order, joined, sha256.
// spec/health.md section 7, P-14b: TS and Python must produce byte-identical hashes for the
// same input.
export function hashEvidence(records: RedeemRequestRecord[]): string {
  const sorted = [...records].sort((a, b) => a.id - b.id);
  const canonical = sorted
    .map((r) => `${r.id}|${r.owner.toLowerCase()}|${r.receiver.toLowerCase()}|${r.shares.toString()}|${r.requestedAt}|${r.processedAt}|${r.status}`)
    .join("\n");
  return "0x" + createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface HealthCapInputs {
  snapshot: HealthSnapshot;
  nowTs: number;
  maxStaleSec: number;
  mandateLeadTimeSec: number;
  drawdownPauseThresholdBps: bigint;
  capMandate: bigint;
}

// spec/health.md section 4: tighten-only consumption. Never raises anything (invariant O-13).
export function deriveHealthCap(inputs: HealthCapInputs): bigint {
  const { snapshot, nowTs, maxStaleSec, mandateLeadTimeSec, drawdownPauseThresholdBps, capMandate } = inputs;

  // onchain-access-control skill, check 1 (default-deny): a vault nothing has ever been
  // published for must resolve to stale/denied explicitly (ts === 0), not by accident of
  // nowTs happening to be large enough that `nowTs - 0 > maxStaleSec` on its own — that
  // would make the fail-closed property depend on absolute clock magnitude rather than
  // being true by construction. Mirrored in Solidity's HealthMath.deriveHealthCap and
  // Python's deriveHealthCap for three-way parity (P-08).
  // A future-dated snapshot.ts (never legitimate) is also treated as stale explicitly,
  // matching Solidity where the same check additionally avoids an unsigned-subtraction
  // underflow — parity kept here even though JS has no such underflow risk.
  const stale = snapshot.ts === 0 || snapshot.ts > nowTs || nowTs - snapshot.ts > maxStaleSec;
  const hardStop =
    stale ||
    (snapshot.flags & HealthFlag.PAUSED) !== 0 ||
    (snapshot.flags & HealthFlag.CODEHASH_CHANGED) !== 0;
  if (hardStop) return 0n;

  const halfPauseThreshold = drawdownPauseThresholdBps / 2n;
  const p90ExceedsMandate = snapshot.p90Sec > mandateLeadTimeSec;
  const drawdownElevated = snapshot.drawdownBps >= halfPauseThreshold;
  if (p90ExceedsMandate || drawdownElevated) {
    return capMandate / 2n;
  }

  // Unrestricted: a very large sentinel the capacity min() will never bind on in practice,
  // callers should still floor this against capacityCapOnChain via computeCapacity.
  return capMandate;
}
