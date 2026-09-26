import { readAccountState, fetchAccountHistory, blockTimestamp, currentBlockNumber, type OnChainAccountState } from "@/lib/chain";
import { computeLiveCapacity } from "@/lib/live-capacity";
import { ACTION_NAMES, VERDICT_NAMES, decodeReasonMask } from "@/lib/steward-abi";
import WalletSection from "./WalletSection";
import AttackLab from "./AttackLab";
import { Card, ForkNotHosted, Note, Page, buttonClass, inputClass } from "@/components/ui";
import { isHostedDeployment, resolveForkRpc } from "@/lib/deployment";
import { DEMO_ACCOUNT_A, DEMO_FROM_BLOCK } from "@/lib/demo-run";

export const metadata = {
  title: "Steward — live account",
  description:
    "Connect a wallet and act on a real StewardAccount — dashboard, capacity gauge, decision feed, and owner/guardian controls, all reading live on-chain state.",
};

const UNIT = 10n ** 18n;

function fmt(v: bigint): string {
  return (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    ALLOW: "bg-allow-bg text-allow",
    ALLOW_CLAMPED: "bg-allow-bg text-allow",
    NEEDS_APPROVAL: "bg-approval-bg text-approval",
    REFUSE: "bg-refuse-bg text-refuse",
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide ${styles[verdict] ?? "bg-track text-ink-faint"}`}>
      {verdict.replace("_", " ")}
    </span>
  );
}

function AddressForm({ address, rpc, fromBlock }: { address: string; rpc: string; fromBlock: string }) {
  return (
    <Card>
      <form method="GET" className="flex flex-col gap-3">
        <div className="grid sm:grid-cols-[2fr_1.2fr] gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold text-ink-muted">Account address</span>
            <input name="address" defaultValue={address} placeholder="0x…" className={inputClass} />
          </label>
          {!isHostedDeployment() && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-ink-muted">RPC URL</span>
              <input name="rpc" defaultValue={rpc} className={inputClass} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm w-36">
            <span className="font-semibold text-ink-muted">Feed from block</span>
            <input name="fromBlock" defaultValue={fromBlock} placeholder="0" className={inputClass} />
          </label>
          <button type="submit" className={`${buttonClass} ml-auto`}>
            Load account
          </button>
        </div>
      </form>
    </Card>
  );
}

function Stat({ label, value, big = false }: { label: string; value: React.ReactNode; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-white/45 mb-0.5">{label}</div>
      <div className={`font-display font-bold tabular-nums truncate ${big ? "text-3xl" : "text-lg"}`}>{value}</div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      {k}: <span className="font-semibold text-ink tabular-nums">{v}</span>
    </div>
  );
}

function DashboardCard({ address, state }: { address: string; state: OnChainAccountState }) {
  const cap = computeLiveCapacity(state);
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-3xl bg-[#12110e] text-white p-6 sm:p-8 flex flex-col gap-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-white/45 uppercase tracking-wide font-bold mb-1">Account</div>
            <div className="font-mono text-sm break-all text-white/80">{address}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {state.envelope.paused && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#c4543f] text-white">PAUSED</span>
            )}
            <span className="px-3 py-1 rounded-full text-sm font-bold bg-white text-ink">T{state.tierState.tier}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <Stat big label="capacity" value={fmt(cap.result.capacity)} />
          <Stat big label="headroom" value={fmt(cap.result.headroom)} />
          <Stat label="binding" value={<span className="text-[#8fd1bb]">{cap.bindingTerm}</span>} />
          <Stat label="over cap" value={fmt(cap.result.overCap)} />
          <Stat label="liquid" value={fmt(state.liquidBalance)} />
          <Stat label="exposure" value={fmt(state.exposure)} />
          <Stat label="treasury" value={fmt(cap.treasury)} />
          <Stat label="lifetime cap" value={fmt(state.hardCap)} />
        </div>

        <div className="text-xs text-white/40 border-t border-white/10 pt-4">
          capMandate {fmt(cap.capMandate)} · capLiquid {fmt(cap.capLiquid)} · capTier {fmt(cap.capTier)} · onChainCap{" "}
          {fmt(cap.capacityCapOnChain)} · capHealth not wired
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <Card className="flex flex-col gap-2">
          <h2 className="font-display font-bold text-xl tracking-tight">Mandate</h2>
          <div className="flex flex-col gap-1 text-sm text-ink-muted">
            <Line k="maxTxUsdc" v={fmt(state.mandate.maxTxUsdc)} />
            <Line k="maxVaultUsdc" v={fmt(state.mandate.maxVaultUsdc)} />
            <Line k="maxBps" v={state.mandate.maxBps} />
            <Line k="minLiquidUsdc" v={fmt(state.mandate.minLiquidUsdc)} />
            <Line k="approvalAbove" v={fmt(state.mandate.approvalAbove)} />
            <Line k="expiry" v={state.mandate.expiry > 0 ? new Date(state.mandate.expiry * 1000).toISOString().slice(0, 16).replace("T", " ") : "unset"} />
          </div>
        </Card>
        <Card className="flex flex-col gap-2">
          <h2 className="font-display font-bold text-xl tracking-tight">Envelope</h2>
          <div className="flex flex-col gap-1 text-sm text-ink-muted">
            <Line k="capacityCap" v={fmt(state.envelope.capacityCap)} />
            <Line k="capCeiling" v={fmt(state.envelope.capCeiling)} />
            <Line k="reserveUsdc" v={fmt(state.envelope.reserveUsdc)} />
            <Line k="paused" v={String(state.envelope.paused)} />
            {state.loosenPending && (
              <div className="text-approval font-semibold pt-1">
                Loosen pending: {fmt(state.pendingLoosenCap)} (proposed {new Date(state.loosenProposedAt * 1000).toISOString().slice(0, 16).replace("T", " ")})
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

interface HistoryRow {
  kind: string;
  action: string | null;
  amount: string | null;
  verdict: string | null;
  reasons: string[];
  actor: string | null;
  blockNumber: string;
  txHash: string;
  note?: string;
}

function DecisionFeed({ rows }: { rows: HistoryRow[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display font-bold text-2xl tracking-tight">Decision feed</h2>
        <span className="text-sm text-ink-faintest">{rows.length} events · newest first</span>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {rows.map((row, i) => (
          <div key={i} className="py-3 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-[15px]">
                {row.kind === "Decision" ? `${row.action} · ${row.amount ?? ""}` : `${row.kind}${row.note ? ` · ${row.note}` : ""}`}
              </span>
              {row.verdict && <VerdictBadge verdict={row.verdict} />}
            </div>
            <div className="text-[13px] text-ink-faint">
              block {row.blockNumber}
              {row.actor ? ` · ${row.actor.slice(0, 10)}…` : ""}
              {row.reasons.length > 0 ? ` · ${row.reasons.join(", ")}` : ""}
            </div>
            <div className="text-xs text-ink-faintest font-mono truncate">tx {row.txHash}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-sm text-ink-faint py-6 text-center">No events in this range.</div>}
      </div>
    </Card>
  );
}

export default async function LiveAppPage(props: PageProps<"/app">) {
  const params = await props.searchParams;
  const requestedAddress = typeof params.address === "string" ? params.address.trim() : "";
  // Hosted and no address given: open on the demo run's Agent A rather than an empty form.
  const showingDemo = isHostedDeployment() && requestedAddress === "";
  const address = showingDemo ? DEMO_ACCOUNT_A : requestedAddress;
  const rpc = resolveForkRpc(typeof params.rpc === "string" ? params.rpc : undefined);
  const fromBlockParam = typeof params.fromBlock === "string" ? params.fromBlock.trim() : "";
  const fromBlockInput = showingDemo && fromBlockParam === "" ? DEMO_FROM_BLOCK : fromBlockParam;

  if (rpc === null) {
    return (
      <Page
        current="/app"
        eyebrow="Live on-chain"
        title="Live account"
        lead="Every number is a chain read or the engine's own math. Nothing invented in the browser."
      >
        <ForkNotHosted />
      </Page>
    );
  }

  let errorMessage: string | null = null;
  let accountState: OnChainAccountState | null = null;
  let historyRows: HistoryRow[] = [];
  // Only a placeholder: overwritten below by a real chain read before any component that
  // consumes it renders (those all live inside `{accountState && ...}`). Not Date.now() —
  // Next's eslint config flags calling an impure function during a Server Component's
  // render as a purity violation, and this repo would rather use the real chain time anyway
  // (see the real assignment below for why it matters).
  let nowTs = 0;

  if (address !== "") {
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error("Not a valid 20-byte address (expected 0x + 40 hex characters).");
      }
      const typedAddress = address as `0x${string}`;
      accountState = await readAccountState(rpc, typedAddress);
      // A real chain read, not Date.now() — matters for the graduation-eligibility and
      // loosen-delay checks below, which compare against on-chain timestamps and (on a local
      // fork/anvil) can diverge meaningfully from wall-clock time.
      nowTs = await blockTimestamp(rpc, await currentBlockNumber(rpc));
      const fromBlock = fromBlockInput !== "" ? BigInt(fromBlockInput) : 0n;
      const events = await fetchAccountHistory(rpc, typedAddress, fromBlock);
      historyRows = events
        .map((e): HistoryRow => {
          if (e.kind === "Decision") {
            const action = Number(e.args["action"] as number);
            const verdict = Number(e.args["verdict"] as number);
            const reasonMask = e.args["reasonMask"] as number;
            return {
              kind: "Decision",
              action: ACTION_NAMES[action] ?? `unknown(${action})`,
              amount: ((e.args["amount"] as bigint) / UNIT).toString(),
              verdict: VERDICT_NAMES[verdict] ?? `unknown(${verdict})`,
              reasons: decodeReasonMask(reasonMask),
              actor: e.args["actor"] as string,
              blockNumber: e.blockNumber.toString(),
              txHash: e.transactionHash,
            };
          }
          if (e.kind === "Graduated" || e.kind === "Demoted") {
            return {
              kind: e.kind,
              action: null,
              amount: null,
              verdict: null,
              reasons: [],
              actor: null,
              blockNumber: e.blockNumber.toString(),
              txHash: e.transactionHash,
              note: `T${e.args["fromTier"]} -> T${e.args["toTier"]}`,
            };
          }
          if (e.kind === "LoosenProposed") {
            return {
              kind: e.kind,
              action: null,
              amount: null,
              verdict: null,
              reasons: [],
              actor: null,
              blockNumber: e.blockNumber.toString(),
              txHash: e.transactionHash,
              note: `new cap ${((e.args["newCap"] as bigint) / UNIT).toString()}, applicable at block ts ${e.args["applicableAt"]}`,
            };
          }
          // LoosenCancelled / LoosenApplied — both carry a single uint128 cap field, just
          // under a different name (`vetoedCap` vs `newCap`).
          const capField = e.kind === "LoosenCancelled" ? "vetoedCap" : "newCap";
          return {
            kind: e.kind,
            action: null,
            amount: null,
            verdict: null,
            reasons: [],
            actor: null,
            blockNumber: e.blockNumber.toString(),
            txHash: e.transactionHash,
            note: `${e.kind === "LoosenCancelled" ? "vetoed cap" : "cap"} ${((e.args[capField] as bigint) / UNIT).toString()}`,
          };
        })
        .sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <Page
      current="/app"
      eyebrow="Live on-chain"
      title="Live account"
      lead="Every number is a chain read or the engine's own math. Nothing invented in the browser."
    >
      <AddressForm address={address} rpc={rpc} fromBlock={fromBlockInput} />

      {showingDemo && <Note>Showing Agent A from the demo run. Enter any account address to load another.</Note>}

      {errorMessage && (
        <div className="bg-refuse-bg border border-[#E8C7BF] text-refuse rounded-2xl p-4 text-sm break-words">
          <span className="font-semibold">Error:</span> {errorMessage}
        </div>
      )}

      {accountState && (
        <>
          <DashboardCard address={address} state={accountState} />
          {isHostedDeployment() ? (
            <Note>
              Wallet controls are off here: the hosted demo chain is read-only, so nobody can change the demo&apos;s
              state. Run it locally (LIVE.md) to pause, tighten or change the mandate yourself.
            </Note>
          ) : (
            <WalletSection address={address as `0x${string}`} rpc={rpc} state={accountState} nowTs={nowTs} />
          )}
          <AttackLab state={accountState} />
          <DecisionFeed rows={historyRows} />
        </>
      )}

      {!accountState && !errorMessage && <Note>Enter a StewardAccount address. The walkthrough links here with one filled in.</Note>}
    </Page>
  );
}
