// spec/health.md section 6 item 3: "a tiny reference agent... independent code, no Steward
// contracts... that reads the feed and declines to deposit when p90 exceeds its own
// threshold." Deliberately does not import packages/engine or anything Steward-specific —
// the point is that ANY agent, not just one built with Steward's policy/tier machinery,
// benefits from checking real redemption latency before depositing. It consumes the same
// live snapshot JSON that scripts/live-health-snapshot.ts produces (reusing that script as a
// subprocess, not duplicating the p50/p90 math — a second hand-rolled implementation of the
// same percentile logic would drift from spec/health.md over time).
//
// This is a decision *demo*, not a wallet: it never sends a transaction, has no key, and
// makes no network call except the same read-only cast calls live-health-snapshot.ts already
// makes.

export function decide(snapshot, thresholdSec) {
  if (snapshot.n === 0) {
    return { action: "DECLINE", reason: `no redemption history available (n=0); cannot judge liquidity, so decline rather than assume` };
  }
  if (snapshot.paused) {
    return { action: "DECLINE", reason: "vault is paused" };
  }
  if (!snapshot.codehashMatches) {
    return { action: "DECLINE", reason: "implementation codehash changed since last known-good value" };
  }
  if (snapshot.p90Sec > thresholdSec) {
    return {
      action: "DECLINE",
      reason: `measured p90 redemption latency (${snapshot.p90Sec}s, method=${snapshot.method}, n=${snapshot.n}) exceeds this agent's own threshold (${thresholdSec}s)`,
    };
  }
  return {
    action: "DEPOSIT",
    reason: `measured p90 redemption latency (${snapshot.p90Sec}s, method=${snapshot.method}, n=${snapshot.n}) is within threshold (${thresholdSec}s)`,
  };
}
