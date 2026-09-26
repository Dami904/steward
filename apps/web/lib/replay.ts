// The verifier's actual verification logic: independently replay the on-chain event history
// through @steward/engine — the exact same TypeScript policy/tier engine the contracts'
// differential suite already agrees with (spec/accounting.md invariant P-08) — and compare
// the result to what the contract's current state actually reads. This generalizes
// scripts/replay-fork-demo.ts's Phase 4 single-graduation check into a reusable, any-address
// verifier.
//
// Documented limits, stated here rather than left implicit (PLAN_v2 section 12.1: "it states
// its own limit"):
// - The starting tier is a caller-provided assumption (default 0, correct for any brand-new
//   stranger — the common case, and what Phase 4's Agent A/B both started as), not derived
//   from StewardFactory's own AccountCreated event, which this verifier does not query. An
//   account created above T0 (an agent with a prior conduct record) needs its real start tier
//   supplied, or this replay will diverge from block one.
// - Every event on this log is, by construction, a transaction that actually succeeded — a
//   revert never emits an event, so there is no "REFUSE" event to find. This does not mean
//   every proposal the agent considered was allowed; it means only successes are visible
//   on-chain. Nothing here claims otherwise.
// - `policyInput` is decoded and shown when present, but as of this build no orchestrator
//   populates it with real content (docs/LIMITATIONS.md) — Phase 4's own demo transactions
//   all used empty policyInput. An empty policyInput is reported as "not provided", not as a
//   verification failure.

import {
  initialTierState,
  recordExposure,
  recordReceipt,
  checkPromotion,
  graduate,
  applyIncident,
  type TierState,
  type IncidentType,
} from "@steward/engine";
import { blockTimestamp, type RawEvent } from "./chain";
import { ACTION_NAMES, VERDICT_NAMES, decodeReasonMask } from "./steward-abi";

const DEMO_TIME_UNIT_SECONDS = 60; // Types.DEMO_TIME_UNIT_SECONDS — this repo's demo-speed tiers

const INCIDENT_TYPE_NAMES: readonly IncidentType[] = ["LOOSEN_VETOED", "OWNER_PAUSE", "OVERCAP_GRACE_EXCEEDED"];

export interface ReceiptRow {
  seq: string | null;
  kind: RawEvent["kind"];
  action: string | null;
  amount: string | null;
  verdict: string | null;
  reasons: string[];
  blockNumber: string;
  txHash: string;
  policyInputProvided: boolean;
  note?: string;
}

export interface GraduationCheck {
  atEvent: number; // index into rows
  claimedFromTier: number;
  claimedToTier: number;
  independentlyEligible: boolean;
  failedConditions: string[];
  agrees: boolean;
}

export interface ReplayResult {
  rows: ReceiptRow[];
  seqContinuityOk: boolean;
  seqGaps: string[];
  replayedFinalTier: number;
  graduationChecks: GraduationCheck[];
  onChainTier: number;
  finalTierMatchesOnChain: boolean;
}

export async function replayHistory(
  rpcUrl: string,
  events: RawEvent[],
  startTier: number,
  onChainTier: number,
): Promise<ReplayResult> {
  const sorted = [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });

  const rows: ReceiptRow[] = [];
  const graduationChecks: GraduationCheck[] = [];
  let seqContinuityOk = true;
  const seqGaps: string[] = [];
  let expectedSeq = 1n;
  let cumulativeExposure = 0n;

  let state: TierState | null = null;

  for (const event of sorted) {
    const ts = await blockTimestamp(rpcUrl, event.blockNumber);
    if (state === null) state = initialTierState(ts, startTier);

    if (event.kind === "Decision") {
      const seq = event.args["seq"] as bigint;
      const action = Number(event.args["action"] as number);
      const amount = event.args["amount"] as bigint;
      const verdict = Number(event.args["verdict"] as number);
      const reasonMask = event.args["reasonMask"] as number; // uint32 -> viem decodes as number, not bigint
      const policyInput = event.args["policyInput"] as string;

      if (seq !== expectedSeq) {
        seqContinuityOk = false;
        seqGaps.push(`expected seq ${expectedSeq}, event has seq ${seq} (tx ${event.transactionHash})`);
      }
      expectedSeq = seq + 1n;

      if (action === 0) {
        // DEPOSIT: StewardAccount.deposit() calls TierEngine.recordExposure then recordReceipt.
        cumulativeExposure += amount;
        state = recordExposure(state, ts, cumulativeExposure);
        state = recordReceipt(state);
      } else {
        // REDEEM / HOLD (requestRedeem, reconcileRedemption, logDecision): recordReceipt only
        // — none of these call recordExposure on-chain (contracts/src/StewardAccount.sol).
        state = recordReceipt(state);
      }

      rows.push({
        seq: seq.toString(),
        kind: "Decision",
        action: ACTION_NAMES[action] ?? `unknown(${action})`,
        amount: amount.toString(),
        verdict: VERDICT_NAMES[verdict] ?? `unknown(${verdict})`,
        reasons: decodeReasonMask(reasonMask),
        blockNumber: event.blockNumber.toString(),
        txHash: event.transactionHash,
        policyInputProvided: policyInput !== "0x" && policyInput.length > 2,
      });
    } else if (event.kind === "Graduated") {
      const fromTier = Number(event.args["fromTier"] as number);
      const toTier = Number(event.args["toTier"] as number);

      // The independent check: does the replayed state ALSO think promotion was legitimate
      // right before this event, using the exact predicate contracts/src/libraries/TierEngine
      // .sol and packages/engine/src/tiers.ts both implement?
      const check = checkPromotion(state, ts, DEMO_TIME_UNIT_SECONDS, {
        paused: false,
        mandateExpired: false,
        evidenceStale: false,
      });
      graduationChecks.push({
        atEvent: rows.length,
        claimedFromTier: fromTier,
        claimedToTier: toTier,
        independentlyEligible: check.eligible,
        failedConditions: check.failedConditions,
        agrees: check.eligible && state.tier === fromTier,
      });

      state = graduate(state, ts);

      rows.push({
        seq: null,
        kind: "Graduated",
        action: null,
        amount: null,
        verdict: null,
        reasons: [],
        blockNumber: event.blockNumber.toString(),
        txHash: event.transactionHash,
        policyInputProvided: false,
        note: `tier ${fromTier} -> ${toTier}`,
      });
    } else if (event.kind === "Demoted") {
      const fromTier = Number(event.args["fromTier"] as number);
      const toTier = Number(event.args["toTier"] as number);
      const incidentType = Number(event.args["incidentType"] as number);
      const incidentName = INCIDENT_TYPE_NAMES[incidentType];

      if (incidentName !== undefined) {
        state = applyIncident(state, incidentName, ts);
      }

      rows.push({
        seq: null,
        kind: "Demoted",
        action: null,
        amount: null,
        verdict: null,
        reasons: [],
        blockNumber: event.blockNumber.toString(),
        txHash: event.transactionHash,
        policyInputProvided: false,
        note: `tier ${fromTier} -> ${toTier} (${incidentName ?? `unknown incident ${incidentType}`})`,
      });
    }
  }

  const replayedFinalTier = state?.tier ?? startTier;

  return {
    rows,
    seqContinuityOk,
    seqGaps,
    replayedFinalTier,
    graduationChecks,
    onChainTier,
    finalTierMatchesOnChain: replayedFinalTier === onChainTier,
  };
}
