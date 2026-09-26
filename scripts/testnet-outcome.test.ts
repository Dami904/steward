import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeMismatch, receiptSucceeded } from "./testnet-outcome.ts";

// If this rule is weakened, the testnet run could publish "A succeeded, B reverted" when the
// chain says otherwise. All four cases of (outcome, expectation).
test("a success that was expected passes", () => {
  assert.equal(outcomeMismatch("A", "0x1", false, "0xa"), null);
});
test("a revert that was expected passes", () => {
  assert.equal(outcomeMismatch("B", "0x0", true, "0xb"), null);
});
test("a revert where success was expected stops the run", () => {
  assert.match(outcomeMismatch("A", "0x0", false, "0xa") ?? "", /expected success/);
});
test("a success where a revert was expected stops the run", () => {
  assert.match(outcomeMismatch("B", "0x1", true, "0xb") ?? "", /expected a revert/);
});
test("both receipt status spellings are read", () => {
  assert.equal(receiptSucceeded("1"), true);
  assert.equal(receiptSucceeded("0x1"), true);
  assert.equal(receiptSucceeded("0x0"), false);
  assert.equal(receiptSucceeded("0"), false);
});
