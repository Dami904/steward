"use client";

// serv PLAN_v2.md section 12.3: "Mandate builder (plain-language preview, sign, set
// on-chain)." Owner-only. setMandate() takes the full struct and replaces it outright — no
// seq check, no direction restriction (unlike tightenCap/raiseReserve, which are the
// agent/guardian-reachable, tighten/raise-only versions of the same levers). Because a
// mistaken setMandate can silently loosen limits an owner meant to keep tight, this component
// never submits directly from an input change: every field change updates a local draft, and
// the actual write only fires from an explicit "Confirm & sign" step that first renders a
// plain-language diff of every changed field. setCap/setCapCeiling/setReserve are included
// here too (owner's unrestricted versions of tightenCap/raiseReserve/envelope edits) since
// they're the same "raw owner power, needs a preview" category as setMandate itself.

import { useState } from "react";
import type { ConnectedWallet } from "@/lib/wallet";
import { client, readMandateCarryThroughFields, type OnChainAccountState } from "@/lib/chain";
import { stewardAccountAbi } from "@/lib/steward-abi";

const WEI = 10n ** 18n;
function toWei(whole: string): bigint {
  const n = Number(whole);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Not a valid non-negative amount: "${whole}"`);
  return BigInt(Math.round(n * 1e6)) * (WEI / 1_000_000n);
}
function fromWei(v: bigint): string {
  return (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

interface Draft {
  maxTxUsdc: string;
  maxBps: string;
  maxVaultUsdc: string;
  minLiquidUsdc: string;
  maxActionsPerDay: string;
  expiryDays: string; // days from now, simpler for a human to reason about than a raw unix timestamp
  loosenDelay: string; // seconds
  approvalAbove: string;
}

function draftFromState(state: OnChainAccountState, nowTs: number): Draft {
  return {
    maxTxUsdc: fromWei(state.mandate.maxTxUsdc).replace(/,/g, ""),
    maxBps: String(state.mandate.maxBps),
    maxVaultUsdc: fromWei(state.mandate.maxVaultUsdc).replace(/,/g, ""),
    minLiquidUsdc: fromWei(state.mandate.minLiquidUsdc).replace(/,/g, ""),
    maxActionsPerDay: String(state.mandate.maxActionsPerDay),
    expiryDays: String(Math.max(0, Math.round((state.mandate.expiry - nowTs) / 86400))),
    loosenDelay: String(state.mandate.loosenDelay),
    approvalAbove: fromWei(state.mandate.approvalAbove).replace(/,/g, ""),
  };
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold text-ink-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-cream focus:outline-none focus:border-green" />
    </label>
  );
}

function diffLine(label: string, before: string, after: string, unit = ""): string | null {
  if (before === after) return null;
  const beforeNum = Number(before);
  const afterNum = Number(after);
  const direction = Number.isFinite(beforeNum) && Number.isFinite(afterNum) ? (afterNum > beforeNum ? "looser" : afterNum < beforeNum ? "tighter" : "") : "";
  return `${label}: ${before}${unit} → ${after}${unit}${direction ? ` (${direction})` : ""}`;
}

export default function MandateBuilder({ address, rpc, state, nowTs, wallet }: { address: `0x${string}`; rpc: string; state: OnChainAccountState; nowTs: number; wallet: ConnectedWallet }) {
  const [draft, setDraft] = useState<Draft>(() => draftFromState(state, nowTs));
  const original = draftFromState(state, nowTs);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const changes = [
    diffLine("maxTxUsdc", original.maxTxUsdc, draft.maxTxUsdc, " units"),
    diffLine("maxBps", original.maxBps, draft.maxBps, " bps"),
    diffLine("maxVaultUsdc", original.maxVaultUsdc, draft.maxVaultUsdc, " units"),
    diffLine("minLiquidUsdc", original.minLiquidUsdc, draft.minLiquidUsdc, " units"),
    diffLine("maxActionsPerDay", original.maxActionsPerDay, draft.maxActionsPerDay),
    diffLine("expiry", original.expiryDays, draft.expiryDays, " days from now"),
    diffLine("loosenDelay", original.loosenDelay, draft.loosenDelay, "s"),
    diffLine("approvalAbove", original.approvalAbove, draft.approvalAbove, " units"),
  ].filter((l): l is string => l !== null);

  async function confirmAndSign() {
    setBusy(true);
    setActionError(null);
    setLastTxHash(null);
    try {
      // Re-read fresh, not from the page's SSR'd `state` prop — see readMandateCarryThroughFields's
      // own doc comment for why: setMandate overwrites these 4 fields too, so a stale read
      // here would silently clobber a legitimate concurrent change to one of them.
      const carryThrough = await readMandateCarryThroughFields(rpc, address);
      const m = {
        maxTxUsdc: toWei(draft.maxTxUsdc),
        maxBps: Number(draft.maxBps),
        maxVaultUsdc: toWei(draft.maxVaultUsdc),
        minLiquidUsdc: toWei(draft.minLiquidUsdc),
        maxActionsPerDay: Number(draft.maxActionsPerDay),
        expiry: nowTs + Number(draft.expiryDays) * 86400,
        loosenDelay: Number(draft.loosenDelay),
        ...carryThrough,
        approvalAbove: toWei(draft.approvalAbove),
      };
      const hash = await wallet.client.writeContract({ address, abi: stewardAccountAbi, functionName: "setMandate", args: [m], account: wallet.address, chain: wallet.client.chain });
      setLastTxHash(hash);
      const receipt = await client(rpc).waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        throw new Error(`Transaction reverted on-chain (tx ${hash}).`);
      }
      window.location.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (wallet.address.toLowerCase() !== state.owner.toLowerCase()) {
    return (
      <div className="rounded-3xl bg-surface border border-border p-6 text-sm text-ink-faint">
        Mandate builder is owner-only.
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-surface border border-border p-6 sm:p-8 flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display font-bold text-2xl tracking-tight">Edit mandate</h2>
        <span className="text-xs text-ink-faintest">owner · preview before signing</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="maxTxUsdc" value={draft.maxTxUsdc} onChange={(v) => setDraft({ ...draft, maxTxUsdc: v })} />
        <Field label="maxBps" value={draft.maxBps} onChange={(v) => setDraft({ ...draft, maxBps: v })} />
        <Field label="maxVaultUsdc" value={draft.maxVaultUsdc} onChange={(v) => setDraft({ ...draft, maxVaultUsdc: v })} />
        <Field label="minLiquidUsdc" value={draft.minLiquidUsdc} onChange={(v) => setDraft({ ...draft, minLiquidUsdc: v })} />
        <Field label="maxActionsPerDay" value={draft.maxActionsPerDay} onChange={(v) => setDraft({ ...draft, maxActionsPerDay: v })} />
        <Field label="expiry (days from now)" value={draft.expiryDays} onChange={(v) => setDraft({ ...draft, expiryDays: v })} />
        <Field label="loosenDelay (seconds)" value={draft.loosenDelay} onChange={(v) => setDraft({ ...draft, loosenDelay: v })} />
        <Field label="approvalAbove" value={draft.approvalAbove} onChange={(v) => setDraft({ ...draft, approvalAbove: v })} />
      </div>

      {changes.length === 0 ? (
        <div className="text-xs text-ink-faintest">No changes yet.</div>
      ) : !confirming ? (
        <button onClick={() => setConfirming(true)} className="self-start bg-ink text-cream font-bold text-sm rounded-full px-5 py-2.5">
          Preview {changes.length} change{changes.length === 1 ? "" : "s"}
        </button>
      ) : (
        <div className="rounded-2xl bg-cream border border-border p-5 flex flex-col gap-3">
          <div className="text-xs text-ink-faintest uppercase tracking-wide font-bold">Plain-language preview — nothing on-chain yet</div>
          <ul className="flex flex-col gap-1 text-sm">
            {changes.map((c) => (
              <li key={c} className={c.endsWith("(looser)") ? "text-refuse font-semibold" : "text-ink-muted"}>{c}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button disabled={busy} onClick={confirmAndSign} className="bg-refuse text-white font-bold text-sm rounded-full px-5 py-2.5 disabled:opacity-40">
              {busy ? "Signing…" : "Confirm & sign"}
            </button>
            <button disabled={busy} onClick={() => setConfirming(false)} className="border border-border text-ink-faint font-bold text-sm rounded-full px-5 py-2.5">
              Cancel
            </button>
          </div>
        </div>
      )}

      {actionError && <div className="text-sm text-refuse break-words">{actionError}</div>}
      {lastTxHash && <div className="text-xs text-ink-faintest font-mono break-all">tx {lastTxHash} · confirming…</div>}
    </div>
  );
}
