// spec/accounting.md section 6: DEPOSIT/REQUEST_REDEEM rules. Combines accounting.ts,
// tiers.ts, health.ts into a single verdict. This is the function whose output must be
// byte-identical to packages/engine-py's equivalent (invariant P-08).

import { Verdict, ReasonBit, reasonMask, type Mandate, type VaultReadState, type PolicyResult, CapacityBindingTerm } from "./types.ts";
import { computeCapacity, type CapacityInputs } from "./accounting.ts";

export interface DepositCheckInputs {
  amount: bigint;
  mandate: Mandate;
  vault: VaultReadState;
  capacityInputs: CapacityInputs;
  liquidAfter: bigint;
  reserveAmt: bigint;
  dailyActionsSoFar: number;
  evidenceFresh: boolean;
  // spec/evidence.md section 3.5: flattened booleans from deriveEvidenceFlags/groundClaims,
  // same pattern as evidenceFresh — informational reason bits, surfaced on the receipt so an
  // owner can see *why* health dropped even when the resulting capacity cut wasn't itself
  // binding (e.g. a tighter mandate cap was already the binding term).
  adverseClaimPresent: boolean;
  ungroundedClaimPresent: boolean;
  now: number;
  mandateExpiry: number;
  paused: boolean;
}

export function checkDeposit(inputs: DepositCheckInputs): PolicyResult {
  const refuseBits: ReasonBit[] = [];
  const { capacity, headroom, overCap, bindingIndex } = computeCapacity(inputs.capacityInputs);

  if (inputs.paused) refuseBits.push(ReasonBit.OWNER_PAUSED);
  if (inputs.now > inputs.mandateExpiry) refuseBits.push(ReasonBit.MANDATE_EXPIRED);
  if (inputs.amount < inputs.vault.minDepositAssets) refuseBits.push(ReasonBit.PROPOSAL_INVALID);
  if (inputs.amount > inputs.mandate.maxTxUsdc) refuseBits.push(ReasonBit.OVER_MAX_TX);
  if (inputs.amount > headroom) refuseBits.push(ReasonBit.OVER_CAPACITY);
  if (inputs.liquidAfter < inputs.reserveAmt + inputs.mandate.minLiquidUsdc) refuseBits.push(ReasonBit.BELOW_RESERVE);
  if (!inputs.evidenceFresh) refuseBits.push(ReasonBit.STALE_EVIDENCE);
  if (inputs.dailyActionsSoFar >= inputs.mandate.maxActionsPerDay) refuseBits.push(ReasonBit.RATE_LIMIT);
  if (overCap > 0n) refuseBits.push(ReasonBit.MANDATORY_DERISK);

  // spec/evidence.md section 3.5: informational only — an adverse or ungrounded claim already
  // did its work by reducing capacity upstream (evidenceHealthMultiplierBps, computed into
  // capacityInputs before this function is called). Surfacing it here is never itself a reason
  // to refuse a deposit the reduced capacity still comfortably allows ("no forced exit" for a
  // single-path adverse claim, spec/evidence.md's effect table) — only OVER_CAPACITY /
  // MANDATORY_DERISK, both already computed above from the reduced capacity, can do that.
  const infoBits: ReasonBit[] = [];
  if (inputs.adverseClaimPresent) infoBits.push(ReasonBit.ADVERSE_CLAIM);
  if (inputs.ungroundedClaimPresent) infoBits.push(ReasonBit.UNGROUNDED_CLAIM);

  let verdict: Verdict;
  const bits = [...refuseBits, ...infoBits];
  if (refuseBits.length > 0) {
    verdict = Verdict.REFUSE;
  } else if (inputs.amount > inputs.mandate.approvalAbove) {
    verdict = Verdict.NEEDS_APPROVAL;
    bits.push(ReasonBit.ABOVE_APPROVAL_THRESHOLD);
  } else {
    verdict = Verdict.ALLOW;
    bits.push(ReasonBit.OK);
  }

  return {
    verdict,
    reasons: reasonMask(bits),
    capacity,
    headroom,
    overCap,
    bindingTerm: bindingIndex as CapacityBindingTerm,
  };
}

export interface RedeemCheckInputs {
  shares: bigint;
  previewAssets: bigint;
  vault: VaultReadState;
  dailyActionsSoFar: number;
  maxActionsPerDay: number;
}

// Risk-reducing: allowed even when paused or expired, subject only to the rate limit and the
// vault's own minimum. spec/accounting.md section 6.
export function checkRedeem(inputs: RedeemCheckInputs): { verdict: Verdict; reasons: bigint } {
  const bits: ReasonBit[] = [];
  if (inputs.previewAssets < inputs.vault.minRedeemAssets) bits.push(ReasonBit.PROPOSAL_INVALID);
  if (inputs.dailyActionsSoFar >= inputs.maxActionsPerDay) bits.push(ReasonBit.RATE_LIMIT);

  if (bits.length > 0) {
    return { verdict: Verdict.REFUSE, reasons: reasonMask(bits) };
  }
  return { verdict: Verdict.ALLOW, reasons: reasonMask([ReasonBit.OK]) };
}
