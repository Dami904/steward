// Runs both engine implementations against every fixture category and asserts semantic
// equality (spec/accounting.md P-08, spec/health.md P-14b). Line-ending differences between
// platforms are not a divergence; JSON value equality is what matters.
import { execFileSync } from "node:child_process";

const suites = [
  {
    name: "deposit",
    fixtures: "fixtures/differential/deposit_cases.json",
    ts: "packages/engine/scripts/run-deposit-fixtures.ts",
    py: "packages/engine-py/scripts/run_deposit_fixtures.py",
  },
  {
    name: "redeem",
    fixtures: "fixtures/differential/redeem_cases.json",
    ts: "packages/engine/scripts/run-redeem-fixtures.ts",
    py: "packages/engine-py/scripts/run_redeem_fixtures.py",
  },
  {
    name: "tier_promotion",
    fixtures: "fixtures/differential/tier_promotion_cases.json",
    ts: "packages/engine/scripts/run-tier-promotion-fixtures.ts",
    py: "packages/engine-py/scripts/run_tier_promotion_fixtures.py",
  },
  {
    name: "tier_incident",
    fixtures: "fixtures/differential/tier_incident_cases.json",
    ts: "packages/engine/scripts/run-tier-incident-fixtures.ts",
    py: "packages/engine-py/scripts/run_tier_incident_fixtures.py",
  },
  {
    name: "health_snapshot",
    fixtures: "fixtures/differential/health_snapshot_cases.json",
    ts: "packages/engine/scripts/run-health-fixtures.ts",
    py: "packages/engine-py/scripts/run_health_fixtures.py",
  },
  {
    name: "evidence",
    fixtures: "fixtures/differential/evidence_cases.json",
    ts: "packages/engine/scripts/run-evidence-fixtures.ts",
    py: "packages/engine-py/scripts/run_evidence_fixtures.py",
  },
];

let totalCases = 0;
let totalFailures = 0;

for (const suite of suites) {
  const tsOut = execFileSync("node", ["--experimental-strip-types", suite.ts, suite.fixtures], { encoding: "utf8" });
  const pyOut = execFileSync("python", [suite.py, suite.fixtures], { encoding: "utf8" });

  const ts = JSON.parse(tsOut);
  const py = JSON.parse(pyOut);

  if (ts.length !== py.length) {
    console.error(`FAIL [${suite.name}]: case count differs (ts=${ts.length}, py=${py.length})`);
    totalFailures++;
    continue;
  }

  let suiteFailures = 0;
  for (let i = 0; i < ts.length; i++) {
    const a = ts[i];
    const b = py[i];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      suiteFailures++;
      console.error(`DIVERGENCE [${suite.name}] at case "${a.id ?? b.id}":`);
      console.error("  ts:", JSON.stringify(a));
      console.error("  py:", JSON.stringify(b));
    }
  }

  totalCases += ts.length;
  totalFailures += suiteFailures;
  console.log(`[${suite.name}] ${ts.length - suiteFailures}/${ts.length} identical`);
}

if (totalFailures > 0) {
  console.error(`\nFAIL: ${totalFailures} divergence(s) across ${totalCases} total cases.`);
  process.exit(1);
}

console.log(`\nPASS: ${totalCases} of ${totalCases} cases identical between TS and Python across ${suites.length} suites.`);
