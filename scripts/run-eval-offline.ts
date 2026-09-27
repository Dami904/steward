// Offline half of the eval harness: runs
// eval/scenarios.json's adversarial/defense scenarios directly against the deterministic
// defense functions this repo already built (packages/engine/src/evidence.ts,
// packages/serv-client/src/reasoner.ts). No network call, no API key — every scenario feeds
// a synthetic payload standing in for "what a model might have produced," so this measures
// whether the deterministic gates hold, not what SERV's real models actually output live.
// That comparison (raw model vs SERV vs SERV+policy, on live calls) is scripts/live-eval.ts,
// which needs SERV_API_KEY and real spend — see docs/LIMITATIONS.md for the exact boundary.
//
// Usage: node --experimental-strip-types scripts/run-eval-offline.ts
// Exit code is nonzero if any scenario's actual outcome diverges from its expected outcome —
// wire this into CI once the dataset is considered stable (kept manual for now alongside the
// rest of Phase 3's eval work).

import { readFileSync } from "node:fs";
import { groundClaims, type RawClaim } from "../packages/engine/src/evidence.ts";
import { buildEvidenceOutcome, type ModelClaimResult } from "../packages/serv-client/src/extraction.ts";
import { proposalFromModelOutput } from "../packages/serv-client/src/reasoner.ts";

interface EvidenceScenario {
  id: string;
  category: string;
  description: string;
  sourceText: string;
  claimsA: RawClaim[];
  claimsB: RawClaim[];
  modelAFails?: boolean;
  modelBFails?: boolean;
  expected: {
    stale: boolean;
    corroboratedSevereAdverse: boolean;
    singlePathAdverse: boolean;
    ungroundedCountAtLeast: number;
  };
}

interface ProposalScenario {
  id: string;
  category: string;
  description: string;
  rawModelOutput: string;
  expected: { failed: boolean; action: string };
}

interface ScenarioFile {
  evidenceScenarios: EvidenceScenario[];
  proposalScenarios: ProposalScenario[];
}

const scenariosPath = process.argv[2] ?? "eval/scenarios.json";
const data = JSON.parse(readFileSync(scenariosPath, "utf8")) as ScenarioFile;

interface Row {
  id: string;
  category: string;
  pass: boolean;
  detail: string;
}
const rows: Row[] = [];

for (const s of data.evidenceScenarios) {
  const modelA: ModelClaimResult = s.modelAFails === true ? { ok: false, reason: "simulated transport failure" } : { ok: true, claims: s.claimsA };
  const modelB: ModelClaimResult = s.modelBFails === true ? { ok: false, reason: "simulated transport failure" } : { ok: true, claims: s.claimsB };

  const outcome = buildEvidenceOutcome(s.sourceText, modelA, modelB);
  // Re-derive ungrounded count directly too, since buildEvidenceOutcome only reports it on
  // the non-stale path (mirrors the module's own contract — see extraction.ts).
  const groundedA = groundClaims(s.sourceText, s.claimsA);
  const groundedB = groundClaims(s.sourceText, s.claimsB);

  const ungroundedTotal = groundedA.ungroundedCount + groundedB.ungroundedCount;
  const pass =
    outcome.stale === s.expected.stale &&
    outcome.flags.corroboratedSevereAdverse === s.expected.corroboratedSevereAdverse &&
    outcome.flags.singlePathAdverse === s.expected.singlePathAdverse &&
    (s.expected.stale ? true : ungroundedTotal >= s.expected.ungroundedCountAtLeast);

  rows.push({
    id: s.id,
    category: s.category,
    pass,
    detail: pass
      ? "ok"
      : `expected ${JSON.stringify(s.expected)}, got stale=${outcome.stale} corroboratedSevereAdverse=${outcome.flags.corroboratedSevereAdverse} singlePathAdverse=${outcome.flags.singlePathAdverse} ungrounded=${ungroundedTotal}`,
  });
}

for (const s of data.proposalScenarios) {
  const { proposal, failed } = proposalFromModelOutput(s.rawModelOutput);
  const pass = failed === s.expected.failed && proposal.action === s.expected.action;
  rows.push({
    id: s.id,
    category: s.category,
    pass,
    detail: pass ? "ok" : `expected failed=${s.expected.failed} action=${s.expected.action}, got failed=${failed} action=${proposal.action}`,
  });
}

const totalCount = rows.length;
const passCount = rows.filter((r) => r.pass).length;

console.log("| id | category | result | detail |");
console.log("|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.id} | ${r.category} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail} |`);
}
console.log(`\n${passCount}/${totalCount} scenarios passed.`);

if (passCount < totalCount) {
  console.error(`\nFAIL: ${totalCount - passCount} scenario(s) diverged from expected defense behavior.`);
  process.exit(1);
}
