import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./decide.mjs";

const baseSnapshot = { n: 6, p90Sec: 1000, paused: false, codehashMatches: true, method: "REQUEST_FINALIZE_VIEW" };

test("declines when p90 exceeds the threshold", () => {
  const result = decide({ ...baseSnapshot, p90Sec: 500000 }, 259200);
  assert.equal(result.action, "DECLINE");
});

test("deposits when p90 is within the threshold", () => {
  const result = decide({ ...baseSnapshot, p90Sec: 1000 }, 259200);
  assert.equal(result.action, "DEPOSIT");
});

test("declines on n=0 (no history) rather than assuming liquidity", () => {
  const result = decide({ ...baseSnapshot, n: 0, p90Sec: 0 }, 259200);
  assert.equal(result.action, "DECLINE");
  assert.match(result.reason, /no redemption history/);
});

test("declines when paused, even if p90 is fine", () => {
  const result = decide({ ...baseSnapshot, paused: true }, 259200);
  assert.equal(result.action, "DECLINE");
  assert.match(result.reason, /paused/);
});

test("declines on codehash mismatch, even if p90 is fine", () => {
  const result = decide({ ...baseSnapshot, codehashMatches: false }, 259200);
  assert.equal(result.action, "DECLINE");
  assert.match(result.reason, /codehash/);
});

test("boundary: p90 exactly at threshold still deposits (strictly-greater-than triggers decline)", () => {
  const result = decide({ ...baseSnapshot, p90Sec: 259200 }, 259200);
  assert.equal(result.action, "DEPOSIT");
});
