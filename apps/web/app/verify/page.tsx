import { readAccountState, fetchAccountHistory } from "@/lib/chain";
import { replayHistory, type ReplayResult } from "@/lib/replay";
import type { OnChainAccountState } from "@/lib/chain";
import { Card, ForkNotHosted, Note, Page, buttonClass, inputClass } from "@/components/ui";
import { isHostedDeployment, resolveForkRpc } from "@/lib/deployment";

export const metadata = {
  title: "Steward — verifier",
  description:
    "Independently replays Steward's on-chain Decision events and recomputes verdicts with the same deterministic policy engine the contracts use.",
};

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (verdict === null) return null;
  const styles: Record<string, string> = {
    ALLOW: "bg-allow-bg text-allow",
    ALLOW_CLAMPED: "bg-allow-bg text-allow",
    NEEDS_APPROVAL: "bg-approval-bg text-approval",
    REFUSE: "bg-refuse-bg text-refuse",
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide shrink-0 ${styles[verdict] ?? "bg-track text-ink-faint"}`}>
      {verdict.replace("_", " ")}
    </span>
  );
}

function ReceiptsTable({ result }: { result: ReplayResult }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display font-bold text-xl tracking-tight">Receipts</h2>
        <span className="text-sm text-ink-faintest">{result.rows.length} events</span>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {result.rows.map((row, i) => (
          <div key={i} className="py-3 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-[15px]">
                {row.kind === "Decision" ? `${row.action}${row.amount ? ` · ${row.amount}` : ""}` : row.kind}
              </span>
              <VerdictBadge verdict={row.verdict} />
            </div>
            <div className="text-[13px] text-ink-faint">
              {row.seq !== null ? `seq ${row.seq} · ` : ""}
              block {row.blockNumber}
              {row.note ? ` · ${row.note}` : ""}
              {row.reasons.length > 0 ? ` · ${row.reasons.join(", ")}` : ""}
              {row.kind === "Decision" && !row.policyInputProvided ? " · no policyInput" : ""}
            </div>
            <div className="text-xs text-ink-faintest font-mono truncate">tx {row.txHash}</div>
          </div>
        ))}
        {result.rows.length === 0 && <div className="text-sm text-ink-faint py-6 text-center">No events in this range.</div>}
      </div>
      <Note>Amounts in raw units.</Note>
    </Card>
  );
}

function Check({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-cream/70">{label}</span>
      <span className={`font-bold ${ok ? "text-[#8fd1bb]" : "text-[#f0a594]"}`}>{value}</span>
    </div>
  );
}

function ChecksPanel({ result, startTier }: { result: ReplayResult; startTier: number }) {
  return (
    <div className="flex flex-col gap-4">
      <Card dark className="flex flex-col gap-4">
        <h2 className="font-display font-bold text-xl tracking-tight">Checks</h2>

        <div className="flex flex-col gap-1">
          <Check label="Sequence continuity" ok={result.seqContinuityOk} value={result.seqContinuityOk ? "OK" : "GAP DETECTED"} />
          {result.seqGaps.map((g, i) => (
            <div key={i} className="text-xs text-[#f0a594]">{g}</div>
          ))}
        </div>
        <Check
          label={`Replayed tier (from T${startTier})`}
          ok={result.finalTierMatchesOnChain}
          value={`T${result.replayedFinalTier}`}
        />
        <Check label="On-chain tier" ok={result.finalTierMatchesOnChain} value={`T${result.onChainTier}`} />
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-cream/70">Match</span>
          <span className={`font-bold ${result.finalTierMatchesOnChain ? "text-[#8fd1bb]" : "text-[#f0a594]"}`}>
            {result.finalTierMatchesOnChain ? "AGREES" : "DIVERGES"}
          </span>
        </div>

        {result.graduationChecks.map((g, i) => (
          <div key={i} className="border-t border-white/10 pt-3 flex flex-col gap-1">
            <div className="text-sm font-semibold">Graduation T{g.claimedFromTier} → T{g.claimedToTier}</div>
            <div className={`text-sm font-bold ${g.agrees ? "text-[#8fd1bb]" : "text-[#f0a594]"}`}>
              {g.agrees ? "Independently confirmed eligible" : "DOES NOT independently confirm eligible"}
            </div>
            {g.failedConditions.length > 0 && (
              <div className="text-xs text-cream/60">failed: {g.failedConditions.join(", ")}</div>
            )}
          </div>
        ))}
      </Card>

      <Note>
        Start tier is assumed, not derived. Refused proposals revert and leave no event, so only
        successful actions can be replayed.
      </Note>
    </div>
  );
}

function AccountSummary({ address, state }: { address: string; state: OnChainAccountState }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-faintest uppercase tracking-wide font-bold mb-1">Account</div>
          <div className="font-mono text-sm break-all">{address}</div>
        </div>
        <span className="px-3 py-1 rounded-full text-sm font-bold bg-ink text-cream shrink-0">T{state.tierState.tier}</span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          ["exposure", state.exposure.toString()],
          ["hardCap", state.hardCap.toString()],
          ["nextSeq", state.nextSeq.toString()],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-ink-faintest text-xs mb-0.5">{k}</div>
            <div className="font-display font-bold text-lg tabular-nums truncate">{v}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default async function VerifyPage(props: PageProps<"/verify">) {
  const params = await props.searchParams;
  const address = typeof params.address === "string" ? params.address.trim() : "";
  const rpc = resolveForkRpc(typeof params.rpc === "string" ? params.rpc : undefined);
  const fromBlockInput = typeof params.fromBlock === "string" ? params.fromBlock.trim() : "";
  const startTierInput = typeof params.startTier === "string" ? params.startTier.trim() : "0";

  if (rpc === null) {
    return (
      <Page
        current="/verify"
        eyebrow="Don't trust, replay"
        title="Verifier"
        lead="Replays an account's on-chain history with the same engine and checks every tier change."
      >
        <ForkNotHosted />
      </Page>
    );
  }

  let errorMessage: string | null = null;
  let accountState: OnChainAccountState | null = null;
  let replay: ReplayResult | null = null;
  const startTier = Number.isFinite(Number(startTierInput)) ? Number(startTierInput) : 0;

  if (address !== "") {
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error("Not a valid 20-byte address (expected 0x + 40 hex characters).");
      }
      const typedAddress = address as `0x${string}`;
      accountState = await readAccountState(rpc, typedAddress);
      const fromBlock = fromBlockInput !== "" ? BigInt(fromBlockInput) : 0n;
      const events = await fetchAccountHistory(rpc, typedAddress, fromBlock);
      replay = await replayHistory(rpc, events, startTier, accountState.tierState.tier);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <Page
      current="/verify"
      eyebrow="Don't trust, replay"
      title="Verifier"
      lead="Replays an account's on-chain history with the same engine and checks every tier change."
    >
      <Card>
        <form method="GET" className="flex flex-col gap-4">
          <div className="grid sm:grid-cols-[2fr_1.2fr] gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-ink-muted">Account address</span>
              <input type="text" name="address" defaultValue={address} placeholder="0x…" className={inputClass} />
            </label>
            {!isHostedDeployment() && (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-semibold text-ink-muted">RPC URL</span>
                <input type="text" name="rpc" defaultValue={rpc} className={inputClass} />
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm w-36">
              <span className="font-semibold text-ink-muted">From block</span>
              <input type="text" name="fromBlock" defaultValue={fromBlockInput} placeholder="0" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm w-28">
              <span className="font-semibold text-ink-muted">Start tier</span>
              <input type="text" name="startTier" defaultValue={startTierInput} className={inputClass} />
            </label>
            <button type="submit" className={`${buttonClass} ml-auto`}>
              Verify
            </button>
          </div>
        </form>
      </Card>

      {errorMessage !== null && (
        <div className="bg-refuse-bg border border-refuse/30 text-refuse rounded-2xl p-4 text-sm break-words">{errorMessage}</div>
      )}

      {accountState !== null && replay !== null && (
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5 items-start">
          <div className="flex flex-col gap-5 min-w-0">
            <AccountSummary address={address} state={accountState} />
            <ReceiptsTable result={replay} />
          </div>
          <ChecksPanel result={replay} startTier={startTier} />
        </div>
      )}
    </Page>
  );
}
