// Differential test harness (TS side). Reads /fixtures/differential/deposit_cases.json,
// runs checkDeposit for each case, prints canonical JSON to stdout. Compared against the
// Python runner's output by scripts/diff-check.sh. spec/accounting.md P-08.

import { readFileSync } from "node:fs";
import { checkDeposit } from "../src/policy.ts";
import type { Mandate, VaultReadState } from "../src/types.ts";
import type { CapacityInputs } from "../src/accounting.ts";

const fixturesPath = process.argv[2];
if (fixturesPath === undefined) {
  throw new Error("usage: node run-deposit-fixtures.ts <fixtures.json>");
}
interface RawMandate {
  maxTxUsdc: string; maxBps: string; maxVaultUsdc: string; minLiquidUsdc: string;
  maxActionsPerDay: number; expiry: number; loosenDelay: number;
  feeBps: string; maxFeeBps: string; operator: string;
  issuerHaircutBps: string; latencyHaircutBpsPerDay: string; latencyHaircutMaxBps: string;
  leadFloorDays: number; latencySafety: number; bufferDays: number; approvalAbove: string;
}
interface RawVault {
  navPerShare: string; shares: string; liquid: string; finalizedNotYetClaimed: string;
  pendingRedemptionExpectedHaircut: string; minDepositAssets: string; minRedeemAssets: string;
  paused: boolean; codehash: string; expectedCodehash: string;
}
interface RawCapacityInputs {
  treasury: string; capMandate: string; capLiquid: string; capTier: string; capHealth: string;
  capacityCapOnChain: string; healthMultiplierBps: string; exposure: string;
}
interface RawDepositCase {
  id: string;
  amount: string;
  mandate: RawMandate;
  vault: RawVault;
  capacityInputs: RawCapacityInputs;
  liquidAfter: string;
  reserveAmt: string;
  dailyActionsSoFar: number;
  evidenceFresh: boolean;
  adverseClaimPresent: boolean;
  ungroundedClaimPresent: boolean;
  now: number;
  mandateExpiry: number;
  paused: boolean;
}

const raw: RawDepositCase[] = JSON.parse(readFileSync(fixturesPath, "utf8"));

function bi(v: string): bigint {
  return BigInt(v);
}

const results = raw.map((c) => {
  const mandate: Mandate = {
    maxTxUsdc: bi(c.mandate.maxTxUsdc),
    maxBps: bi(c.mandate.maxBps),
    maxVaultUsdc: bi(c.mandate.maxVaultUsdc),
    minLiquidUsdc: bi(c.mandate.minLiquidUsdc),
    maxActionsPerDay: c.mandate.maxActionsPerDay,
    expiry: c.mandate.expiry,
    loosenDelay: c.mandate.loosenDelay,
    feeBps: bi(c.mandate.feeBps),
    maxFeeBps: bi(c.mandate.maxFeeBps),
    operator: c.mandate.operator,
    issuerHaircutBps: bi(c.mandate.issuerHaircutBps),
    latencyHaircutBpsPerDay: bi(c.mandate.latencyHaircutBpsPerDay),
    latencyHaircutMaxBps: bi(c.mandate.latencyHaircutMaxBps),
    leadFloorDays: c.mandate.leadFloorDays,
    latencySafety: c.mandate.latencySafety,
    bufferDays: c.mandate.bufferDays,
    approvalAbove: bi(c.mandate.approvalAbove),
  };
  const vault: VaultReadState = {
    navPerShare: bi(c.vault.navPerShare),
    shares: bi(c.vault.shares),
    liquid: bi(c.vault.liquid),
    finalizedNotYetClaimed: bi(c.vault.finalizedNotYetClaimed),
    pendingRedemptionExpectedHaircut: bi(c.vault.pendingRedemptionExpectedHaircut),
    minDepositAssets: bi(c.vault.minDepositAssets),
    minRedeemAssets: bi(c.vault.minRedeemAssets),
    paused: c.vault.paused,
    codehash: c.vault.codehash,
    expectedCodehash: c.vault.expectedCodehash,
  };
  const capacityInputs: CapacityInputs = {
    treasury: bi(c.capacityInputs.treasury),
    capMandate: bi(c.capacityInputs.capMandate),
    capLiquid: bi(c.capacityInputs.capLiquid),
    capTier: bi(c.capacityInputs.capTier),
    capHealth: bi(c.capacityInputs.capHealth),
    capacityCapOnChain: bi(c.capacityInputs.capacityCapOnChain),
    healthMultiplierBps: bi(c.capacityInputs.healthMultiplierBps) as 0n | 5000n | 10000n,
    exposure: bi(c.capacityInputs.exposure),
  };

  const result = checkDeposit({
    amount: bi(c.amount),
    mandate,
    vault,
    capacityInputs,
    liquidAfter: bi(c.liquidAfter),
    reserveAmt: bi(c.reserveAmt),
    dailyActionsSoFar: c.dailyActionsSoFar,
    evidenceFresh: c.evidenceFresh,
    adverseClaimPresent: c.adverseClaimPresent,
    ungroundedClaimPresent: c.ungroundedClaimPresent,
    now: c.now,
    mandateExpiry: c.mandateExpiry,
    paused: c.paused,
  });

  return {
    id: c.id,
    verdict: result.verdict,
    reasons: result.reasons.toString(),
    capacity: result.capacity.toString(),
    headroom: result.headroom.toString(),
    overCap: result.overCap.toString(),
    bindingTerm: result.bindingTerm,
  };
});

console.log(JSON.stringify(results, null, 2));
