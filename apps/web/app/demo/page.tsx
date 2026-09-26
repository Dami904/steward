import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Button, Card, Note, Page } from "@/components/ui";

// Phase 5's own exit criterion (serv PLAN_v3.md §12): "a non-technical person completes the
// demo script with and without a wallet." The plan's own §13.1 demo script is written as a
// video-recording cue sheet (timestamps, "reverts on BscScan") for whoever records the
// submission video — not something a judge could pick up and click through themselves, and it
// references a public explorer this fork-only build never touches. This page is the actual
// gate: a plain-language walkthrough with real, working links, built from whatever is
// currently deployed on the persistent fork rather than hardcoded addresses — LIVE.md's own
// "Phase 5 wrap-up" entry (spec/DECISIONS.md) found that hardcoded fork addresses/tx hashes
// go stale the moment the pinned block ages out of the upstream RPC's archive window; reading
// the current deploy's own output here avoids repeating that mistake.

export const metadata = {
  title: "Steward — demo walkthrough",
  description: "A five-minute, click-through walkthrough of the real earned-authority demo.",
};

// Without this, Next has no signal that this page depends on runtime state (no
// searchParams, no cookies()/headers() — the fs reads below are invisible to its static/
// dynamic analysis) and will prerender it once at BUILD time, baking in whatever
// .demo-state/receipts.json looked like then and serving that stale snapshot to every
// visitor forever after — the exact class of staleness bug this whole page exists to avoid
// repeating (see this file's own header comment on LIVE.md's stale-address finding).
// Confirmed by reading `next build`'s own route summary: without this, /demo listed as
// "○ (Static)"; with it, "ƒ (Dynamic)".
export const dynamic = "force-dynamic";

const RPC = "http://127.0.0.1:8546"; // scripts/fork-node.sh's fixed port — same default every other page in this app uses for the persistent fork
const REPO_ROOT = join(process.cwd(), "..", ".."); // apps/web -> apps -> repo root

interface Receipt {
  step: string;
  description: string;
  txHash: string | null;
  status: "success" | "reverted" | "call";
  blockNumber: number | null;
  detail?: string;
}
interface Receipts {
  addresses: { accountA: string; accountB?: string };
  receipts: Receipt[];
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8").trim();
  } catch {
    return null;
  }
}

function Step({
  n,
  title,
  children,
  proof,
  tag,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  proof?: React.ReactNode;
  tag?: string;
}) {
  return (
    <Card className="flex flex-col sm:flex-row gap-5 sm:gap-8">
      <div className="font-display font-bold text-5xl tracking-tight text-green/30 leading-none shrink-0 w-14">
        {String(n).padStart(2, "0")}
      </div>
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display font-bold text-2xl tracking-tight">{title}</h2>
          {tag && <span className="rounded-full bg-track text-ink-faint text-[11px] font-bold px-2.5 py-1">{tag}</span>}
        </div>
        <div className="text-[15px] text-ink-muted flex flex-col gap-3 items-start">{children}</div>
        {proof && <div className="text-xs text-ink-faintest font-mono break-all">{proof}</div>}
      </div>
    </Card>
  );
}

export default function DemoPage() {
  const receipts = readJson<Receipts>(join(REPO_ROOT, ".demo-state", "receipts.json"));
  const pinnedBlock = readText(join(REPO_ROOT, ".fork-state", "pinned-block.txt"));
  const accountA = receipts?.addresses.accountA;
  const accountB = receipts?.addresses.accountB;

  const graduateStep = receipts?.receipts.find((r) => r.step === "A_graduate");
  const contrastA = receipts?.receipts.find((r) => r.step === "A_contrast_deposit");
  const contrastB = receipts?.receipts.find((r) => r.step === "B_contrast_deposit");

  const rpcParam = encodeURIComponent(RPC);
  // Start one block AFTER the pin. Anvil answers eth_getLogs for blocks <= the fork block by
  // forwarding to the upstream RPC, and the public BSC endpoint refuses that as an archive
  // request (HTTP 403, "Archive requests require a personal token") once the pin is a few
  // minutes old. The demo account is deployed after the fork starts, so every one of its events
  // lives in a local block > pin: starting there keeps the whole query on the fork and loses
  // nothing.
  const fromBlock = pinnedBlock && /^\d+$/.test(pinnedBlock) ? (BigInt(pinnedBlock) + 1n).toString() : "0";
  const verifyLinkA = accountA ? `/verify?address=${accountA}&rpc=${rpcParam}&fromBlock=${fromBlock}` : null;
  const appLinkA = accountA ? `/app?address=${accountA}&rpc=${rpcParam}&fromBlock=${fromBlock}` : null;
  const honeypotLink = accountA ? `/honeypot?address=${accountA}&rpc=${rpcParam}&fromBlock=${fromBlock}` : "/honeypot";

  return (
    <Page
      current="/demo"
      eyebrow="Five minutes"
      title="Demo walkthrough"
      lead="Two agents, one request. Watch authority get earned, then check it yourself."
      width="max-w-4xl"
    >
      {!receipts && (
        <Card className="flex flex-col gap-3 !bg-approval-bg !border-[#EAD9B0]">
          <div className="font-display font-bold text-xl">No demo data found yet</div>
          <p className="text-sm text-ink-muted">Run the local fork once (1–2 min, details in <code>LIVE.md</code>), then reload.</p>
          <pre className="bg-cream border border-border rounded-xl p-4 text-xs overflow-x-auto">{`bash scripts/fork-node.sh --fresh
cd contracts && forge script script/DeployDemo.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
cd .. && node --experimental-strip-types scripts/demo-driver.ts`}</pre>
        </Card>
      )}

      {receipts && (
        <div className="flex flex-col gap-4">
          <Step
            n={1}
            title="See a stranger get turned away"
            proof={contrastB && `block ${contrastB.blockNumber} · ${contrastB.status}${contrastB.detail?.includes("OverMaxTx") ? " · OverMaxTx" : ""}`}
          >
            <p>
              Agent B is brand new (tier T0, cap 120). It tries to deposit 200. The contract
              refuses: <code>OverMaxTx</code>.
            </p>
          </Step>

          <Step n={2} title="Same request, earned agent" proof={contrastA?.txHash && `tx ${contrastA.txHash}`}>
            <p>
              Agent A built a record and called <code>graduate()</code>, which only passes if
              every promotion condition holds. Now at T1, the same 200 goes through.
            </p>
          </Step>

          <Step n={3} title="Don't trust us. Verify.">
            <p>Replays Agent A&apos;s on-chain history with the real engine.</p>
            {verifyLinkA && <Button href={verifyLinkA} aria-label="Open the Verifier for Agent A">Open the Verifier</Button>}
            <Note>Expect: Sequence continuity OK · AGREES · Independently confirmed eligible.</Note>
          </Step>

          <Step n={4} title="Play with the engine" tag="no wallet">
            <p>Move the sliders, watch the verdict change.</p>
            <Button href="/simulate" variant="outline">Open Simulate</Button>
          </Step>

          <Step n={5} title="Act on the real account" tag="wallet">
            <p>
              Pause, tighten, or change the mandate as owner, agent or guardian. Wallet on
              RPC <code>{RPC}</code>, chain 56.
            </p>
            {appLinkA && <Button href={appLinkA} variant="outline">Open the live account</Button>}
          </Step>

          <Step n={6} title="Try to break it">
            <p>Submit a notice built to fool the agent. Scores come from on-chain history.</p>
            <Button href={honeypotLink} variant="outline">Open the honeypot</Button>
          </Step>

          {graduateStep?.txHash && (
            <Note>
              Built from a real run: Agent A {accountA} · Agent B {accountB} · forked at block {pinnedBlock}.
            </Note>
          )}
        </div>
      )}

      <Note>
        Real contracts, real transactions, on a local fork. No real money, no public explorer,
        and no live model reads the honeypot yet (docs/LIMITATIONS.md).
      </Note>
    </Page>
  );
}
