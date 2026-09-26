import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceOutcome, type ModelClaimResult } from "../src/extraction.ts";

const SRC = "The vault may pause redemptions at the operator's discretion during stress.";

test("both models failing to respond produces stale=true, not a silent 'no adverse claims'", () => {
  const modelA: ModelClaimResult = { ok: false, reason: "TIMEOUT after 30000ms" };
  const modelB: ModelClaimResult = { ok: false, reason: "HTTP_500: ..." };
  const outcome = buildEvidenceOutcome(SRC, modelA, modelB);
  assert.equal(outcome.stale, true);
  assert.equal(outcome.flags.corroboratedSevereAdverse, false);
  assert.equal(outcome.flags.singlePathAdverse, false);
  assert.match(outcome.failureReason ?? "", /modelA/);
  assert.match(outcome.failureReason ?? "", /modelB/);
});

// This is the specific distinction the module header warns about: ONE model failing must
// still produce stale=true (we cannot corroborate — spec/evidence.md requires two independent
// calls), not silently degrade to treating the successful model's claims as sufficient.
test("one model failing (the other succeeding) still produces stale=true", () => {
  const modelA: ModelClaimResult = { ok: true, claims: [] };
  const modelB: ModelClaimResult = { ok: false, reason: "NETWORK_ERROR" };
  const outcome = buildEvidenceOutcome(SRC, modelA, modelB);
  assert.equal(outcome.stale, true);
});

test("both models succeeding with no claims produces stale=false and no flags (evidence checked, nothing found)", () => {
  const modelA: ModelClaimResult = { ok: true, claims: [] };
  const modelB: ModelClaimResult = { ok: true, claims: [] };
  const outcome = buildEvidenceOutcome(SRC, modelA, modelB);
  assert.equal(outcome.stale, false);
  assert.equal(outcome.flags.corroboratedSevereAdverse, false);
  assert.equal(outcome.flags.singlePathAdverse, false);
});

test("both models agreeing on a severe adverse claim in the same region produces corroboratedSevereAdverse", () => {
  const modelA: ModelClaimResult = {
    ok: true,
    claims: [{ type: "PAUSE", polarity: "ADVERSE", quote: "pause redemptions at the operator's discretion", severity: "HIGH", sourceUrl: "https://x" }],
  };
  const modelB: ModelClaimResult = {
    ok: true,
    claims: [{ type: "PAUSE", polarity: "ADVERSE", quote: "pause redemptions at the operator's discretion", severity: "HIGH", sourceUrl: "https://x" }],
  };
  const outcome = buildEvidenceOutcome(SRC, modelA, modelB);
  assert.equal(outcome.stale, false);
  assert.equal(outcome.flags.corroboratedSevereAdverse, true);
});

test("an ungrounded claim from one model is dropped and counted, not treated as a transport failure", () => {
  const modelA: ModelClaimResult = {
    ok: true,
    claims: [{ type: "REGULATORY", polarity: "ADVERSE", quote: "text that is not in the source", severity: "HIGH", sourceUrl: "https://x" }],
  };
  const modelB: ModelClaimResult = { ok: true, claims: [] };
  const outcome = buildEvidenceOutcome(SRC, modelA, modelB);
  assert.equal(outcome.stale, false);
  assert.equal(outcome.ungroundedCount, 1);
  assert.equal(outcome.flags.corroboratedSevereAdverse, false);
});
