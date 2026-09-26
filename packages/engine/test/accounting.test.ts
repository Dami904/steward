import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceHealthMultiplierBps } from "../src/accounting.ts";
import type { EvidenceState } from "../src/types.ts";

// spec/accounting.md section 4's health formula: this is the literal mechanism behind P-07
// ("stale evidence gives capacity 0") and spec/evidence.md section 5 ("one severe corroborated
// adverse claim zeroes capacity regardless of what else is in the set"). Found to have zero
// test coverage during the Phase 3 reliability review — deleting any branch below must fail
// one of these tests, not silently pass pnpm test.

function baseEvidence(overrides: Partial<EvidenceState> = {}): EvidenceState {
  return {
    stale: false,
    corroboratedSevereAdverse: false,
    singlePathAdverse: false,
    observedLatencyDays: 0,
    drawdownBps: 0n,
    drawdownPauseThresholdBps: 2000n,
    ...overrides,
  };
}

test("evidenceHealthMultiplierBps: clean evidence state is unrestricted (10000)", () => {
  assert.equal(evidenceHealthMultiplierBps(baseEvidence(), 5), 10000n);
});

test("evidenceHealthMultiplierBps: stale evidence zeroes health, deleting this branch must fail", () => {
  assert.equal(evidenceHealthMultiplierBps(baseEvidence({ stale: true }), 5), 0n);
});

test("evidenceHealthMultiplierBps: corroborated severe adverse claim zeroes health, deleting this branch must fail", () => {
  assert.equal(evidenceHealthMultiplierBps(baseEvidence({ corroboratedSevereAdverse: true }), 5), 0n);
});

test("evidenceHealthMultiplierBps: corroboratedSevereAdverse wins over a merely-single-path adverse claim also being true (0, not 5000)", () => {
  const evidence = baseEvidence({ corroboratedSevereAdverse: true, singlePathAdverse: true });
  assert.equal(evidenceHealthMultiplierBps(evidence, 5), 0n);
});

test("evidenceHealthMultiplierBps: single-path adverse claim halves health (5000), deleting this branch must fail", () => {
  assert.equal(evidenceHealthMultiplierBps(baseEvidence({ singlePathAdverse: true }), 5), 5000n);
});

test("evidenceHealthMultiplierBps: observed latency exceeding effLeadDays halves health even with no adverse claim", () => {
  const evidence = baseEvidence({ observedLatencyDays: 10 });
  assert.equal(evidenceHealthMultiplierBps(evidence, 5), 5000n);
});

test("evidenceHealthMultiplierBps: drawdown at or above half the pause threshold halves health", () => {
  const evidence = baseEvidence({ drawdownBps: 1000n, drawdownPauseThresholdBps: 2000n });
  assert.equal(evidenceHealthMultiplierBps(evidence, 5), 5000n);
});

test("evidenceHealthMultiplierBps: drawdown at or above the full pause threshold zeroes health outright", () => {
  const evidence = baseEvidence({ drawdownBps: 2000n, drawdownPauseThresholdBps: 2000n });
  assert.equal(evidenceHealthMultiplierBps(evidence, 5), 0n);
});
