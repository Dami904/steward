import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRequestFinalizeSnapshot,
  checkDeposit,
  checkPromotion,
  initialTierState,
  recordExposure,
  recordReceipt,
  tierLimitsFor,
  TIER_SCHEDULE,
  DEMO_TIME_UNIT_SECONDS,
  type RedeemRequestRecord,
  type Mandate,
  type VaultReadState,
} from "../src/index.ts";

test("REQUEST_FINALIZE_VIEW snapshot matches Phase 0 sample shape", () => {
  const records: RedeemRequestRecord[] = [
    { id: 1, owner: "0xe8ea6365c329130fd47d4d1ca0ae59caf49fa9c4", receiver: "0xe8ea6365c329130fd47d4d1ca0ae59caf49fa9c4", shares: 1n * 10n ** 18n, requestedAt: 1780978493, processedAt: 1780978720, status: "Rejected" },
    { id: 2, owner: "0x90b999e6fa9a1ab97bcd2978c21c155ebcbf42c6", receiver: "0x90b999e6fa9a1ab97bcd2978c21c155ebcbf42c6", shares: 1n * 10n ** 17n, requestedAt: 1781068088, processedAt: 0, status: "Pending" },
    { id: 8, owner: "0xbaaa6d4fa49cbb4aae8777657ec73b2bff97b445", receiver: "0xbaaa6d4fa49cbb4aae8777657ec73b2bff97b445", shares: 188n * 10n ** 18n, requestedAt: 1786806693, processedAt: 1787903313, status: "Finalized" },
  ];
  const snap = buildRequestFinalizeSnapshot(records, 123166105, 1789980000n as unknown as number, 1091152000000000000n, 0n, "0xabc", "0xabc", false, false);
  assert.equal(snap.n, 1); // only id 8 is Finalized in this trimmed sample
  assert.equal(snap.maxSec, 1787903313 - 1786806693);
});

test("deposit below the vault's minDepositAssets is PROPOSAL_INVALID regardless of capacity", () => {
  const mandate = {
    maxTxUsdc: 1000n, maxBps: 10000n, maxVaultUsdc: 1200n, minLiquidUsdc: 0n,
    maxActionsPerDay: 100, expiry: 9999999999, loosenDelay: 0,
    feeBps: 0n, maxFeeBps: 0n, operator: "0x0",
    issuerHaircutBps: 0n, latencyHaircutBpsPerDay: 0n, latencyHaircutMaxBps: 0n,
    leadFloorDays: 1, latencySafety: 1, bufferDays: 0, approvalAbove: 10000n,
  } satisfies Mandate;
  const vault = {
    navPerShare: 10n ** 18n, shares: 0n, liquid: 10000n, finalizedNotYetClaimed: 0n,
    pendingRedemptionExpectedHaircut: 0n, minDepositAssets: 100n, minRedeemAssets: 100n,
    paused: false, codehash: "0xabc", expectedCodehash: "0xabc",
  } satisfies VaultReadState;

  const result = checkDeposit({
    amount: 50n, // below minDepositAssets = 100
    mandate,
    vault,
    capacityInputs: {
      treasury: 10000n, capMandate: 1000n, capLiquid: 1000n, capTier: 1000n, capHealth: 1000n,
      capacityCapOnChain: 1000n, healthMultiplierBps: 10000n, exposure: 0n,
    },
    liquidAfter: 9950n, reserveAmt: 0n, dailyActionsSoFar: 0, evidenceFresh: true,
    adverseClaimPresent: false, ungroundedClaimPresent: false,
    now: 1000, mandateExpiry: 9999999999, paused: false,
  });

  assert.equal(result.verdict, 3); // REFUSE
});

test("tier promotion predicate: one field short of every condition fails", () => {
  const now = 1000;
  const state = initialTierState(now, 0);
  // Not enough dwell, risk, peak, receipts yet.
  const check = checkPromotion(state, now + 1, DEMO_TIME_UNIT_SECONDS, { paused: false, mandateExpired: false, evidenceStale: false });
  assert.equal(check.eligible, false);
  assert.ok(check.failedConditions.includes("minDwell"));
});

test("tier promotion predicate: all six conditions met at exact boundary", () => {
  const t0 = tierLimitsFor(0);
  const enteredAt = 0;
  let state = initialTierState(enteredAt, 0);
  const dwellSeconds = t0.minDwellUnits * DEMO_TIME_UNIT_SECONDS;
  state = recordExposure(state, enteredAt, (t0.maxVault * t0.peakRequiredBps) / 10000n);
  state = { ...state, riskAcc: t0.minRiskUnits * BigInt(DEMO_TIME_UNIT_SECONDS) };
  for (let i = 0; i < t0.minReceipts; i++) state = recordReceipt(state);

  const check = checkPromotion(state, enteredAt + dwellSeconds, DEMO_TIME_UNIT_SECONDS, {
    paused: false, mandateExpired: false, evidenceStale: false,
  });
  assert.equal(check.eligible, true);
});

// onchain-access-control skill, check 1 (default-deny): an out-of-range tier must fail
// closed, not silently resolve to undefined. Delete the bounds check in tierLimitsFor and
// this test fails.
test("tierLimitsFor fails closed on an out-of-range tier instead of returning undefined", () => {
  assert.throws(() => tierLimitsFor(4), /no such tier 4/);
  assert.throws(() => tierLimitsFor(-1), /no such tier -1/);
  assert.doesNotThrow(() => tierLimitsFor(0));
  assert.doesNotThrow(() => tierLimitsFor(TIER_SCHEDULE.length - 1));
});
