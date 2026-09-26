"use client";

// serv PLAN_v2.md section 12.3 lists "attack lab" as part of the live app, and separately
// "approvals inbox" — checked against the real contract (contracts/src/StewardAccount.sol):
// `approvalAbove` is a Mandate field that is never read by deposit() or any other on-chain
// function. NEEDS_APPROVAL is purely an off-chain @steward/engine concept today; the contract
// doesn't gate deposits on owner approval at all (deposits are agent-immediate). An
// "approvals inbox" as a live, actionable on-chain queue would be dishonest to build — there
// is nothing to approve on-chain. What IS real and buildable: a pre-flight preview, using the
// actual policy engine against the account's real live state, that tells an agent (or anyone
// watching) whether a proposed amount would cross the approval threshold or get refused
// BEFORE it's submitted — which is what this component is. Doubles as the attack lab: the
// preset buttons below are the same adversarial scenarios Simulate's attack lab uses, applied
// to this account's real numbers instead of a frozen scenario.
//
// Read-only — no wallet, no writes, no seq. Deep-imports (bypassing packages/engine/src/
// index.ts's barrel, which pulls in node:crypto via health.ts/evidence.ts — see
// apps/web/app/simulate/Simulator.tsx's identical header note) the same real functions
// Simulate and the live dashboard's capacity gauge use — never a UI-side reimplementation.
import { useMemo, useState } from "react";
import { checkDeposit } from "../../../../packages/engine/src/policy.ts";
import { capMandate, capLiquid, computeCapacity } from "../../../../packages/engine/src/accounting.ts";
import { TIER_SCHEDULE, type Mandate, type VaultReadState } from "../../../../packages/engine/src/types.ts";
import type { OnChainAccountState } from "@/lib/chain";

const WEI = 10n ** 18n;
function fromWei(v: bigint): string {
  return (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const VERDICT_NAMES = ["ALLOW", "ALLOW_CLAMPED", "NEEDS_APPROVAL", "REFUSE"] as const;
const REASON_BIT_NAMES = [
  "OK", "HOLD_NOOP", "MANDATE_INVALID", "MANDATE_EXPIRED", "AGENT_MISMATCH",
  "TARGET_NOT_ALLOWED", "OVER_CAPACITY", "OVER_MAX_TX", "BELOW_RESERVE", "STALE_EVIDENCE",
  "CODEHASH_CHANGED", "DRAWDOWN_PAUSE", "ADVERSE_CLAIM", "UNGROUNDED_CLAIM", "RATE_LIMIT",
  "ABOVE_APPROVAL_THRESHOLD", "HARD_CAP", "PROPOSAL_INVALID", "MODEL_FAILED_OUTPUT",
  "OWNER_PAUSED", "MANDATORY_DERISK",
] as const;
function decodeReasons(mask: bigint): string[] {
  const out: string[] = [];
  for (let i = 0; i < REASON_BIT_NAMES.length; i++) if ((mask & (1n << BigInt(i))) !== 0n) out.push(REASON_BIT_NAMES[i]!);
  return out;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    ALLOW: "bg-allow-bg text-allow",
    ALLOW_CLAMPED: "bg-allow-bg text-allow",
    NEEDS_APPROVAL: "bg-approval-bg text-approval",
    REFUSE: "bg-refuse-bg text-refuse",
  };
  return <span className={`px-3 py-1 rounded-full text-sm font-bold tracking-wide ${styles[verdict] ?? ""}`}>{verdict.replace("_", " ")}</span>;
}

const PRESETS = [
  { label: "Right at the mandate's maxTx", pct: null, atMaxTx: true },
  { label: "10% of treasury", pct: 0.1, atMaxTx: false },
  { label: "50% of treasury", pct: 0.5, atMaxTx: false },
  { label: "Everything (100% of treasury)", pct: 1, atMaxTx: false },
] as const;

export default function AttackLab({ state }: { state: OnChainAccountState }) {
  const treasury = state.liquidBalance + state.exposure;
  const [amountInput, setAmountInput] = useState(fromWei(state.mandate.approvalAbove).replace(/,/g, ""));

  const result = useMemo(() => {
    const amount = (() => {
      const n = Number(amountInput);
      if (!Number.isFinite(n) || n < 0) return 0n;
      return BigInt(Math.round(n * 1e6)) * (WEI / 1_000_000n);
    })();

    const mandate: Mandate = {
      maxTxUsdc: state.mandate.maxTxUsdc,
      maxBps: BigInt(state.mandate.maxBps),
      maxVaultUsdc: state.mandate.maxVaultUsdc,
      minLiquidUsdc: state.mandate.minLiquidUsdc,
      maxActionsPerDay: state.mandate.maxActionsPerDay,
      expiry: state.mandate.expiry,
      loosenDelay: state.mandate.loosenDelay,
      feeBps: 0n,
      maxFeeBps: 0n,
      operator: "0x0",
      issuerHaircutBps: BigInt(state.mandate.issuerHaircutBps),
      latencyHaircutBpsPerDay: BigInt(state.mandate.latencyHaircutBpsPerDay),
      latencyHaircutMaxBps: BigInt(state.mandate.latencyHaircutMaxBps),
      leadFloorDays: state.mandate.leadFloorDays,
      latencySafety: 1,
      bufferDays: 0,
      approvalAbove: state.mandate.approvalAbove,
    };
    const vault: VaultReadState = {
      navPerShare: WEI,
      shares: 0n,
      liquid: state.liquidBalance,
      finalizedNotYetClaimed: 0n,
      pendingRedemptionExpectedHaircut: 0n,
      minDepositAssets: 100n * WEI,
      minRedeemAssets: 100n * WEI,
      paused: false,
      codehash: "0xabc",
      expectedCodehash: "0xabc",
    };

    const tierLimits = TIER_SCHEDULE[state.tierState.tier];
    const capMandateVal = capMandate(mandate, treasury);
    const capLiquidVal = capLiquid(treasury, state.envelope.reserveUsdc);
    // Same ×1e18 fix as apps/web/lib/live-capacity.ts, same reason: TIER_SCHEDULE is
    // unscaled, real on-chain amounts aren't.
    const capTierVal = (tierLimits?.maxVault ?? 0n) * WEI;
    const capHealthVal = capMandateVal; // not wired here either — same documented gap as live-capacity.ts

    const capacityInputs = {
      treasury,
      capMandate: capMandateVal,
      capLiquid: capLiquidVal,
      capTier: capTierVal,
      capHealth: capHealthVal,
      capacityCapOnChain: state.envelope.capacityCap,
      healthMultiplierBps: 10000n as const,
      exposure: state.exposure,
    };

    const verdictResult = checkDeposit({
      amount,
      mandate,
      vault,
      capacityInputs,
      liquidAfter: state.liquidBalance > amount ? state.liquidBalance - amount : 0n,
      reserveAmt: state.envelope.reserveUsdc,
      dailyActionsSoFar: 0,
      evidenceFresh: true,
      adverseClaimPresent: false,
      ungroundedClaimPresent: false,
      now: state.mandate.expiry > 0 ? state.mandate.expiry - 1 : 0,
      mandateExpiry: state.mandate.expiry,
      paused: state.envelope.paused,
    });

    const capacity = computeCapacity(capacityInputs);

    return { amount, verdict: VERDICT_NAMES[verdictResult.verdict], reasons: decodeReasons(verdictResult.reasons), capacity };
  }, [amountInput, state, treasury]);

  return (
    <div className="rounded-3xl bg-surface border border-border p-6 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display font-bold text-2xl tracking-tight">Pre-flight check</h2>
        <span className="text-xs text-ink-faintest">read-only · nothing is sent</span>
      </div>
      <p className="text-sm text-ink-muted -mt-2">
        What would the engine say to this deposit, right now? <code>approvalAbove</code> is
        advisory: the contract doesn&apos;t enforce it.
      </p>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              if (p.atMaxTx) {
                setAmountInput(fromWei(state.mandate.maxTxUsdc).replace(/,/g, ""));
              } else {
                const v = (treasury * BigInt(Math.round(p.pct * 10000))) / 10000n;
                setAmountInput(fromWei(v).replace(/,/g, ""));
              }
            }}
            className="rounded-full bg-cream border border-border px-3.5 py-1.5 text-xs font-bold text-ink-faint hover:border-ink transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm w-56">
          <span className="font-semibold text-ink-muted">Deposit amount</span>
          <input value={amountInput} onChange={(e) => setAmountInput(e.target.value)} className="border border-border rounded-xl px-3.5 py-2.5 text-sm bg-cream focus:outline-none focus:border-green" />
        </label>
        <div className="flex items-center gap-3 pb-1.5">
          <VerdictBadge verdict={result.verdict} />
          <span className="text-sm text-ink-faint">headroom {fromWei(result.capacity.headroom)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {result.reasons.map((r) => (
          <span key={r} className="px-2.5 py-1 rounded-full text-xs font-bold bg-cream border border-border text-ink-muted">{r}</span>
        ))}
      </div>
    </div>
  );
}
