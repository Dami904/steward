"use client";

// The plan: "Frozen canonical scenarios run live in the browser through the
// TypeScript engine... Controls: mandate sliders, an 'evidence health' slider that moves
// capacity in real time, and the attack lab. Judges can use this without a wallet or funds."
//
// Runs entirely client-side, no RPC, no server round-trip — every recompute below is a
// direct call into the real @steward/engine functions (checkDeposit, computeCapacity,
// capMandate, capLiquid), the same ones the contracts' three-way differential suite already
// holds to account. Design rule from the plan, applied here too: "the browser
// never invents a financial number" — every figure on screen comes straight out of the
// policy package, nothing is a UI-side approximation.
//
// Deep imports (../../../../packages/engine/src/*.ts, not the package's barrel export) are
// deliberate: packages/engine/src/health.ts and evidence.ts import node:crypto for their hash
// functions, which client bundles can't resolve. Simulate only needs the capacity/verdict
// math (accounting.ts, policy.ts, tiers.ts, types.ts), so importing those files directly
// avoids pulling node:crypto into the browser bundle at all — the barrel's `export *` would
// have evaluated health.ts's top-level import regardless of whether anything from it was
// actually called.

import { useMemo, useState } from "react";
import { checkDeposit } from "../../../../packages/engine/src/policy.ts";
import { capMandate, capLiquid, computeCapacity, type HealthMultiplier } from "../../../../packages/engine/src/accounting.ts";
import { tierLimitsFor } from "../../../../packages/engine/src/tiers.ts";
import { TIER_SCHEDULE, type Mandate, type VaultReadState } from "../../../../packages/engine/src/types.ts";
import { decodeReasons, REASON_EXPLANATIONS } from "@/lib/reasons";

// The engine's own canonical unit is a small whole number, not a wei/1e18 fixed-point value
// — confirmed against fixtures/differential/deposit_cases.json (amount: "100", maxVaultUsdc:
// "1200", treasury: "10000", etc.) and packages/engine/src/types.ts's TIER_SCHEDULE (maxVault:
// 150n..1200n, matching HARD_CAP = 1200n). Real on-chain amounts ARE wei-scaled
// (contracts/src/libraries/Types.sol: 1200e18) — bridging that gap is the caller's job
// (apps/web/lib/replay.ts feeds real on-chain wei amounts into the same functions unscaled,
// which is a separate, pre-existing inconsistency noted in docs/LIMITATIONS.md, not something
// this page repeats). Simulate never touches the chain, so it stays entirely in the engine's
// own native scale — no wei conversion anywhere below.
function toUnits(whole: number): bigint {
  return BigInt(Math.round(whole));
}
function fromUnits(v: bigint): string {
  return Number(v).toLocaleString();
}

// Unlike the dollar-amount fields above, navPerShare is always an 18-decimal fixed-point
// ratio by convention (spec/accounting.md section 1) — unrelated to the wei-vs-whole-unit
// question for treasury/mandate amounts. checkDeposit doesn't actually read vault.navPerShare
// (only vault.minDepositAssets), so this only needs to be a plausible, correctly-scaled value.
const NAV_SCALE = 10n ** 18n;

const VERDICT_NAMES = ["ALLOW", "ALLOW_CLAMPED", "NEEDS_APPROVAL", "REFUSE"] as const;

type EvidenceHealthState = "healthy" | "single_adverse" | "severe_or_stale";
const HEALTH_MULTIPLIER: Record<EvidenceHealthState, HealthMultiplier> = {
  healthy: 10000n,
  single_adverse: 5000n,
  severe_or_stale: 0n,
};

interface ScenarioState {
  tier: number;
  treasury: number; // whole units, UI-facing
  reserve: number;
  proposedAmount: number;
  maxTxUsdc: number;
  maxBps: number; // out of 10000
  maxVaultUsdc: number;
  minLiquidUsdc: number;
  approvalAbove: number;
  ownerCap: number; // envelope.capacityCap equivalent — 0 means "unbounded" in this UI
  evidenceHealth: EvidenceHealthState;
  evidenceFresh: boolean;
  paused: boolean;
}

const DEFAULT_STATE: ScenarioState = {
  tier: 1,
  treasury: 500,
  reserve: 0,
  proposedAmount: 150,
  maxTxUsdc: 1200,
  maxBps: 10000,
  maxVaultUsdc: 1200,
  minLiquidUsdc: 0,
  approvalAbove: 500,
  ownerCap: 0,
  evidenceHealth: "healthy",
  evidenceFresh: true,
  paused: false,
};

// Each preset is defined relative to DEFAULT_STATE, not the current on-screen state, so
// clicking through them in any order always reproduces exactly the verdict its own
// description claims — never a compounding effect left over from a previous click.
const ATTACKS: { label: string; description: string; apply: () => ScenarioState }[] = [
  // Amounts stay at or above the vault's 100-unit minimum deposit, so each attack shows only
  // the reason it is about (a smaller amount would add PROPOSAL_INVALID to every one).
  {
    label: "Over mandate's maxTx",
    description: "The owner capped each deposit at 120. The agent asks for 150.",
    apply: () => ({ ...DEFAULT_STATE, maxTxUsdc: 120, proposedAmount: 150 }),
  },
  {
    label: "Over the tier's per-deposit cap",
    description: "A new T0 agent is capped at 120 per deposit, whatever the mandate allows.",
    apply: () => ({ ...DEFAULT_STATE, tier: 0, proposedAmount: 130 }),
  },
  {
    label: "Over tier's capacity",
    description: "Generous mandate, but more than the tier allows in total (and per deposit).",
    apply: () => ({
      ...DEFAULT_STATE,
      treasury: 5000,
      maxTxUsdc: 5000,
      maxVaultUsdc: 5000,
      proposedAmount: Number(tierLimitsFor(DEFAULT_STATE.tier).maxVault) + 50,
    }),
  },
  {
    label: "Stale evidence",
    description: "Evidence too old to trust.",
    apply: () => ({ ...DEFAULT_STATE, evidenceFresh: false, proposedAmount: 150 }),
  },
  {
    label: "Severe corroborated adverse claim",
    description: "Two sources agree on bad news. Capacity goes to 0.",
    apply: () => ({ ...DEFAULT_STATE, evidenceHealth: "severe_or_stale", proposedAmount: 150 }),
  },
  {
    label: "Below reserve after withdrawal",
    description: "Would eat into the redemption buffer.",
    apply: () => ({ ...DEFAULT_STATE, reserve: DEFAULT_STATE.treasury - 10, proposedAmount: 150 }),
  },
  {
    label: "Owner has paused the account",
    description: "Every deposit stops until unpaused.",
    apply: () => ({ ...DEFAULT_STATE, paused: true, proposedAmount: 150 }),
  },
  {
    label: "Reset to a clean ALLOW",
    description: "Back to a healthy scenario.",
    apply: () => ({ ...DEFAULT_STATE }),
  },
];

function Slider({ label, value, min, max, step = 1, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-ink-muted">{label}</span>
        <span className="tabular-nums text-ink-faint text-xs">{value.toLocaleString()}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[#3e7c6a]"
      />
    </label>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-surface border border-border p-6 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display font-bold text-xl tracking-tight">{title}</h2>
        {hint && <span className="text-xs text-ink-faintest">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    ALLOW: "bg-[#2f8f5b] text-white",
    ALLOW_CLAMPED: "bg-[#2f8f5b] text-white",
    NEEDS_APPROVAL: "bg-[#c9922e] text-white",
    REFUSE: "bg-[#c4543f] text-white",
  };
  return <span className={`px-3.5 py-1.5 rounded-full text-sm font-bold tracking-wide ${styles[verdict] ?? ""}`}>{verdict.replace("_", " ")}</span>;
}

export default function Simulator() {
  const [s, setS] = useState<ScenarioState>(DEFAULT_STATE);
  const patch = (p: Partial<ScenarioState>) => setS((prev) => ({ ...prev, ...p }));

  const result = useMemo(() => {
    const treasury = toUnits(s.treasury);
    const reserveAmt = toUnits(s.reserve);
    const amount = toUnits(s.proposedAmount);
    const exposure = 0n; // Simulate models a fresh proposal against idle capacity, not an accumulated position

    const mandate: Mandate = {
      maxTxUsdc: toUnits(s.maxTxUsdc),
      maxBps: BigInt(s.maxBps),
      maxVaultUsdc: toUnits(s.maxVaultUsdc),
      minLiquidUsdc: toUnits(s.minLiquidUsdc),
      maxActionsPerDay: 100,
      expiry: 9999999999,
      loosenDelay: 0,
      feeBps: 0n,
      maxFeeBps: 0n,
      operator: "0x0",
      issuerHaircutBps: 0n,
      latencyHaircutBpsPerDay: 0n,
      latencyHaircutMaxBps: 0n,
      leadFloorDays: 14,
      latencySafety: 1,
      bufferDays: 0,
      approvalAbove: toUnits(s.approvalAbove),
    };
    const vault: VaultReadState = {
      navPerShare: NAV_SCALE,
      shares: 0n,
      liquid: treasury,
      finalizedNotYetClaimed: 0n,
      pendingRedemptionExpectedHaircut: 0n,
      minDepositAssets: toUnits(100), // matches the real vault's measured 100-unit floor
      minRedeemAssets: toUnits(100),
      paused: false,
      codehash: "0xabc",
      expectedCodehash: "0xabc",
    };

    const tierLimits = tierLimitsFor(s.tier);
    const capMandateVal = capMandate(mandate, treasury);
    const capLiquidVal = capLiquid(treasury, reserveAmt);
    const capTierVal = tierLimits.maxVault;
    const capHealthVal = mandate.maxVaultUsdc; // health feed's own tighten-only cap isn't modeled here — see the note in the page below
    const ownerCapVal = s.ownerCap > 0 ? toUnits(s.ownerCap) : mandate.maxVaultUsdc;

    const capacity = computeCapacity({
      treasury,
      capMandate: capMandateVal,
      capLiquid: capLiquidVal,
      capTier: capTierVal,
      capHealth: capHealthVal,
      capacityCapOnChain: ownerCapVal,
      healthMultiplierBps: HEALTH_MULTIPLIER[s.evidenceHealth],
      exposure,
    });

    const verdictResult = checkDeposit({
      amount,
      mandate,
      vault,
      capacityInputs: {
        treasury,
        capMandate: capMandateVal,
        capLiquid: capLiquidVal,
        capTier: capTierVal,
        capHealth: capHealthVal,
        capacityCapOnChain: ownerCapVal,
        healthMultiplierBps: HEALTH_MULTIPLIER[s.evidenceHealth],
        exposure,
      },
      liquidAfter: treasury - amount,
      reserveAmt,
      dailyActionsSoFar: 0,
      evidenceFresh: s.evidenceFresh,
      adverseClaimPresent: s.evidenceHealth !== "healthy" && s.evidenceFresh,
      ungroundedClaimPresent: false,
      now: 1000,
      mandateExpiry: mandate.expiry,
      tierMaxTx: tierLimits.maxTx,
      tierActionsPerDay: tierLimits.actionsPerDay,
      paused: s.paused,
    });

    const bindingNames = ["capMandate", "capLiquid", "capTier", "capHealth", "capacityCapOnChain"] as const;

    return {
      capacity,
      verdict: VERDICT_NAMES[verdictResult.verdict],
      reasons: decodeReasons(verdictResult.reasons),
      bindingTerm: bindingNames[verdictResult.bindingTerm],
      tierLimits,
    };
  }, [s]);

  return (
    <div className="grid lg:grid-cols-[1fr_1fr] gap-5 items-start">
      <div className="flex flex-col gap-5">
        <Panel title="Agent">
          <div className="flex gap-2">
            {TIER_SCHEDULE.map((_, i) => (
              <button
                key={i}
                onClick={() => patch({ tier: i })}
                className={`flex-1 py-2 rounded-full text-sm font-bold transition-colors ${s.tier === i ? "bg-ink text-cream" : "bg-cream border border-border text-ink-faint hover:border-ink"}`}
              >
                T{i}
              </button>
            ))}
          </div>
          <Slider label="Proposed deposit" value={s.proposedAmount} min={0} max={2000} onChange={(v) => patch({ proposedAmount: v })} />
          <Slider label="Treasury (liquid)" value={s.treasury} min={0} max={5000} onChange={(v) => patch({ treasury: v })} />
          <Slider label="Reserve" value={s.reserve} min={0} max={s.treasury} onChange={(v) => patch({ reserve: v })} />
        </Panel>

        <Panel title="Mandate" hint="set by the owner">
          <Slider label="maxTxUsdc" value={s.maxTxUsdc} min={0} max={5000} onChange={(v) => patch({ maxTxUsdc: v })} />
          <Slider label="maxBps" value={s.maxBps} min={0} max={10000} step={100} unit=" bps" onChange={(v) => patch({ maxBps: v })} />
          <Slider label="maxVaultUsdc" value={s.maxVaultUsdc} min={0} max={5000} onChange={(v) => patch({ maxVaultUsdc: v })} />
          <Slider label="minLiquidUsdc" value={s.minLiquidUsdc} min={0} max={500} onChange={(v) => patch({ minLiquidUsdc: v })} />
          <Slider label="approvalAbove" value={s.approvalAbove} min={0} max={1500} onChange={(v) => patch({ approvalAbove: v })} />
          <Slider label="Owner cap (0 = none)" value={s.ownerCap} min={0} max={1500} onChange={(v) => patch({ ownerCap: v })} />
        </Panel>

        <Panel title="Evidence">
          <div className="flex gap-2">
            {(["healthy", "single_adverse", "severe_or_stale"] as EvidenceHealthState[]).map((h) => (
              <button
                key={h}
                onClick={() => patch({ evidenceHealth: h })}
                className={`flex-1 py-2 rounded-full text-xs font-bold transition-colors ${s.evidenceHealth === h ? "bg-ink text-cream" : "bg-cream border border-border text-ink-faint hover:border-ink"}`}
              >
                {h === "healthy" ? "Healthy 1×" : h === "single_adverse" ? "Adverse 0.5×" : "Severe 0×"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
            <input type="checkbox" className="accent-[#3e7c6a]" checked={s.evidenceFresh} onChange={(e) => patch({ evidenceFresh: e.target.checked })} />
            Evidence is fresh
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
            <input type="checkbox" className="accent-[#3e7c6a]" checked={s.paused} onChange={(e) => patch({ paused: e.target.checked })} />
            Account paused
          </label>
        </Panel>
      </div>

      <div className="flex flex-col gap-5 lg:sticky lg:top-6">
        <div className="rounded-3xl bg-[#12110e] text-white p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-2xl tracking-tight">Verdict</h2>
            <VerdictBadge verdict={result.verdict} />
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <div className="text-white/45 text-xs mb-0.5">capacity</div>
              <div className="font-display font-bold text-3xl tabular-nums">{fromUnits(result.capacity.capacity)}</div>
            </div>
            <div>
              <div className="text-white/45 text-xs mb-0.5">headroom</div>
              <div className="font-display font-bold text-3xl tabular-nums">{fromUnits(result.capacity.headroom)}</div>
            </div>
            <div>
              <div className="text-white/45 text-xs mb-0.5">binding term</div>
              <div className="font-semibold text-[#8fd1bb]">{result.bindingTerm}</div>
            </div>
            <div>
              <div className="text-white/45 text-xs mb-0.5">tier ceiling (maxVault)</div>
              <div className="font-semibold tabular-nums">{fromUnits(result.tierLimits.maxVault)}</div>
            </div>
          </div>
          <div>
            <div className="text-white/45 text-xs mb-1.5">reasons</div>
            <ul className="flex flex-col gap-1.5">
              {result.reasons.map((r) => (
                <li key={r} className="flex flex-wrap items-center gap-2 text-xs text-white/65">
                  <span className="px-2.5 py-1 rounded-full font-bold bg-white/10 text-white/85">{r}</span>
                  {REASON_EXPLANATIONS[r]}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Panel title="Attack lab" hint="one click, one attack">
          <div className="grid sm:grid-cols-2 gap-2">
            {ATTACKS.map((a) => (
              <button
                key={a.label}
                onClick={() => setS(a.apply())}
                className="text-left rounded-2xl bg-cream border border-border px-4 py-3 hover:border-ink transition-colors"
              >
                <div className="text-sm font-bold">{a.label}</div>
                <div className="text-xs text-ink-faint">{a.description}</div>
              </button>
            ))}
          </div>
        </Panel>

        <p className="text-xs text-ink-faintest">
          Deposit math only. Health-feed cap, graduation and redemptions aren&apos;t modeled here.
        </p>
      </div>
    </div>
  );
}
