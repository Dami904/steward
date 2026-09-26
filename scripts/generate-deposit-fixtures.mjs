// Generates a wide deposit-check fixture set: one isolated case per reason bit (triggered
// and boundary-not-triggered), plus a deterministic pseudo-random sweep of combinations.
// Output is consumed identically by both engines' fixture runners — this script only
// varies inputs, never computes expected outputs (the differential test is the oracle).
import { writeFileSync } from "node:fs";

const baseMandate = {
  maxTxUsdc: "1000", maxBps: "10000", maxVaultUsdc: "1200", minLiquidUsdc: "50",
  maxActionsPerDay: 10, expiry: 9999999999, loosenDelay: 0,
  feeBps: "0", maxFeeBps: "0", operator: "0x0",
  issuerHaircutBps: "0", latencyHaircutBpsPerDay: "0", latencyHaircutMaxBps: "0",
  leadFloorDays: 1, latencySafety: 1, bufferDays: 0, approvalAbove: "500",
};
const baseVault = {
  navPerShare: "1000000000000000000", shares: "0", liquid: "10000",
  finalizedNotYetClaimed: "0", pendingRedemptionExpectedHaircut: "0",
  minDepositAssets: "100", minRedeemAssets: "100",
  paused: false, codehash: "0xabc", expectedCodehash: "0xabc",
};
const baseCapacity = {
  treasury: "10000", capMandate: "1000", capLiquid: "1000", capTier: "1000",
  capHealth: "1000", capacityCapOnChain: "1000", healthMultiplierBps: "10000", exposure: "0",
};
const baseCase = {
  amount: "100", mandate: baseMandate, vault: baseVault, capacityInputs: baseCapacity,
  liquidAfter: "9900", reserveAmt: "0", dailyActionsSoFar: 0, evidenceFresh: true,
  adverseClaimPresent: false, ungroundedClaimPresent: false,
  now: 1000, mandateExpiry: 9999999999, paused: false,
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function merge(overrides, id) {
  const c = clone(baseCase);
  for (const [path, value] of overrides) {
    const parts = path.split(".");
    let node = c;
    for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
    node[parts[parts.length - 1]] = value;
  }
  c.id = id;
  return c;
}

const cases = [];

// One case per reason bit, isolated (only that condition triggers).
cases.push(merge([], "allow_baseline"));
cases.push(merge([["paused", true]], "trigger_owner_paused"));
cases.push(merge([["mandateExpiry", 500]], "trigger_mandate_expired"));
cases.push(merge([["amount", "50"]], "trigger_proposal_invalid_below_min_deposit"));
cases.push(merge([["amount", "1500"]], "trigger_over_max_tx"));
cases.push(merge([["capacityInputs.capMandate", "50"], ["capacityInputs.capLiquid", "50"], ["capacityInputs.capTier", "50"], ["capacityInputs.capHealth", "50"], ["capacityInputs.capacityCapOnChain", "50"]], "trigger_over_capacity"));
cases.push(merge([["liquidAfter", "40"]], "trigger_below_reserve"));
cases.push(merge([["evidenceFresh", false]], "trigger_stale_evidence"));
cases.push(merge([["dailyActionsSoFar", 10]], "trigger_rate_limit"));
// spec/evidence.md section 3.5: informational bits only — must NOT flip verdict to REFUSE on
// their own when capacity (already reduced upstream) still allows the amount.
cases.push(merge([["adverseClaimPresent", true]], "info_adverse_claim_present_still_allow"));
cases.push(merge([["ungroundedClaimPresent", true]], "info_ungrounded_claim_present_still_allow"));
cases.push(merge([
  ["adverseClaimPresent", true],
  ["capacityInputs.healthMultiplierBps", "5000"],
  ["capacityInputs.capMandate", "50"], ["capacityInputs.capLiquid", "50"],
  ["capacityInputs.capTier", "50"], ["capacityInputs.capHealth", "50"],
  ["capacityInputs.capacityCapOnChain", "50"],
], "trigger_over_capacity_from_adverse_claim_health_cut"));
cases.push(merge([["amount", "600"]], "trigger_needs_approval"));
cases.push(merge([["capacityInputs.exposure", "1100"]], "trigger_mandatory_derisk_overcap"));

// Boundary: exactly at each threshold should NOT trigger the corresponding refuse reason.
cases.push(merge([["amount", "100"]], "boundary_exact_min_deposit_allowed"));
cases.push(merge([["amount", "1000"]], "boundary_exact_max_tx_allowed"));
cases.push(merge([["amount", "500"]], "boundary_exact_approval_above_still_allow"));
cases.push(merge([["now", 9999999999]], "boundary_exact_mandate_expiry_allowed"));
cases.push(merge([["liquidAfter", "50"], ["mandate.minLiquidUsdc", "50"], ["reserveAmt", "0"]], "boundary_exact_reserve_allowed"));
cases.push(merge([["dailyActionsSoFar", 9]], "boundary_one_under_rate_limit_allowed"));

// Combinations: two triggers at once, checking the mask carries both bits.
cases.push(merge([["paused", true], ["evidenceFresh", false]], "combo_paused_and_stale"));
cases.push(merge([["amount", "1500"], ["dailyActionsSoFar", 10]], "combo_over_max_tx_and_rate_limit"));
cases.push(merge([["amount", "50"], ["paused", true], ["evidenceFresh", false], ["dailyActionsSoFar", 10]], "combo_four_reasons"));
cases.push(merge([["paused", true], ["adverseClaimPresent", true], ["ungroundedClaimPresent", true]], "combo_refuse_reason_plus_both_info_bits"));

// Deterministic pseudo-random sweep (mulberry32, fixed seed) over amount/caps/liquidity.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260921);
for (let i = 0; i < 30; i++) {
  const amount = Math.floor(rand() * 1500);
  const cap = Math.floor(rand() * 1200);
  const liquidAfter = Math.floor(rand() * 10000);
  const dailyActions = Math.floor(rand() * 12);
  const paused = rand() < 0.1;
  const evidenceFresh = rand() > 0.1;
  const exposure = Math.floor(rand() * cap * 1.3);
  cases.push(merge([
    ["amount", String(amount)],
    ["capacityInputs.capMandate", String(cap)],
    ["capacityInputs.capLiquid", String(cap)],
    ["capacityInputs.capTier", String(cap)],
    ["capacityInputs.capHealth", String(cap)],
    ["capacityInputs.capacityCapOnChain", String(cap)],
    ["capacityInputs.exposure", String(exposure)],
    ["liquidAfter", String(liquidAfter)],
    ["dailyActionsSoFar", dailyActions],
    ["paused", paused],
    ["evidenceFresh", evidenceFresh],
  ], `sweep_${i.toString().padStart(2, "0")}`));
}

writeFileSync("fixtures/differential/deposit_cases.json", JSON.stringify(cases, null, 2) + "\n");
console.log(`wrote ${cases.length} deposit cases`);
