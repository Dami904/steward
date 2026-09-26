// spec/evidence.md. Pure functions: reduce raw model claims to the deterministic
// EvidenceState fields consumed by accounting.ts's evidenceHealthMultiplierBps. Nothing here
// makes a network call — the SERV client that produces RawClaim[] lives elsewhere and is not
// part of this module's differential-testable surface.

import { createHash } from "node:crypto";

export const ClaimType = {
  REDEMPTION_GATING: "REDEMPTION_GATING",
  REDEMPTION_DELAY: "REDEMPTION_DELAY",
  UNDERLYING_CHANGE: "UNDERLYING_CHANGE",
  NAV_METHOD_CHANGE: "NAV_METHOD_CHANGE",
  YIELD_CHANGE: "YIELD_CHANGE",
  CUSTODY_CHANGE: "CUSTODY_CHANGE",
  PAUSE: "PAUSE",
  REGULATORY: "REGULATORY",
  OTHER: "OTHER",
} as const;
export type ClaimType = (typeof ClaimType)[keyof typeof ClaimType];

export const Polarity = { ADVERSE: "ADVERSE", FAVORABLE: "FAVORABLE", NEUTRAL: "NEUTRAL" } as const;
export type Polarity = (typeof Polarity)[keyof typeof Polarity];

export const Severity = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" } as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export interface RawClaim {
  type: ClaimType;
  polarity: Polarity;
  quote: string;
  severity: Severity;
  sourceUrl: string;
}

export interface GroundedClaim extends RawClaim {
  matchStart: number; // index into the normalized source
  matchEnd: number;
}

export type CorroborationStatus = "CORROBORATED" | "SINGLE";

export interface AssessedClaim extends GroundedClaim {
  status: CorroborationStatus;
}

// spec/evidence.md section 1: collapse whitespace runs, trim. Applied identically to source
// text and to every claim's quote before grounding.
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// spec/evidence.md section 3.3: a claim is grounded iff its normalized quote is a verbatim
// substring of the normalized source. Ungrounded claims are dropped (never reach
// corroboration or the effect table) and counted by the caller via the returned count.
export function groundClaims(
  sourceText: string,
  claims: RawClaim[],
): { grounded: GroundedClaim[]; ungroundedCount: number } {
  const normalizedSource = normalizeWhitespace(sourceText);
  const grounded: GroundedClaim[] = [];
  let ungroundedCount = 0;

  for (const claim of claims) {
    const normalizedQuote = normalizeWhitespace(claim.quote);
    const matchStart = normalizedQuote.length > 0 ? normalizedSource.indexOf(normalizedQuote) : -1;
    if (matchStart === -1) {
      ungroundedCount++;
      continue;
    }
    grounded.push({ ...claim, matchStart, matchEnd: matchStart + normalizedQuote.length });
  }

  return { grounded, ungroundedCount };
}

// spec/evidence.md section 3.4: two grounded claims correspond iff same type, same polarity,
// and their matched source ranges overlap. Matching is greedy and one-to-one (source order) so
// neither model can self-corroborate by duplicating a claim, and matching is symmetric in
// which array is "a" vs "b" (P-15) because it only depends on claim identity, not position.
export function corroborate(a: GroundedClaim[], b: GroundedClaim[]): AssessedClaim[] {
  const usedB = new Set<number>();
  const result: AssessedClaim[] = [];

  for (const claimA of a) {
    let matched = false;
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      const claimB = b[j];
      if (claimB === undefined) continue;
      const overlaps = claimA.matchStart < claimB.matchEnd && claimB.matchStart < claimA.matchEnd;
      if (claimB.type === claimA.type && claimB.polarity === claimA.polarity && overlaps) {
        usedB.add(j);
        matched = true;
        break;
      }
    }
    result.push({ ...claimA, status: matched ? "CORROBORATED" : "SINGLE" });
  }
  for (let j = 0; j < b.length; j++) {
    if (usedB.has(j)) continue;
    const claimB = b[j];
    if (claimB === undefined) continue;
    result.push({ ...claimB, status: "SINGLE" });
  }

  return result;
}

export interface EvidenceFlags {
  corroboratedSevereAdverse: boolean;
  singlePathAdverse: boolean;
}

// spec/evidence.md section 3.5: the effect table. FAVORABLE and NEUTRAL claims never set
// either flag (P-09) — only ADVERSE claims are read here.
export function deriveEvidenceFlags(claims: AssessedClaim[]): EvidenceFlags {
  let corroboratedSevereAdverse = false;
  let singlePathAdverse = false;

  for (const claim of claims) {
    if (claim.polarity !== Polarity.ADVERSE) continue;
    if (claim.severity === Severity.HIGH && claim.status === "CORROBORATED") {
      corroboratedSevereAdverse = true;
    } else {
      singlePathAdverse = true;
    }
  }

  return { corroboratedSevereAdverse, singlePathAdverse };
}

// spec/evidence.md section 4: canonical serialization for evidenceSnapshotId. Sorted so the
// hash is order-independent in the input array (P-16); TS and Python must produce
// byte-identical hashes for the same claim set.
export function hashClaimSet(claims: AssessedClaim[]): string {
  const sorted = [...claims].sort((x, y) => {
    const kx = `${x.sourceUrl}|${x.type}|${x.polarity}|${x.quote}`;
    const ky = `${y.sourceUrl}|${y.type}|${y.polarity}|${y.quote}`;
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  const canonical = sorted
    .map((c) => `${c.type}|${c.polarity}|${c.severity}|${c.status}|${quoteHash(c.quote)}`)
    .join("\n");
  return "0x" + createHash("sha256").update(canonical, "utf8").digest("hex");
}

function quoteHash(quote: string): string {
  return createHash("sha256").update(normalizeWhitespace(quote), "utf8").digest("hex");
}

// spec/evidence.md section 3.6 / P-17: true only when no ADVERSE claim falls inside
// [now - windowSec, now]. Pure boundary check; never itself moves a cap.
export interface TimedClaim {
  polarity: Polarity;
  observedAt: number;
}
export function quietWindowOk(claims: TimedClaim[], now: number, windowSec: number): boolean {
  const cutoff = now - windowSec;
  for (const claim of claims) {
    if (claim.polarity === Polarity.ADVERSE && claim.observedAt >= cutoff && claim.observedAt <= now) {
      return false;
    }
  }
  return true;
}
