// Capacity gauge for the live app's dashboard — same deep-import pattern as
// apps/web/app/simulate/Simulator.tsx (bypassing packages/engine/src/index.ts's barrel to
// avoid pulling node:crypto's health.ts/evidence.ts into the client bundle), but fed REAL
// on-chain reads instead of slider state.
//
// Unlike Simulate, this DOES need the ×1e18 wei scaling: spec/DECISIONS.md's Phase 5 "second
// slice" entry found that packages/engine/src/types.ts's TIER_SCHEDULE is defined in the
// engine's own small-whole-number convention (maxVault: 150n..1200n), while
// contracts/src/libraries/Types.sol scales the identical constants by 1e18 to match real
// token amounts (TierLimits(120e18, 150e18, ...)). Real on-chain treasury/mandate/exposure
// figures ARE wei-scaled, so capTier must be scaled up to match — the opposite fix from
// Simulate, which stayed in the engine's native scale because it never touches the chain.
import { capMandate, capLiquid, computeCapacity, type CapacityResult } from "../../../packages/engine/src/accounting.ts";
import { TIER_SCHEDULE, type Mandate } from "../../../packages/engine/src/types.ts";
import type { OnChainAccountState } from "./chain";

const WEI_SCALE = 10n ** 18n;

export const BINDING_TERM_NAMES = ["capMandate", "capLiquid", "capTier", "capHealth", "capacityCapOnChain"] as const;

export interface LiveCapacity {
  treasury: bigint;
  capMandate: bigint;
  capLiquid: bigint;
  capTier: bigint;
  capHealth: bigint;
  capacityCapOnChain: bigint;
  result: CapacityResult;
  bindingTerm: (typeof BINDING_TERM_NAMES)[number];
}

// capHealth (the VaultHealthFeed-derived cap, contracts/src/StewardAccount.sol's
// `_readHealthCap`) is NOT read here — replicating its exact on-chain logic (mandate cap
// combined with the health feed's own flags/drawdown haircut) is out of scope for this slice.
// Set to the mandate cap (i.e. never the binding term), the same explicit, documented
// placeholder Simulate uses for the same field — not a silent omission.
export function computeLiveCapacity(state: OnChainAccountState): LiveCapacity {
  const treasury = state.liquidBalance + state.exposure;
  // capMandate() only ever reads maxBps/maxVaultUsdc (packages/engine/src/accounting.ts) —
  // the rest of this literal is unused filler, present only because Mandate is typed as a
  // single full struct, not because these values mean anything here.
  const mandateForCap: Mandate = {
    maxTxUsdc: 0n,
    maxBps: BigInt(state.mandate.maxBps),
    maxVaultUsdc: state.mandate.maxVaultUsdc,
    minLiquidUsdc: 0n,
    maxActionsPerDay: 0,
    expiry: 0,
    loosenDelay: 0,
    feeBps: 0n,
    maxFeeBps: 0n,
    operator: "0x0",
    issuerHaircutBps: 0n,
    latencyHaircutBpsPerDay: 0n,
    latencyHaircutMaxBps: 0n,
    leadFloorDays: 0,
    latencySafety: 1,
    bufferDays: 0,
    approvalAbove: 0n,
  };
  const capMandateVal = capMandate(mandateForCap, treasury);
  const capLiquidVal = capLiquid(treasury, state.envelope.reserveUsdc);
  const tierLimits = TIER_SCHEDULE[state.tierState.tier];
  if (tierLimits === undefined) {
    throw new Error(`computeLiveCapacity: no such tier ${state.tierState.tier}`);
  }
  const capTierVal = tierLimits.maxVault * WEI_SCALE;
  const capHealthVal = capMandateVal; // see doc comment above — health feed cap not wired

  const result = computeCapacity({
    treasury,
    capMandate: capMandateVal,
    capLiquid: capLiquidVal,
    capTier: capTierVal,
    capHealth: capHealthVal,
    capacityCapOnChain: state.envelope.capacityCap,
    healthMultiplierBps: 10000n, // same placeholder as capHealth: full multiplier, not wired
    exposure: state.exposure,
  });

  return {
    treasury,
    capMandate: capMandateVal,
    capLiquid: capLiquidVal,
    capTier: capTierVal,
    capHealth: capHealthVal,
    capacityCapOnChain: state.envelope.capacityCap,
    result,
    bindingTerm: BINDING_TERM_NAMES[result.bindingIndex]!,
  };
}
