"use client";

// Owner/agent/guardian controls, wired to real StewardAccount writes. Every action here is a
// MANUAL control move (pause/unpause/veto/tighten/raise/loosen/graduate/emergency redeem),
// not a policy-engine decision — so unlike a real agent's deposit/redeem receipt, there is no
// real policyInput to log. receiptHash is the zero hash and reasons is 0, matching this
// repo's already-established convention for non-agent-decision transactions
// (scripts/demo-driver.ts's Phase 4 deploy/setup calls used empty policyInput for the same
// reason — see spec/DECISIONS.md). This is disclosed in the UI itself, not hidden.
//
// As of this writing, every write in this file originates from a human onClick handler after
// an explicit wallet-signature prompt — no server action, API route, or agent-orchestration
// code imports this component or lib/wallet.ts. That's CLAUDE.md's core invariant in
// practice here, not just asserted: nothing enforces it automatically (no lint rule, no
// architecture test), so it's a fact to re-check on review, not a guarantee this comment can
// promise on its own — a future change wiring a server action into runWrite's logic would
// make this false without this comment noticing.
//
// Wallet connection itself lives one level up (./WalletSection.tsx), shared with
// MandateBuilder — a first draft had each component connect its own wallet independently,
// which meant two separate "Connect wallet" buttons on the same page.

import { useState } from "react";
import type { ConnectedWallet } from "@/lib/wallet";
import { client, readNextSeq, type OnChainAccountState } from "@/lib/chain";
import { stewardAccountAbi } from "@/lib/steward-abi";
import { checkLiveGraduation } from "@/lib/live-graduation";

// Generated, not hand-typed: a bytes32 literal is exactly 64 hex chars, and a manually
// counted string of zeros is exactly the kind of off-by-one that's invisible on read but
// wrong at the byte level — viem would reject it at encode time, so this fails loudly rather
// than silently, but there's no reason to risk it when `repeat` is unambiguous.
const ZERO_HASH = (`0x${"0".repeat(64)}`) as `0x${string}`;
const WEI = 10n ** 18n; // real on-chain amounts are wei-scaled (contracts/src/libraries/Types.sol) — every numeric input below is a "whole unit" the user types, converted here before it ever reaches a write call.

function toWei(whole: string): bigint {
  const n = Number(whole);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Not a valid non-negative amount: "${whole}"`);
  return BigInt(Math.round(n * 1e6)) * (WEI / 1_000_000n);
}
function fromWei(v: bigint): string {
  return (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

type Role = "owner" | "agent" | "guardian" | "none";

function roleOf(address: `0x${string}`, state: OnChainAccountState): Role {
  const a = address.toLowerCase();
  if (a === state.owner.toLowerCase()) return "owner";
  if (a === state.agent.toLowerCase()) return "agent";
  if (a === state.guardian.toLowerCase()) return "guardian";
  return "none";
}

export default function Controls({ address, rpc, state, nowTs, wallet }: { address: `0x${string}`; rpc: string; state: OnChainAccountState; nowTs: number; wallet: ConnectedWallet }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const [tightenInput, setTightenInput] = useState("");
  const [reserveInput, setReserveInput] = useState("");
  const [loosenInput, setLoosenInput] = useState("");
  const [redeemInput, setRedeemInput] = useState("");

  async function runWrite(name: string, fn: (w: ConnectedWallet, seq: bigint) => Promise<`0x${string}`>) {
    setBusy(name);
    setActionError(null);
    setLastTxHash(null);
    try {
      const seq = await readNextSeq(rpc, address); // re-read fresh — the page's own state may be stale by the time this runs
      const hash = await fn(wallet, seq);
      setLastTxHash(hash);
      const receipt = await client(rpc).waitForTransactionReceipt({ hash });
      // waitForTransactionReceipt resolves once the tx is MINED, regardless of outcome — it
      // does not throw on a revert (only on timeout/replacement). A stale seq losing a race
      // (BadSequence), a pause toggled from elsewhere between submit and confirm, or a role
      // change mid-flight all land here as a mined-but-reverted receipt. Checking status
      // explicitly is the fix, not an edge case: without it this function silently reloads
      // the page as if a reverted action succeeded, with no error ever shown — caught by
      // this repo's own reliability-auditor review, not by the passing happy-path e2e test.
      if (receipt.status === "reverted") {
        throw new Error(`Transaction reverted on-chain (tx ${hash}) — the contract's own check rejected this action; see the tx in a block explorer or via 'cast receipt' for the revert reason.`);
      }
      window.location.reload(); // simplest correct way to reflect the new on-chain state; no client-side state duplication of the SSR'd dashboard
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const role = roleOf(wallet.address, state);
  const graduation = checkLiveGraduation(state, nowTs);
  const loosenDelayElapsed = state.loosenPending && nowTs >= state.loosenProposedAt + state.mandate.loosenDelay;

  const isRole = role === "owner" || role === "agent" || role === "guardian";
  const btn = "font-bold text-sm rounded-full px-5 py-2.5 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed";
  const smallBtn = "font-bold text-xs rounded-full px-4 bg-ink text-cream disabled:opacity-40";
  const field = "flex-grow min-w-0 border border-border rounded-full px-4 py-2 text-sm bg-cream focus:outline-none focus:border-green";

  return (
    <div className="rounded-3xl bg-surface border border-border p-6 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display font-bold text-2xl tracking-tight">Controls</h2>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-ink-faint truncate">{wallet.address}</span>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-ink text-cream uppercase shrink-0">{role}</span>
        </div>
      </div>

      {role === "none" && <div className="text-sm text-ink-faint">Not the owner, agent or guardian. No controls.</div>}

      <div className="flex flex-wrap gap-2">
        {isRole && !state.envelope.paused && (
          <button
            disabled={busy !== null}
            onClick={() =>
              runWrite("pause", (w, seq) =>
                w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "pause", args: [seq, ZERO_HASH, 0, "0x"], account: w.address, chain: w.client.chain }),
              )
            }
            className={`${btn} bg-refuse text-white`}
          >
            {busy === "pause" ? "Pausing…" : "Pause"}
          </button>
        )}

        {role === "owner" && state.envelope.paused && (
          <button
            disabled={busy !== null}
            onClick={() => runWrite("unpause", (w) => w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "unpause", args: [], account: w.address, chain: w.client.chain }))}
            className={`${btn} bg-allow text-white`}
          >
            {busy === "unpause" ? "Unpausing…" : "Unpause"}
          </button>
        )}

        {(role === "owner" || role === "guardian") && state.loosenPending && (
          <button
            disabled={busy !== null}
            onClick={() => runWrite("veto", (w) => w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "cancelLoosen", args: [], account: w.address, chain: w.client.chain }))}
            className={`${btn} bg-approval text-white`}
            title="Vetoing counts as an incident (LOOSEN_VETOED) and drops the agent one tier."
          >
            {busy === "veto" ? "Vetoing…" : "Veto pending loosen"}
          </button>
        )}

        {isRole && (
          <button
            disabled={busy !== null || !graduation.eligible}
            onClick={() => runWrite("graduate", (w) => w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "graduate", args: [], account: w.address, chain: w.client.chain }))}
            className={`${btn} bg-green text-white`}
            title={graduation.eligible ? "Eligible, recomputed live from on-chain tierState" : `Not eligible: ${graduation.failedConditions.join(", ")}`}
          >
            {busy === "graduate" ? "Graduating…" : graduation.eligible ? `Graduate to T${state.tierState.tier + 1}` : `Not yet eligible for T${state.tierState.tier + 1}`}
          </button>
        )}

        {state.loosenPending && loosenDelayElapsed && (
          <button
            disabled={busy !== null}
            onClick={() => runWrite("applyLoosen", (w) => w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "applyLoosen", args: [], account: w.address, chain: w.client.chain }))}
            className={`${btn} bg-ink text-cream`}
          >
            {busy === "applyLoosen" ? "Applying…" : `Apply loosen to ${fromWei(state.pendingLoosenCap)}`}
          </button>
        )}
      </div>

      {!graduation.eligible && (
        <div className="text-xs text-ink-faintest">Blocked on: {graduation.failedConditions.join(", ")}</div>
      )}

      {isRole && (
        <div className="grid sm:grid-cols-2 gap-4 border-t border-border pt-5">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-ink-muted">Tighten cap · now {fromWei(state.envelope.capacityCap)}</label>
            <div className="flex gap-2">
              <input value={tightenInput} onChange={(e) => setTightenInput(e.target.value)} placeholder="lower cap" className={field} />
              <button
                disabled={busy !== null || tightenInput === ""}
                onClick={() => {
                  try {
                    const newCap = toWei(tightenInput);
                    runWrite("tighten", (w, seq) => w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "tightenCap", args: [newCap, seq, ZERO_HASH, 0, "0x"], account: w.address, chain: w.client.chain }));
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : String(err));
                  }
                }}
                className={smallBtn}
              >
                Tighten
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-ink-muted">Raise reserve · now {fromWei(state.envelope.reserveUsdc)}</label>
            <div className="flex gap-2">
              <input value={reserveInput} onChange={(e) => setReserveInput(e.target.value)} placeholder="higher reserve" className={field} />
              <button
                disabled={busy !== null || reserveInput === ""}
                onClick={() => {
                  try {
                    const newReserve = toWei(reserveInput);
                    runWrite("raiseReserve", (w, seq) => w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "raiseReserve", args: [newReserve, seq, ZERO_HASH, 0, "0x"], account: w.address, chain: w.client.chain }));
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : String(err));
                  }
                }}
                className={smallBtn}
              >
                Raise
              </button>
            </div>
          </div>
        </div>
      )}

      {role === "agent" && !state.loosenPending && (
        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <label className="text-xs font-semibold text-ink-muted">
            Propose looser cap · max {fromWei(state.envelope.capCeiling)} · {state.mandate.loosenDelay}s veto window
          </label>
          <div className="flex gap-2 max-w-md">
            <input value={loosenInput} onChange={(e) => setLoosenInput(e.target.value)} placeholder="new cap" className={field} />
            <button
              disabled={busy !== null || loosenInput === ""}
              onClick={() => {
                try {
                  const newCap = toWei(loosenInput);
                  runWrite("proposeLoosen", (w, seq) => w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "proposeLoosenCap", args: [newCap, seq, ZERO_HASH, 0, "0x"], account: w.address, chain: w.client.chain }));
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : String(err));
                }
              }}
              className={smallBtn}
            >
              Propose
            </button>
          </div>
        </div>
      )}

      {(role === "agent" || role === "guardian") && (
        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <label className="text-xs font-semibold text-ink-muted">
            Emergency exit · redeem shares (works even when paused) · holds {fromWei(state.shareBalance)}
          </label>
          <div className="flex gap-2 max-w-md">
            <input value={redeemInput} onChange={(e) => setRedeemInput(e.target.value)} placeholder={`shares (${fromWei(state.shareBalance)} = all)`} className={field} />
            <button
              disabled={busy !== null || redeemInput === ""}
              onClick={() => {
                try {
                  const shares = toWei(redeemInput);
                  runWrite("requestRedeem", (w, seq) => w.client.writeContract({ address, abi: stewardAccountAbi, functionName: "requestRedeem", args: [shares, seq, ZERO_HASH, 0, "0x"], account: w.address, chain: w.client.chain }));
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : String(err));
                }
              }}
              className="font-bold text-xs rounded-full px-4 bg-refuse text-white disabled:opacity-40"
            >
              Request redeem
            </button>
          </div>
        </div>
      )}

      {actionError && <div className="text-sm text-refuse break-words">{actionError}</div>}
      {lastTxHash && <div className="text-xs text-ink-faintest font-mono break-all">tx {lastTxHash} · confirming…</div>}
    </div>
  );
}
