import { test } from "node:test";
import assert from "node:assert/strict";
import {
  needsFirstDeposit,
  receiptSeqsLeft,
  needsGraduation,
  needsCreateB,
  needsFundB,
  needsContrastA,
} from "./testnet-resume.ts";

// Each guard stops scripts/testnet-demo.ts --resume from re-sending a step that already landed.

test("A's first deposit only on a fresh account", () => {
  assert.equal(needsFirstDeposit(1), true);
  assert.equal(needsFirstDeposit(2), false);
  assert.equal(needsFirstDeposit(11), false);
});

test("receipts resume from nextSeq and stop at 10, none after graduation", () => {
  assert.deepEqual(receiptSeqsLeft(2, 0), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(receiptSeqsLeft(7, 0), [7, 8, 9, 10]);
  assert.deepEqual(receiptSeqsLeft(11, 0), []);
  assert.deepEqual(receiptSeqsLeft(5, 1), []);
});

test("graduation only while still T0", () => {
  assert.equal(needsGraduation(0), true);
  assert.equal(needsGraduation(1), false);
});

test("B is created only when none exists on-chain", () => {
  assert.equal(needsCreateB(null), true);
  assert.equal(needsCreateB("0x8fb0e2699452ba78751b90b8d2bebf76ea472bba"), false);
});

test("B is funded only below the contrast amount", () => {
  assert.equal(needsFundB(0n, 200n), true);
  assert.equal(needsFundB(199n, 200n), true);
  assert.equal(needsFundB(250n, 200n), false);
});

test("A's contrast deposit exactly once, right after the receipts", () => {
  assert.equal(needsContrastA(11), true);
  assert.equal(needsContrastA(10), false);
  assert.equal(needsContrastA(12), false);
});
