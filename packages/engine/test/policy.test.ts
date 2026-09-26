import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDeposit, Verdict, type Mandate, type VaultReadState } from "../src/index.ts";

// spec/DECISIONS.md's 2026-09-22 entry: the checkDeposit refuseBits/infoBits split exists
// specifically so ADVERSE_CLAIM/UNGROUNDED_CLAIM can never force REFUSE on their own — a bug
// in my own first draft pushed them into the refuse path, force-refusing every deposit an
// adverse claim so much as touched, contradicting spec/evidence.md's "no forced exit" rule
// for a single-path adverse claim. Caught by hand before shipping, but until now had no test
// that would fail if the same regression were reintroduced — the only prior coverage was a
// TS/Python differential fixture, which can't catch a bug mirrored identically into both
// languages at once (see reliability review, 2026-09-22).

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

test("checkDeposit: an adverse claim present ALONE, with headroom that still covers the amount, must ALLOW not REFUSE", () => {
  const result = checkDeposit({
    amount: 100n,
    mandate,
    vault,
    capacityInputs: {
      treasury: 10000n, capMandate: 1000n, capLiquid: 1000n, capTier: 1000n, capHealth: 1000n,
      capacityCapOnChain: 1000n, healthMultiplierBps: 10000n, exposure: 0n,
    },
    liquidAfter: 9900n, reserveAmt: 0n, dailyActionsSoFar: 0, evidenceFresh: true,
    adverseClaimPresent: true, ungroundedClaimPresent: false,
    now: 1000, mandateExpiry: 9999999999, paused: false,
  });

  assert.equal(result.verdict, Verdict.ALLOW);
});

test("checkDeposit: an ungrounded claim present ALONE must also ALLOW, not REFUSE", () => {
  const result = checkDeposit({
    amount: 100n,
    mandate,
    vault,
    capacityInputs: {
      treasury: 10000n, capMandate: 1000n, capLiquid: 1000n, capTier: 1000n, capHealth: 1000n,
      capacityCapOnChain: 1000n, healthMultiplierBps: 10000n, exposure: 0n,
    },
    liquidAfter: 9900n, reserveAmt: 0n, dailyActionsSoFar: 0, evidenceFresh: true,
    adverseClaimPresent: false, ungroundedClaimPresent: true,
    now: 1000, mandateExpiry: 9999999999, paused: false,
  });

  assert.equal(result.verdict, Verdict.ALLOW);
});

test("checkDeposit: ADVERSE_CLAIM reason bit is still present on the ALLOW receipt (informational, not silent)", () => {
  const result = checkDeposit({
    amount: 100n,
    mandate,
    vault,
    capacityInputs: {
      treasury: 10000n, capMandate: 1000n, capLiquid: 1000n, capTier: 1000n, capHealth: 1000n,
      capacityCapOnChain: 1000n, healthMultiplierBps: 10000n, exposure: 0n,
    },
    liquidAfter: 9900n, reserveAmt: 0n, dailyActionsSoFar: 0, evidenceFresh: true,
    adverseClaimPresent: true, ungroundedClaimPresent: false,
    now: 1000, mandateExpiry: 9999999999, paused: false,
  });

  const ADVERSE_CLAIM_BIT = 12n;
  assert.equal((result.reasons & (1n << ADVERSE_CLAIM_BIT)) !== 0n, true);
});

test("checkDeposit: an adverse claim that reduces capacity below the amount (via the health multiplier upstream, not the info bit) still REFUSEs", () => {
  const result = checkDeposit({
    amount: 100n,
    mandate,
    vault,
    capacityInputs: {
      // healthMultiplierBps = 5000 simulates what evidenceHealthMultiplierBps returns for a
      // singlePathAdverse claim — this is the *correct* path an adverse claim blocks a
      // deposit through, distinct from the informational reason bit tested above.
      treasury: 10000n, capMandate: 50n, capLiquid: 50n, capTier: 50n, capHealth: 50n,
      capacityCapOnChain: 50n, healthMultiplierBps: 5000n, exposure: 0n,
    },
    liquidAfter: 9900n, reserveAmt: 0n, dailyActionsSoFar: 0, evidenceFresh: true,
    adverseClaimPresent: true, ungroundedClaimPresent: false,
    now: 1000, mandateExpiry: 9999999999, paused: false,
  });

  assert.equal(result.verdict, Verdict.REFUSE);
});
