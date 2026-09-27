// Minimal ABI fragments for StewardAccount — only what the verifier reads. Field order and
// types must match contracts/src/StewardAccount.sol and contracts/src/libraries/Types.sol
// exactly (spec/accounting.md section 8's canonical encoding); this is the read-only half of
// that same contract, not a reimplementation of its logic.
export const stewardAccountAbi = [
  {
    type: "function",
    name: "nextSeq",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "hardCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "agent",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "guardian",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "exposure",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "totalDeposited",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "tierState",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tier", type: "uint8" },
      { name: "tierEnteredAt", type: "uint40" },
      { name: "riskAcc", type: "uint128" },
      { name: "peakExposure", type: "uint128" },
      { name: "receiptsSinceEntry", type: "uint32" },
      { name: "incidentCount", type: "uint32" },
      { name: "lastIncidentAt", type: "uint40" },
      { name: "lastExposure", type: "uint128" },
      { name: "lastTs", type: "uint40" },
      { name: "incidentsSinceEntry", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "mandate",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "maxTxUsdc", type: "uint128" },
      { name: "maxBps", type: "uint16" },
      { name: "maxVaultUsdc", type: "uint128" },
      { name: "minLiquidUsdc", type: "uint128" },
      { name: "maxActionsPerDay", type: "uint32" },
      { name: "expiry", type: "uint40" },
      { name: "loosenDelay", type: "uint32" },
      { name: "issuerHaircutBps", type: "uint16" },
      { name: "latencyHaircutBpsPerDay", type: "uint16" },
      { name: "latencyHaircutMaxBps", type: "uint16" },
      { name: "leadFloorDays", type: "uint32" },
      { name: "approvalAbove", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "envelope",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "capacityCap", type: "uint128" },
      { name: "capCeiling", type: "uint128" },
      { name: "reserveUsdc", type: "uint128" },
      { name: "paused", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "loosenPending",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "pendingLoosenCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "loosenProposedAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint40" }],
  },
  {
    type: "function",
    name: "shareToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  // --- Writes this slice of the live app uses. Every one recomputes its own check on-chain
  // (deposit's tier/mandate/capacity math, tightenCap/raiseReserve's direction check, etc.) —
  // seq/receiptHash/reasons/policyInput are logged supporting context, never a trusted
  // enforcement input (the project's core invariant, and the access-control rule that the chain recomputes verdicts).
  {
    type: "function",
    name: "pause",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seq", type: "uint64" },
      { name: "receiptHash", type: "bytes32" },
      { name: "reasons", type: "uint32" },
      { name: "policyInput", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unpause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelLoosen",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "tightenCap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newCap", type: "uint128" },
      { name: "seq", type: "uint64" },
      { name: "receiptHash", type: "bytes32" },
      { name: "reasons", type: "uint32" },
      { name: "policyInput", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "raiseReserve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newReserve", type: "uint128" },
      { name: "seq", type: "uint64" },
      { name: "receiptHash", type: "bytes32" },
      { name: "reasons", type: "uint32" },
      { name: "policyInput", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "proposeLoosenCap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newCap", type: "uint128" },
      { name: "seq", type: "uint64" },
      { name: "receiptHash", type: "bytes32" },
      { name: "reasons", type: "uint32" },
      { name: "policyInput", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "applyLoosen",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "graduate",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "requestRedeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint128" },
      { name: "seq", type: "uint64" },
      { name: "receiptHash", type: "bytes32" },
      { name: "reasons", type: "uint32" },
      { name: "policyInput", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setMandate",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "m",
        type: "tuple",
        components: [
          { name: "maxTxUsdc", type: "uint128" },
          { name: "maxBps", type: "uint16" },
          { name: "maxVaultUsdc", type: "uint128" },
          { name: "minLiquidUsdc", type: "uint128" },
          { name: "maxActionsPerDay", type: "uint32" },
          { name: "expiry", type: "uint40" },
          { name: "loosenDelay", type: "uint32" },
          { name: "issuerHaircutBps", type: "uint16" },
          { name: "latencyHaircutBpsPerDay", type: "uint16" },
          { name: "latencyHaircutMaxBps", type: "uint16" },
          { name: "leadFloorDays", type: "uint32" },
          { name: "approvalAbove", type: "uint128" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setCapCeiling",
    stateMutability: "nonpayable",
    inputs: [{ name: "c", type: "uint128" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setCap",
    stateMutability: "nonpayable",
    inputs: [{ name: "c", type: "uint128" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setReserve",
    stateMutability: "nonpayable",
    inputs: [{ name: "r", type: "uint128" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Decision",
    inputs: [
      { name: "actor", type: "address", indexed: true },
      { name: "seq", type: "uint64", indexed: true },
      { name: "receiptHash", type: "bytes32", indexed: true },
      { name: "action", type: "uint8", indexed: false },
      { name: "amount", type: "uint128", indexed: false },
      { name: "verdict", type: "uint8", indexed: false },
      { name: "reasonMask", type: "uint32", indexed: false },
      { name: "policyInput", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Graduated",
    inputs: [
      { name: "fromTier", type: "uint8", indexed: false },
      { name: "toTier", type: "uint8", indexed: false },
      { name: "riskUnits", type: "uint128", indexed: false },
      { name: "receipts", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Demoted",
    inputs: [
      { name: "fromTier", type: "uint8", indexed: false },
      { name: "toTier", type: "uint8", indexed: false },
      { name: "incidentType", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LoosenProposed",
    inputs: [
      { name: "newCap", type: "uint128", indexed: false },
      { name: "applicableAt", type: "uint40", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LoosenCancelled",
    inputs: [{ name: "vetoedCap", type: "uint128", indexed: false }],
  },
  {
    type: "event",
    name: "LoosenApplied",
    inputs: [{ name: "newCap", type: "uint128", indexed: false }],
  },
] as const;

// Separate ABI, not merged into stewardAccountAbi: this is called against `usdc`'s own
// address (read from the StewardAccount via its `usdc()` getter), not against the account
// itself. Only the one function the dashboard needs.
export const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const ACTION_NAMES = ["DEPOSIT", "REDEEM", "HOLD"] as const;
export const VERDICT_NAMES = ["ALLOW", "ALLOW_CLAMPED", "NEEDS_APPROVAL", "REFUSE"] as const;

// spec/accounting.md section 5 — canonical reason bit order, index = bit position.
export const REASON_BIT_NAMES = [
  "OK", "HOLD_NOOP", "MANDATE_INVALID", "MANDATE_EXPIRED", "AGENT_MISMATCH",
  "TARGET_NOT_ALLOWED", "OVER_CAPACITY", "OVER_MAX_TX", "BELOW_RESERVE", "STALE_EVIDENCE",
  "CODEHASH_CHANGED", "DRAWDOWN_PAUSE", "ADVERSE_CLAIM", "UNGROUNDED_CLAIM", "RATE_LIMIT",
  "ABOVE_APPROVAL_THRESHOLD", "HARD_CAP", "PROPOSAL_INVALID", "MODEL_FAILED_OUTPUT",
  "OWNER_PAUSED", "MANDATORY_DERISK",
] as const;

// reasonMask is a uint32 in the ABI (spec/accounting.md section 5, at most 21 bits used) —
// viem decodes uintN <= 48 bits as a plain JS `number`, not `bigint` (only wider types like
// uint128/uint256 need bigint to avoid precision loss). A first draft of this function typed
// the parameter as `bigint` and did bigint bitwise math on it — `number & bigint` throws
// "Cannot mix BigInt and other types" at runtime, caught live while testing the verifier
// against real Phase 4 data (the error was clean and visible, not silent — exactly what the
// error-boundary in app/verify/page.tsx exists for). Plain number bitwise ops are correct and
// sufficient here: 21 bits fits safely within JS's 32-bit bitwise operators.
export function decodeReasonMask(mask: number): string[] {
  const bits: string[] = [];
  for (let i = 0; i < REASON_BIT_NAMES.length; i++) {
    if ((mask & (1 << i)) !== 0) bits.push(REASON_BIT_NAMES[i]!);
  }
  return bits;
}
