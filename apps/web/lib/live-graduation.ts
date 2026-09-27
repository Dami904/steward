// Live graduation-eligibility hint for the dashboard's "Graduate" button — deep-imports the
// same checkPromotion() the Verifier already uses (apps/web/lib/replay.ts) and
// contracts/src/libraries/TierEngine.sol implements on-chain, fed with the account's real
// current tierState. Never invents the answer: this is the same predicate the contract itself
// evaluates inside graduate(), just recomputed independently so the button can be disabled
// with an honest reason before a doomed transaction is ever submitted.
//
// Inherits the same known, already-documented limitation as replay.ts (docs/LIMITATIONS.md):
// packages/engine/src/types.ts's TIER_SCHEDULE risk/peak thresholds are defined in the
// engine's small native scale, not wei-scaled to match real on-chain riskAcc/peakExposure —
// in practice this doesn't change the eligible/not-eligible outcome (the thresholds are so
// much smaller than any real wei-scale figure that they're cleared trivially either way), but
// it means this hint isn't exercising the real threshold math at the real scale, same as the
// Verifier. Not re-fixed here — tracked in one place already, not duplicated.
import { checkPromotion, type PromotionCheck } from "../../../packages/engine/src/tiers.ts";
import type { OnChainAccountState } from "./chain";

const DEMO_TIME_UNIT_SECONDS = 60; // Types.DEMO_TIME_UNIT_SECONDS

export function checkLiveGraduation(state: OnChainAccountState, nowTs: number): PromotionCheck {
  return checkPromotion(state.tierState, nowTs, DEMO_TIME_UNIT_SECONDS, {
    paused: state.envelope.paused,
    mandateExpired: nowTs > state.mandate.expiry,
    evidenceStale: false, // Phase 3's evidence layer isn't wired into the live app yet — documented gap, not a silent assumption
  });
}
