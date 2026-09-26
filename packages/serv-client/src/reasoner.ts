// Proposal reasoner output schema and fail-closed validation. PLAN_v2 section 9: "Strict JSON
// schema: { action: DEPOSIT|REDEEM|HOLD, amount: decimal string, rationale (max 600 chars),
// inputs_used: enum[], confidence, next_review_hours }. No address, calldata, vault or limit
// fields." and "Fail closed: schema violation, failed shadow output, timeout, refusal or empty
// content becomes HOLD with MODEL_FAILED_OUTPUT."
//
// CLAUDE.md's non-negotiable invariant: "The model never receives a code path that can name
// an address, produce calldata, set a limit, or raise capacity — it emits a typed proposal
// only." Enforced two ways here, not one: the TypeScript type itself has no such field, AND
// validateProposal rejects any object with unexpected extra keys (defense in depth against a
// model — or an attacker prompting it — trying to smuggle one through).

export const ReasonerAction = { DEPOSIT: "DEPOSIT", REDEEM: "REDEEM", HOLD: "HOLD" } as const;
export type ReasonerAction = (typeof ReasonerAction)[keyof typeof ReasonerAction];

export interface ReasonerProposal {
  action: ReasonerAction;
  amount: string; // decimal string; the caller converts and re-validates against the engine's
                   // bigint smallest-unit amount before it ever reaches checkDeposit — this
                   // module only judges whether the model's output was well-formed.
  rationale: string;
  inputsUsed: string[];
  confidence: number;
  nextReviewHours: number;
}

const ALLOWED_KEYS = new Set(["action", "amount", "rationale", "inputs_used", "confidence", "next_review_hours"]);
const MAX_RATIONALE_CHARS = 600;
const DECIMAL_STRING = /^\d+(\.\d+)?$/;

export type ValidationResult =
  | { ok: true; proposal: ReasonerProposal }
  | { ok: false; reason: string };

export function validateProposal(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "SCHEMA_VIOLATION: not a JSON object" };
  }
  const obj = raw as Record<string, unknown>;

  const extraKeys = Object.keys(obj).filter((k) => !ALLOWED_KEYS.has(k));
  if (extraKeys.length > 0) {
    return { ok: false, reason: `SCHEMA_VIOLATION: unexpected field(s) ${extraKeys.join(", ")}` };
  }

  const action = obj["action"];
  if (action !== ReasonerAction.DEPOSIT && action !== ReasonerAction.REDEEM && action !== ReasonerAction.HOLD) {
    return { ok: false, reason: `SCHEMA_VIOLATION: action must be DEPOSIT|REDEEM|HOLD, got ${JSON.stringify(action)}` };
  }

  const amount = obj["amount"];
  if (typeof amount !== "string" || !DECIMAL_STRING.test(amount)) {
    return { ok: false, reason: `SCHEMA_VIOLATION: amount must be a non-negative decimal string, got ${JSON.stringify(amount)}` };
  }

  const rationale = obj["rationale"];
  if (typeof rationale !== "string" || rationale.length > MAX_RATIONALE_CHARS) {
    return { ok: false, reason: "SCHEMA_VIOLATION: rationale must be a string of at most 600 characters" };
  }

  const inputsUsedRaw = obj["inputs_used"];
  if (!Array.isArray(inputsUsedRaw) || !inputsUsedRaw.every((v) => typeof v === "string")) {
    return { ok: false, reason: "SCHEMA_VIOLATION: inputs_used must be an array of strings" };
  }

  const confidence = obj["confidence"];
  if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: "SCHEMA_VIOLATION: confidence must be a number in [0, 1]" };
  }

  const nextReviewHours = obj["next_review_hours"];
  if (typeof nextReviewHours !== "number" || Number.isNaN(nextReviewHours) || nextReviewHours < 0) {
    return { ok: false, reason: "SCHEMA_VIOLATION: next_review_hours must be a non-negative number" };
  }

  return {
    ok: true,
    proposal: {
      action,
      amount,
      rationale,
      inputsUsed: inputsUsedRaw,
      confidence,
      nextReviewHours,
    },
  };
}

const FAIL_CLOSED_HOLD: ReasonerProposal = {
  action: ReasonerAction.HOLD,
  amount: "0",
  rationale: "MODEL_FAILED_OUTPUT",
  inputsUsed: [],
  confidence: 0,
  nextReviewHours: 1,
};

// Fail-closed entry point: parse -> validate, collapsing every possible failure (malformed
// JSON, schema violation, a transport failure passed in as `rawContent === undefined`) to the
// same safe HOLD. Never throws.
export function proposalFromModelOutput(rawContent: string | undefined): { proposal: ReasonerProposal; failed: boolean; reason?: string } {
  if (rawContent === undefined) {
    return { proposal: FAIL_CLOSED_HOLD, failed: true, reason: "MODEL_FAILED_OUTPUT: no content (transport failure)" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { proposal: FAIL_CLOSED_HOLD, failed: true, reason: "MODEL_FAILED_OUTPUT: response was not valid JSON" };
  }
  const result = validateProposal(parsed);
  if (!result.ok) {
    return { proposal: FAIL_CLOSED_HOLD, failed: true, reason: `MODEL_FAILED_OUTPUT: ${result.reason}` };
  }
  return { proposal: result.proposal, failed: false };
}
