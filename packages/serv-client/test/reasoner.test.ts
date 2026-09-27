import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProposal, proposalFromModelOutput, ReasonerAction, PROPOSAL_RESPONSE_FORMAT, ALLOWED_KEYS } from "../src/reasoner.ts";

const validRaw = {
  action: "DEPOSIT",
  amount: "120.5",
  rationale: "within headroom",
  inputs_used: ["capacity_summary"],
  confidence: 0.8,
  next_review_hours: 24,
};

test("accepts a well-formed proposal", () => {
  const result = validateProposal(validRaw);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.proposal.action, ReasonerAction.DEPOSIT);
});

// The core invariant: "the model never receives a code path that can name an address, produce
// calldata, set a limit, or raise capacity." Defense in depth: even though ReasonerProposal
// has no such field, a smuggled extra key must be rejected outright, not silently dropped.
test("rejects a proposal with a smuggled extra field (e.g. address/calldata/limit)", () => {
  for (const extra of [{ address: "0xdead" }, { calldata: "0x1234" }, { limit: "999999" }]) {
    const result = validateProposal({ ...validRaw, ...extra });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(extra)}`);
  }
});

test("rejects an invalid action enum value", () => {
  const result = validateProposal({ ...validRaw, action: "TRANSFER" });
  assert.equal(result.ok, false);
});

test("rejects a non-decimal amount string", () => {
  const result = validateProposal({ ...validRaw, amount: "not-a-number" });
  assert.equal(result.ok, false);
});

test("rejects a negative amount", () => {
  const result = validateProposal({ ...validRaw, amount: "-5" });
  assert.equal(result.ok, false);
});

test("rejects rationale over 600 characters", () => {
  const result = validateProposal({ ...validRaw, rationale: "x".repeat(601) });
  assert.equal(result.ok, false);
});

test("rejects confidence outside [0, 1]", () => {
  assert.equal(validateProposal({ ...validRaw, confidence: 1.5 }).ok, false);
  assert.equal(validateProposal({ ...validRaw, confidence: -0.1 }).ok, false);
});

test("rejects a non-array inputs_used", () => {
  const result = validateProposal({ ...validRaw, inputs_used: "capacity_summary" });
  assert.equal(result.ok, false);
});

test("rejects a missing field", () => {
  const { confidence, ...missing } = validRaw;
  void confidence;
  const result = validateProposal(missing);
  assert.equal(result.ok, false);
});

// The plan: "Fail closed: schema violation... becomes HOLD with MODEL_FAILED_OUTPUT."
test("proposalFromModelOutput: malformed JSON fails closed to HOLD", () => {
  const { proposal, failed } = proposalFromModelOutput("not json at all {{{");
  assert.equal(failed, true);
  assert.equal(proposal.action, ReasonerAction.HOLD);
});

test("proposalFromModelOutput: undefined content (transport failure) fails closed to HOLD", () => {
  const { proposal, failed } = proposalFromModelOutput(undefined);
  assert.equal(failed, true);
  assert.equal(proposal.action, ReasonerAction.HOLD);
});

test("proposalFromModelOutput: schema violation fails closed to HOLD", () => {
  const { proposal, failed } = proposalFromModelOutput(JSON.stringify({ ...validRaw, address: "0xdead" }));
  assert.equal(failed, true);
  assert.equal(proposal.action, ReasonerAction.HOLD);
});

test("proposalFromModelOutput: a valid proposal passes through unchanged", () => {
  const { proposal, failed } = proposalFromModelOutput(JSON.stringify(validRaw));
  assert.equal(failed, false);
  assert.equal(proposal.action, ReasonerAction.DEPOSIT);
  assert.equal(proposal.amount, "120.5");
});

// The strict schema sent to SERV must describe exactly what validateProposal accepts: same keys,
// same actions, no extra properties. The validator stays the guard; the schema only helps the
// model produce valid output, so the two must never drift.
test("PROPOSAL_RESPONSE_FORMAT matches validateProposal's keys and actions", () => {
  const schema = PROPOSAL_RESPONSE_FORMAT.json_schema.schema;
  assert.equal(PROPOSAL_RESPONSE_FORMAT.json_schema.strict, true);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), [...ALLOWED_KEYS].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...ALLOWED_KEYS].sort());
  assert.deepEqual([...schema.properties.action.enum].sort(), Object.values(ReasonerAction).sort());
  for (const action of schema.properties.action.enum) {
    assert.equal(validateProposal({ ...validRaw, action }).ok, true, action);
  }
});
