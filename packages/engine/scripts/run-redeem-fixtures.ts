import { readFileSync } from "node:fs";
import { checkRedeem } from "../src/policy.ts";
import type { VaultReadState } from "../src/types.ts";

const fixturesPath = process.argv[2];
if (fixturesPath === undefined) {
  throw new Error("usage: node run-redeem-fixtures.ts <fixtures.json>");
}
interface RawVault {
  navPerShare: string; shares: string; liquid: string; finalizedNotYetClaimed: string;
  pendingRedemptionExpectedHaircut: string; minDepositAssets: string; minRedeemAssets: string;
  paused: boolean; codehash: string; expectedCodehash: string;
}
interface RawRedeemCase {
  id: string; shares: string; previewAssets: string; vault: RawVault;
  dailyActionsSoFar: number; maxActionsPerDay: number;
}

const raw: RawRedeemCase[] = JSON.parse(readFileSync(fixturesPath, "utf8"));

function bi(v: string): bigint {
  return BigInt(v);
}

const results = raw.map((c) => {
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
  const result = checkRedeem({
    shares: bi(c.shares),
    previewAssets: bi(c.previewAssets),
    vault,
    dailyActionsSoFar: c.dailyActionsSoFar,
    maxActionsPerDay: c.maxActionsPerDay,
  });
  return { id: c.id, verdict: result.verdict, reasons: result.reasons.toString() };
});

console.log(JSON.stringify(results, null, 2));
