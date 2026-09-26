// Reason bits (packages/engine/src/types.ts ReasonBit, same order) and a plain-language line
// for each, so a verdict says why and not only a code.

export const REASON_BIT_NAMES = [
  "OK", "HOLD_NOOP", "MANDATE_INVALID", "MANDATE_EXPIRED", "AGENT_MISMATCH",
  "TARGET_NOT_ALLOWED", "OVER_CAPACITY", "OVER_MAX_TX", "BELOW_RESERVE", "STALE_EVIDENCE",
  "CODEHASH_CHANGED", "DRAWDOWN_PAUSE", "ADVERSE_CLAIM", "UNGROUNDED_CLAIM", "RATE_LIMIT",
  "ABOVE_APPROVAL_THRESHOLD", "HARD_CAP", "PROPOSAL_INVALID", "MODEL_FAILED_OUTPUT",
  "OWNER_PAUSED", "MANDATORY_DERISK",
] as const;
export type ReasonName = (typeof REASON_BIT_NAMES)[number];

export function decodeReasons(mask: bigint): ReasonName[] {
  const out: ReasonName[] = [];
  for (let i = 0; i < REASON_BIT_NAMES.length; i++) if ((mask & (1n << BigInt(i))) !== 0n) out.push(REASON_BIT_NAMES[i]!);
  return out;
}

export const REASON_EXPLANATIONS: Record<ReasonName, string> = {
  OK: "Every check passes.",
  HOLD_NOOP: "A hold: nothing moves.",
  MANDATE_INVALID: "The mandate itself is invalid.",
  MANDATE_EXPIRED: "The owner's mandate has expired.",
  AGENT_MISMATCH: "The caller isn't this account's agent.",
  TARGET_NOT_ALLOWED: "The target isn't an allowed vault.",
  OVER_CAPACITY: "More than the account's remaining capacity (headroom).",
  OVER_MAX_TX: "Over the per-deposit cap: the lower of the tier's and the mandate's.",
  BELOW_RESERVE: "Would leave less cash than the reserve plus the mandate's minimum.",
  STALE_EVIDENCE: "The evidence about the vault is too old to act on.",
  CODEHASH_CHANGED: "The vault's code changed since it was approved.",
  DRAWDOWN_PAUSE: "The vault's drawdown passed the pause threshold.",
  ADVERSE_CLAIM: "An adverse claim about the vault cut capacity (information only).",
  UNGROUNDED_CLAIM: "A claim that couldn't be matched to its source (information only).",
  RATE_LIMIT: "Over the daily action limit: the lower of the tier's and the mandate's.",
  ABOVE_APPROVAL_THRESHOLD: "Above the approval threshold, so the owner must sign off.",
  HARD_CAP: "Over the account's lifetime deposit cap.",
  PROPOSAL_INVALID: "Below the vault's minimum deposit (100 units).",
  MODEL_FAILED_OUTPUT: "The model's output failed validation, so it defaulted to hold.",
  OWNER_PAUSED: "The owner has paused the account.",
  MANDATORY_DERISK: "Exposure is already over capacity; only reducing it is allowed.",
};
