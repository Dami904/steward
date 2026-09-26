// Evidence extraction: calls SERV twice with two different models (PLAN_v2 section 8.2),
// parses each response into RawClaim[], and hands the result to
// packages/engine/src/evidence.ts's groundClaims/corroborate/deriveEvidenceFlags — the
// deterministic reduction that module already implements and differential-tests. This file
// owns only the network round trip and the fail-closed boundary around it; the grounding and
// corroboration math is not duplicated here (relative import into packages/engine, same
// pattern the differential fixture runners already use for cross-package access — no
// workspace package dependency added, so pnpm-lock.yaml is untouched by this package).
//
// Important distinction this module is careful about (a prior draft would have conflated
// these): "we called SERV and it found no adverse claims" (evidence is fresh, health
// unrestricted) is NOT the same outcome as "we couldn't reach SERV at all" (evidence must be
// treated as stale — spec/accounting.md section 4: stale evidence => health = 0, the most
// conservative outcome). A transport failure must never silently look identical to "checked,
// nothing adverse found."

import { chatCompletion, type ChatCompletionParams } from "./client.ts";
import {
  groundClaims,
  corroborate,
  deriveEvidenceFlags,
  hashClaimSet,
  type RawClaim,
  type EvidenceFlags,
} from "../../engine/src/evidence.ts";

export type ModelClaimResult =
  | { ok: true; claims: RawClaim[] }
  | { ok: false; reason: string };

const ALLOWED_CLAIM_TYPES = new Set([
  "REDEMPTION_GATING", "REDEMPTION_DELAY", "UNDERLYING_CHANGE", "NAV_METHOD_CHANGE",
  "YIELD_CHANGE", "CUSTODY_CHANGE", "PAUSE", "REGULATORY", "OTHER",
]);
const ALLOWED_POLARITIES = new Set(["ADVERSE", "FAVORABLE", "NEUTRAL"]);
const ALLOWED_SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH"]);

// Fail-closed per claim, not per call: one malformed claim in an otherwise-valid array is
// dropped (same treatment as an ungrounded claim downstream), not treated as a whole-response
// failure — a strict all-or-nothing parse would let one bad element in an 8-claim response
// discard 7 good ones for no safety benefit.
function parseClaims(rawContent: string, sourceUrl: string): ModelClaimResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { ok: false, reason: "response was not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Record<string, unknown>)["claims"])) {
    return { ok: false, reason: "response did not contain a claims array" };
  }
  const rawClaims = (parsed as Record<string, unknown>)["claims"] as unknown[];
  const claims: RawClaim[] = [];
  for (const c of rawClaims) {
    if (typeof c !== "object" || c === null) continue;
    const obj = c as Record<string, unknown>;
    const { type, polarity, quote, severity } = obj;
    if (
      typeof type === "string" && ALLOWED_CLAIM_TYPES.has(type) &&
      typeof polarity === "string" && ALLOWED_POLARITIES.has(polarity) &&
      typeof severity === "string" && ALLOWED_SEVERITIES.has(severity) &&
      typeof quote === "string" && quote.length > 0
    ) {
      claims.push({ type: type as RawClaim["type"], polarity: polarity as RawClaim["polarity"], quote, severity: severity as RawClaim["severity"], sourceUrl });
    }
  }
  return { ok: true, claims };
}

export interface ExtractClaimsParams {
  apiKey: string;
  sourceText: string;
  sourceUrl: string;
  modelA: string;
  modelB: string;
  baseUrl?: string;
  fetchImpl?: ChatCompletionParams["fetchImpl"];
}

const EXTRACTION_SYSTEM_PROMPT =
  "You extract structured claims from vault/issuer notices. Every claim must include a " +
  "verbatim quote copied exactly from the source text below — do not paraphrase. Only claim " +
  "what the text actually states; if nothing matches a claim type, omit it. Respond with JSON " +
  'only: {"claims": [{"type": "...", "polarity": "ADVERSE|FAVORABLE|NEUTRAL", "quote": "...", "severity": "LOW|MEDIUM|HIGH"}]}. ' +
  `Allowed type values: ${[...ALLOWED_CLAIM_TYPES].join(", ")}.`;

async function extractOneModel(params: ExtractClaimsParams, model: string): Promise<ModelClaimResult> {
  const result = await chatCompletion({
    apiKey: params.apiKey,
    model,
    baseUrl: params.baseUrl,
    fetchImpl: params.fetchImpl,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: params.sourceText },
    ],
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return parseClaims(result.content, params.sourceUrl);
}

export async function extractClaims(params: ExtractClaimsParams): Promise<{ modelA: ModelClaimResult; modelB: ModelClaimResult }> {
  const [modelA, modelB] = await Promise.all([
    extractOneModel(params, params.modelA),
    extractOneModel(params, params.modelB),
  ]);
  return { modelA, modelB };
}

export interface EvidenceExtractionOutcome {
  stale: boolean; // true iff either model call failed — see module header note
  flags: EvidenceFlags;
  claimSetHash: string;
  ungroundedCount: number;
  failureReason?: string;
}

const EMPTY_FLAGS: EvidenceFlags = { corroboratedSevereAdverse: false, singlePathAdverse: false };

// Orchestrates extraction -> grounding -> corroboration -> the effect table
// (packages/engine/src/evidence.ts), and applies the stale-on-transport-failure rule.
export function buildEvidenceOutcome(
  sourceText: string,
  modelA: ModelClaimResult,
  modelB: ModelClaimResult,
): EvidenceExtractionOutcome {
  if (!modelA.ok || !modelB.ok) {
    const reasons = [!modelA.ok ? `modelA: ${modelA.reason}` : undefined, !modelB.ok ? `modelB: ${modelB.reason}` : undefined]
      .filter((r): r is string => r !== undefined)
      .join("; ");
    return { stale: true, flags: EMPTY_FLAGS, claimSetHash: hashClaimSet([]), ungroundedCount: 0, failureReason: reasons };
  }

  const groundedA = groundClaims(sourceText, modelA.claims);
  const groundedB = groundClaims(sourceText, modelB.claims);
  const assessed = corroborate(groundedA.grounded, groundedB.grounded);
  const flags = deriveEvidenceFlags(assessed);

  return {
    stale: false,
    flags,
    claimSetHash: hashClaimSet(assessed),
    ungroundedCount: groundedA.ungroundedCount + groundedB.ungroundedCount,
  };
}
