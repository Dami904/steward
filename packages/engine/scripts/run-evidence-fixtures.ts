// Differential test harness (TS side) for spec/evidence.md's grounding/corroboration/effect
// pipeline. spec/evidence.md P-16 (hash parity), extends P-08/P-09/P-10.
import { readFileSync } from "node:fs";
import { groundClaims, corroborate, deriveEvidenceFlags, hashClaimSet, type RawClaim } from "../src/evidence.ts";

const fixturesPath = process.argv[2];
if (fixturesPath === undefined) {
  throw new Error("usage: node run-evidence-fixtures.ts <fixtures.json>");
}

interface RawCase {
  id: string;
  sourceText: string;
  claimsA: RawClaim[];
  claimsB: RawClaim[];
}

const raw: RawCase[] = JSON.parse(readFileSync(fixturesPath, "utf8"));

const results = raw.map((c) => {
  const { grounded: groundedA, ungroundedCount: ungroundedCountA } = groundClaims(c.sourceText, c.claimsA);
  const { grounded: groundedB, ungroundedCount: ungroundedCountB } = groundClaims(c.sourceText, c.claimsB);
  const assessed = corroborate(groundedA, groundedB);
  const flags = deriveEvidenceFlags(assessed);
  const claimSetHash = hashClaimSet(assessed);

  const corroboratedCount = assessed.filter((a) => a.status === "CORROBORATED").length;
  const singleCount = assessed.filter((a) => a.status === "SINGLE").length;

  return {
    id: c.id,
    groundedCountA: groundedA.length,
    groundedCountB: groundedB.length,
    ungroundedCountA,
    ungroundedCountB,
    corroboratedCount,
    singleCount,
    corroboratedSevereAdverse: flags.corroboratedSevereAdverse,
    singlePathAdverse: flags.singlePathAdverse,
    claimSetHash,
  };
});

console.log(JSON.stringify(results, null, 2));
