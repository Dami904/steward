// Generates claim-grounding/corroboration fixtures: two synthetic "model" claim arrays per
// case plus the source text they're checked against. Hand-curated per spec/evidence.md's
// pipeline steps (grounding, corroboration, effect table, hash), not randomly generated —
// mirrors the style of scripts/generate-tier-fixtures.mjs.
import { writeFileSync } from "node:fs";

const SRC =
  "The vault may pause redemptions at the operator's discretion during periods of market " +
  "stress. Yield distributions are paid monthly. The custodian has not changed since launch.";

function claim(type, polarity, quote, severity, sourceUrl = "https://ixs.example/notice") {
  return { type, polarity, quote, severity, sourceUrl };
}

const cases = [];

// Both models agree, same region, severe: CORROBORATED, severe -> corroboratedSevereAdverse.
cases.push({
  id: "corroborated_severe_adverse",
  sourceText: SRC,
  claimsA: [claim("PAUSE", "ADVERSE", "The vault may pause redemptions at the operator's discretion", "HIGH")],
  claimsB: [claim("PAUSE", "ADVERSE", "pause redemptions at the operator's discretion", "HIGH")],
});

// Same claim but only one model reports it: SINGLE, adverse -> singlePathAdverse only.
cases.push({
  id: "single_path_adverse_only_one_model",
  sourceText: SRC,
  claimsA: [claim("PAUSE", "ADVERSE", "The vault may pause redemptions at the operator's discretion", "HIGH")],
  claimsB: [],
});

// Both models agree and overlap, but severity is not HIGH: corroborated but not severe ->
// falls to singlePathAdverse per spec/evidence.md section 3.5 ("otherwise").
cases.push({
  id: "corroborated_but_not_severe_falls_to_single_path",
  sourceText: SRC,
  claimsA: [claim("PAUSE", "ADVERSE", "pause redemptions at the operator's discretion", "MEDIUM")],
  claimsB: [claim("PAUSE", "ADVERSE", "pause redemptions", "MEDIUM")],
});

// Same type+polarity, both grounded, but non-overlapping regions of the source: NOT
// corroborated even though shape matches (spec/evidence.md section 3.4 anti-gaming note).
cases.push({
  id: "same_shape_different_region_not_corroborated",
  sourceText: SRC,
  claimsA: [claim("PAUSE", "ADVERSE", "The vault may pause redemptions at the operator's discretion", "HIGH")],
  claimsB: [claim("PAUSE", "ADVERSE", "Yield distributions are paid monthly", "HIGH")],
});
// (Second claim in claimsB is grounded but wrong type/polarity for it to be a real PAUSE
// claim — included anyway to exercise "grounded but non-matching" without corroboration.)

// An ungrounded claim (quote not present in source, verbatim or after normalization) is
// dropped before corroboration or the effect table.
cases.push({
  id: "ungrounded_claim_dropped",
  sourceText: SRC,
  claimsA: [claim("REGULATORY", "ADVERSE", "the SEC has opened an investigation", "HIGH")],
  claimsB: [],
});

// Favorable and neutral claims never set either flag, grounded or not.
cases.push({
  id: "favorable_and_neutral_never_set_flags",
  sourceText: SRC,
  claimsA: [
    claim("YIELD_CHANGE", "FAVORABLE", "Yield distributions are paid monthly", "HIGH"),
    claim("CUSTODY_CHANGE", "NEUTRAL", "The custodian has not changed since launch", "HIGH"),
  ],
  claimsB: [
    claim("YIELD_CHANGE", "FAVORABLE", "Yield distributions are paid monthly", "HIGH"),
    claim("CUSTODY_CHANGE", "NEUTRAL", "The custodian has not changed since launch", "HIGH"),
  ],
});

// Whitespace-only differences in the quote must still ground (normalization).
cases.push({
  id: "whitespace_normalized_quote_still_grounds",
  sourceText: SRC,
  claimsA: [claim("PAUSE", "ADVERSE", "The   vault  may\npause redemptions   at the operator's discretion", "HIGH")],
  claimsB: [claim("PAUSE", "ADVERSE", "The vault may pause redemptions at the operator's discretion", "HIGH")],
});

// No claims at all from either model: empty, no flags, stable hash.
cases.push({ id: "empty_claim_sets", sourceText: SRC, claimsA: [], claimsB: [] });

// Multiple claims, mixed grounded/ungrounded/adverse/favorable, exercising the full pipeline
// and greedy one-to-one matching (a duplicate-shaped claim in A must not double-match B).
cases.push({
  id: "mixed_pipeline_with_duplicate_shaped_claim_in_a",
  sourceText: SRC,
  claimsA: [
    claim("PAUSE", "ADVERSE", "pause redemptions at the operator's discretion", "HIGH"),
    claim("PAUSE", "ADVERSE", "pause redemptions at the operator's discretion", "HIGH"),
    claim("REGULATORY", "ADVERSE", "a claim that does not appear anywhere", "HIGH"),
  ],
  claimsB: [claim("PAUSE", "ADVERSE", "pause redemptions at the operator's discretion", "HIGH")],
});

writeFileSync("fixtures/differential/evidence_cases.json", JSON.stringify(cases, null, 2) + "\n");
console.log(`wrote ${cases.length} evidence cases`);
