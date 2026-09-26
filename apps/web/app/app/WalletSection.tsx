"use client";

// Owns ONE wallet connection shared by Controls and MandateBuilder — a first draft gave each
// of those components its own independent connect-wallet state, which meant two separate
// "Connect wallet" buttons on the same page (real UX bug, and it broke e2e locator
// uniqueness once both components render together). Connect once here; both children receive
// the same `wallet` as a prop. AttackLab doesn't need a wallet at all, so it stays outside
// this component entirely.

import { useState } from "react";
import { connectWallet, hasInjectedWallet, type ConnectedWallet } from "@/lib/wallet";
import type { OnChainAccountState } from "@/lib/chain";
import Controls from "./Controls";
import MandateBuilder from "./MandateBuilder";

export default function WalletSection({ address, rpc, state, nowTs }: { address: `0x${string}`; rpc: string; state: OnChainAccountState; nowTs: number }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function onConnect() {
    setConnectError(null);
    try {
      setWallet(await connectWallet());
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!hasInjectedWallet()) {
    return (
      <div className="rounded-3xl bg-surface border border-border p-6 text-sm text-ink-faint">
        No browser wallet found. Install one to use the controls; everything else works without it.
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="rounded-3xl bg-[#12110e] text-white p-6 sm:p-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="font-display font-bold text-2xl tracking-tight">Controls</div>
          <div className="text-sm text-white/60">Connect as owner, agent or guardian.</div>
        </div>
        <button onClick={onConnect} className="bg-green hover:bg-[#346a5a] text-white font-bold text-sm rounded-full px-6 py-3 transition-colors">
          Connect wallet
        </button>
        {connectError && <div className="w-full text-sm text-[#f0a594]">{connectError}</div>}
      </div>
    );
  }

  return (
    <>
      <Controls address={address} rpc={rpc} state={state} nowTs={nowTs} wallet={wallet} />
      <MandateBuilder address={address} rpc={rpc} state={state} nowTs={nowTs} wallet={wallet} />
    </>
  );
}
