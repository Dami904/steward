import Link from "next/link";
import { formatDuration, getVaultLiquidity } from "@/lib/vault-liquidity";

// The liquidity section is read live from the real vault (lib/vault-liquidity.ts), re-read at
// most every 5 minutes. Every other number is copied from something re-run on 2026-09-24 —
// README.md's "Judge fast path", LIVE.md's contrast, contracts/src/libraries/Types.sol's tier
// limits. If one of those changes, change it here too.
export const revalidate = 300;

const STATS = [
  { value: "89/89", label: "contract tests" },
  { value: "118/118", label: "engine cases, TS = Python" },
  { value: "21/21", label: "adversarial evals held" },
  { value: "0", label: "limit breaks under fuzzing" },
];

const TIERS = [
  { tier: "T0", maxTx: 120, maxVault: 150, note: "every agent starts here" },
  { tier: "T1", maxTx: 300, maxVault: 400, note: "" },
  { tier: "T2", maxTx: 600, maxVault: 800, note: "" },
  { tier: "T3", maxTx: 1000, maxVault: 1200, note: "earned, never granted" },
];
const MAX_VAULT = 1200;

const TICKS = [
  { label: "1 min", seconds: 60, mobile: true },
  { label: "1 hour", seconds: 3_600, mobile: true },
  { label: "1 day", seconds: 86_400, mobile: true },
  { label: "1 week", seconds: 604_800, mobile: false },
  { label: "100 days", seconds: 8_640_000, mobile: true },
  { label: "1 year", seconds: 31_536_000, mobile: true },
];

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function Button({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "light" | "ghost" | "outline";
}) {
  const styles = {
    primary: "bg-green text-white hover:bg-[#346a5a] shadow-[0_8px_24px_-8px_rgba(62,124,106,0.7)]",
    light: "bg-cream text-ink hover:bg-white",
    ghost: "text-white border border-white/25 hover:border-white/60 hover:bg-white/5",
    outline: "text-ink border-2 border-ink hover:bg-ink hover:text-cream",
  }[variant];
  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-center gap-2 font-bold text-[15px] rounded-full px-6 py-3.5 transition-all ${styles}`}
    >
      {children}
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div className={`text-xs font-bold uppercase tracking-[0.18em] ${dark ? "text-[#8fd1bb]" : "text-green"}`}>
      {children}
    </div>
  );
}

function Needs({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`text-xs ${dark ? "text-white/45" : "text-ink-faintest"}`}>{children}</p>;
}

export default async function Home() {
  const liquidity = await getVaultLiquidity();
  const reqs = liquidity.requests;
  const open = reqs.filter((r) => r.status === "Pending");
  const settled = reqs.filter((r) => r.status === "Finalized");
  const rejected = reqs.filter((r) => r.status === "Rejected");
  const settledSecs = settled.map((r) => r.seconds);
  const openAges = [...open].sort((a, b) => a.seconds - b.seconds).map((r) => formatDuration(r.seconds));
  const dustOpen = open.filter((r) => r.shares < 1);

  // Log scale; the right edge grows with the oldest request so a still-open one never clips.
  const maxSeconds = Math.max(1, ...reqs.map((r) => r.seconds));
  const logMax = Math.max(7, Math.log10(maxSeconds) * 1.03);
  const pctNum = (seconds: number) => Math.min(100, (Math.log10(Math.max(seconds, 1)) / logMax) * 100);
  const pct = (seconds: number) => `${pctNum(seconds)}%`;
  const ticks = TICKS.filter((t) => pctNum(t.seconds) < 100);
  const asOfText = `${liquidity.asOf.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const blockText = liquidity.block.toLocaleString("en-US");

  return (
    <div className="flex-grow flex flex-col">
      {/* ---------- HERO ---------- */}
      <section className="relative overflow-hidden bg-[#12110e] text-white">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <div aria-hidden className="absolute -top-40 -right-40 w-[560px] h-[560px] rounded-full bg-green/30 blur-[120px]" />
        <div aria-hidden className="absolute -bottom-48 -left-32 w-[480px] h-[480px] rounded-full bg-blue/30 blur-[120px]" />

        <nav className="relative z-10 w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 font-display font-bold text-xl tracking-tight">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-green to-blue text-sm">S</span>
            Steward
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-white/60">
            <a href="#how" className="hover:text-white transition-colors">How it works</a>
            <a href="#earned" className="hover:text-white transition-colors">Earned limits</a>
            <a href="#measured" className="hover:text-white transition-colors">Liquidity</a>
            <a href="#break" className="hover:text-white transition-colors">Break it</a>
          </div>
          <Link
            href="/demo"
            className="bg-white text-ink hover:bg-cream font-bold text-sm rounded-full px-5 py-2.5 transition-colors"
          >
            Start the walkthrough
          </Link>
        </nav>

        <div className="relative z-10 w-full max-w-6xl mx-auto px-6 pt-14 pb-24 md:pt-20 md:pb-32 grid lg:grid-cols-[1.15fr_1fr] gap-14 items-center">
          <div className="flex flex-col gap-7">
            <div className="inline-flex self-start items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/75">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8fd1bb]" />
              OpenServ SERV Hackathon · RWA Vaults · IXS Finance
            </div>
            <h1 className="font-display font-bold tracking-tight leading-[0.98] text-5xl sm:text-6xl lg:text-7xl">
              An AI agent that has to{" "}
              <span className="bg-gradient-to-r from-[#8fd1bb] via-[#6fb3d9] to-[#8fd1bb] bg-clip-text text-transparent">
                earn its limits.
              </span>
            </h1>
            <p className="max-w-xl text-lg sm:text-xl text-white/70 leading-relaxed">
              It proposes. Fixed rules decide. Only its own on-chain record can raise its
              limits.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Button href="/demo">Start the 5-minute walkthrough</Button>
              <Button href="/simulate" variant="ghost">Try the simulator</Button>
            </div>
            <p className="text-sm text-white/40">
              Unaudited · local BNB fork · no real funds
            </p>
          </div>

          {/* Hero visual: the real two-agent contrast from LIVE.md */}
          <div className="relative">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-2 shadow-2xl shadow-black/50">
              <div className="flex items-center gap-1.5 px-3 py-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                <span className="ml-3 text-xs text-white/40 font-mono">same request, two agents</span>
              </div>
              <div className="rounded-xl bg-[#0b0a08] p-5 font-mono text-[13px] flex flex-col gap-4">
                <div className="text-white/45">
                  <span className="text-[#8fd1bb]">$</span> deposit(<span className="text-white">200</span>)
                </div>
                <div className="rounded-lg border border-[#2f8f5b]/40 bg-[#2f8f5b]/10 p-4 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white font-semibold">Agent A</span>
                    <span className="rounded-md bg-[#2f8f5b] text-white text-[11px] font-bold px-2 py-0.5 tracking-wide">ALLOWED</span>
                  </div>
                  <div className="text-white/55">tier T1 · earned · cap 300</div>
                </div>
                <div className="rounded-lg border border-[#c4543f]/45 bg-[#c4543f]/10 p-4 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white font-semibold">Agent B</span>
                    <span className="rounded-md bg-[#c4543f] text-white text-[11px] font-bold px-2 py-0.5 tracking-wide">REVERTED</span>
                  </div>
                  <div className="text-white/55">tier T0 · brand new · cap 120</div>
                  <div className="text-[#f0a594]">OverMaxTx, rejected before it was mined</div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-4 -left-4 hidden sm:block rounded-xl bg-green text-white text-xs font-bold px-4 py-2.5 shadow-xl">
              Real transactions, re-verifiable
            </div>
          </div>
        </div>
      </section>

      {/* ---------- PROOF STRIP ---------- */}
      <section className="w-full bg-cream border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-2 lg:grid-cols-4 gap-y-10 gap-x-8">
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col gap-2 border-l-4 border-green pl-5">
              <div className="font-display font-bold text-4xl tracking-tight">{s.value}</div>
              <div className="text-sm text-ink-faint leading-snug">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="w-full max-w-6xl mx-auto px-6 py-24 md:py-32 flex flex-col gap-14 scroll-mt-4">
        <div className="flex flex-col gap-4 max-w-3xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight leading-[1.05]">
            The model can&apos;t move money. Full stop.
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              n: "01",
              title: "The agent proposes",
              body: "Deposit, redeem or hold. No addresses, no calldata, no limits to touch.",
            },
            {
              n: "02",
              title: "The engine decides",
              body: "Mandate, tier, vault health. Same inputs, same verdict.",
            },
            {
              n: "03",
              title: "The contract enforces",
              body: "Re-checks on-chain and stamps a receipt. No receipt, no action.",
            },
          ].map((step, i) => (
            <div
              key={step.n}
              className={`relative rounded-3xl p-8 flex flex-col gap-4 ${
                i === 2 ? "bg-ink text-cream" : "bg-surface border border-border"
              }`}
            >
              <div className={`font-display font-bold text-6xl tracking-tight ${i === 2 ? "text-[#8fd1bb]" : "text-green/25"}`}>
                {step.n}
              </div>
              <h3 className="font-display font-bold text-2xl tracking-tight">{step.title}</h3>
              <p className={`text-[15px] leading-relaxed ${i === 2 ? "text-cream/70" : "text-ink-muted"}`}>{step.body}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <Button href="/simulate" variant="outline">See the engine react live</Button>
          </div>
          <Needs>In your browser. No wallet.</Needs>
        </div>
      </section>

      {/* ---------- EARNED AUTHORITY ---------- */}
      <section id="earned" className="w-full bg-surface border-y border-border scroll-mt-4">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32 grid lg:grid-cols-2 gap-16 items-center">
          <div className="flex flex-col gap-6">
            <Eyebrow>Earned authority</Eyebrow>
            <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight leading-[1.05]">
              Trust is a ladder. Every rung is on-chain.
            </h2>
            <p className="text-lg text-ink-muted leading-relaxed">
              Time served, risk carried, receipts logged, no incidents. Anyone can call the
              promotion; it only passes if the record holds. One incident drops a tier.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex flex-wrap gap-3">
                <Button href="/verify">Verify a graduation yourself</Button>
                <Button href="/demo" variant="outline">Walk through it</Button>
              </div>
              <Needs>Needs the local fork from LIVE.md.</Needs>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {[...TIERS].reverse().map((t, i) => (
              <div key={t.tier} className="flex items-center gap-4">
                <div className="w-12 font-display font-bold text-xl text-right">{t.tier}</div>
                <div className="flex-1 flex flex-col gap-1">
                  <div className="h-12 rounded-xl bg-track overflow-hidden">
                    <div
                      className={`h-full rounded-xl flex items-center justify-end px-4 font-bold text-sm text-white ${
                        i === 3 ? "bg-ink" : "bg-gradient-to-r from-green to-blue"
                      }`}
                      style={{ width: `${Math.max(18, (t.maxVault / MAX_VAULT) * 100)}%` }}
                    >
                      {t.maxVault}
                    </div>
                  </div>
                  <div className="text-xs text-ink-faint pl-1">
                    up to {t.maxTx} per deposit{t.note && ` · ${t.note}`}
                  </div>
                </div>
              </div>
            ))}
            <div className="text-xs text-ink-faintest pt-2 pl-16">
              Max held in the vault. Demo-speed schedule.
            </div>
          </div>
        </div>
      </section>

      {/* ---------- MEASURED LIQUIDITY ---------- */}
      <section id="measured" className="w-full max-w-6xl mx-auto px-6 py-24 md:py-32 flex flex-col gap-12 scroll-mt-4">
        <div className="grid lg:grid-cols-[1fr_1fr] gap-10 items-end">
          <div className="flex flex-col gap-4">
            <Eyebrow>Measured, not promised</Eyebrow>
            <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight leading-[1.05]">
              &ldquo;A defined window.&rdquo; We measured it.
            </h2>
          </div>
          <p className="text-lg text-ink-muted leading-relaxed">
            The docs give no number. The chain does.{" "}
            {settled.length > 0
              ? `${settled.length} settled, in ${formatDuration(Math.min(...settledSecs))} to ${formatDuration(Math.max(...settledSecs))}.`
              : "None have settled."}
            {rejected.length > 0 && ` ${rejected.length} rejected.`}{" "}
            {open.length > 0 ? (
              <strong className="text-refuse">
                {open.length === 1 ? "1 is" : `${open.length} are`} still open after {joinAnd(openAges)}.
              </strong>
            ) : (
              <strong className="text-allow">None are waiting.</strong>
            )}
          </p>
        </div>

        <div className="rounded-3xl bg-surface border border-border p-6 sm:p-10 flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="font-display font-bold text-lg">Time to get money out</div>
              {liquidity.source === "live" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-allow-bg text-allow text-[11px] font-bold px-2.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-allow animate-pulse" /> LIVE
                </span>
              ) : (
                <span className="rounded-full bg-approval-bg text-approval text-[11px] font-bold px-2.5 py-1">SNAPSHOT</span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold text-ink-faint">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue" /> settled</span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: "repeating-linear-gradient(45deg,#a6483a 0 3px,#d98b7d 3px 6px)" }} />
                still open
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {reqs.map((r) => {
              const labelInside = pctNum(r.seconds) > 60;
              const pending = r.status === "Pending";
              const label = formatDuration(r.seconds);
              const text = pending ? `${label} · still open` : r.status === "Rejected" ? `${label} · rejected` : label;
              return (
                <div key={r.id} className="grid grid-cols-[2.5rem_1fr] items-center gap-3">
                  <div className="text-sm font-bold text-ink-faint">#{r.id}</div>
                  <div className="relative h-9 rounded-lg bg-track/70">
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg flex items-center justify-end pr-3 text-xs font-bold text-white whitespace-nowrap overflow-hidden"
                      style={{
                        width: pct(r.seconds),
                        background: pending
                          ? "repeating-linear-gradient(45deg,#a6483a 0 8px,#c26a5a 8px 16px)"
                          : "linear-gradient(to right, #2f6690, #3e7c6a)",
                      }}
                    >
                      {labelInside && text}
                    </div>
                    {!labelInside && (
                      <div
                        className="absolute inset-y-0 flex items-center text-xs font-bold text-ink whitespace-nowrap"
                        style={{ left: `calc(${pct(r.seconds)} + 8px)` }}
                      >
                        {text}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-[2.5rem_1fr] gap-3 pt-1">
              <div />
              <div className="relative h-5">
                {ticks.map((t) => (
                  <div
                    key={t.label}
                    className={`absolute text-[11px] font-semibold text-ink-faintest whitespace-nowrap ${
                      pctNum(t.seconds) > 90 ? "-translate-x-full" : "-translate-x-1/2"
                    } ${t.mobile ? "" : "hidden sm:block"}`}
                    style={{ left: pct(t.seconds) }}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-ink-faintest leading-relaxed border-t border-border pt-5">
            {liquidity.source === "live"
              ? `Read live from BNB Chain, block ${blockText}, ${asOfText}. Refreshes every 5 minutes.`
              : `Live read unavailable. Saved snapshot from block ${blockText}, ${asOfText}.`}{" "}
            Log scale. Small sample ({reqs.length} requests).
            {dustOpen.length > 0 &&
              ` ${dustOpen.length === 1 ? "One open request is" : `${dustOpen.length} open requests are`} under 1 share.`}
            {open.length > 0 &&
              " Why they're open isn't on-chain. The health feed counts settled requests only, so it misses them."}
          </p>
        </div>
      </section>

      {/* ---------- HONEYPOT ---------- */}
      <section id="break" className="relative overflow-hidden w-full bg-[#12110e] text-white scroll-mt-4">
        <div aria-hidden className="absolute top-1/2 -translate-y-1/2 right-[-10%] w-[520px] h-[520px] rounded-full bg-[#a6483a]/25 blur-[130px]" />
        <div className="relative max-w-6xl mx-auto px-6 py-24 md:py-32 grid lg:grid-cols-[1.3fr_1fr] gap-12 items-center">
          <div className="flex flex-col gap-6">
            <Eyebrow dark>Honeypot</Eyebrow>
            <h2 className="font-display font-bold text-4xl sm:text-6xl tracking-tight leading-[1.02]">
              Try to talk it into something.
            </h2>
            <p className="text-lg text-white/70 leading-relaxed max-w-xl">
              Write a notice built to fool the agent. Scores come from what it actually did on-chain.
            </p>
            <div className="flex flex-col gap-2">
              <div>
                <Button href="/honeypot" variant="light">Open the honeypot</Button>
              </div>
              <Needs dark>Not run publicly yet. No prize pot; no live model reads notices.</Needs>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 flex flex-col gap-3">
            <div className="font-display font-bold text-7xl tracking-tight">0</div>
            <div className="text-white/70 leading-relaxed">
              limit breaks across 256 fuzz runs per invariant.
            </div>
            <div className="text-xs text-white/40">The fuzzer, not public attackers.</div>
          </div>
        </div>
      </section>

      {/* ---------- OPERATORS ---------- */}
      <section className="w-full max-w-6xl mx-auto px-6 py-24 grid md:grid-cols-2 gap-5">
        {[
          {
            title: "Run an account",
            body: "Capacity, decisions, and every owner, agent and guardian control.",
            href: "/app",
            cta: "Open the live account",
            needs: "Wallet on the local fork.",
          },
          {
            title: "Check it without trusting us",
            body: "Replays the on-chain record and flags any tier change the rules didn't allow.",
            href: "/verify",
            cta: "Open the Verifier",
            needs: "Account address + local fork.",
          },
        ].map((c) => (
          <div key={c.title} className="rounded-3xl bg-surface border border-border p-9 flex flex-col gap-4">
            <h3 className="font-display font-bold text-2xl tracking-tight">{c.title}</h3>
            <p className="text-[15px] text-ink-muted leading-relaxed flex-1">{c.body}</p>
            <div className="pt-2">
              <Button href={c.href} variant="outline">{c.cta}</Button>
            </div>
            <Needs>{c.needs}</Needs>
          </div>
        ))}
      </section>

      {/* ---------- FINAL CTA ---------- */}
      <section className="w-full max-w-6xl mx-auto px-6 pb-24">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-green via-[#35705f] to-blue text-white px-8 sm:px-14 py-16 flex flex-col md:flex-row md:items-center md:justify-between gap-8">
          <div aria-hidden className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex flex-col gap-3">
            <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight leading-[1.05]">
              See it end to end.
            </h2>
            <p className="text-lg text-white/80">Five minutes. Mostly no wallet.</p>
          </div>
          <div className="relative shrink-0">
            <Button href="/demo" variant="light">Start the walkthrough</Button>
          </div>
        </div>
      </section>

      <footer className="w-full border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row gap-3 justify-between text-sm text-ink-faint">
          <span className="font-display font-bold text-ink">Steward</span>
          <span>MIT · Unaudited · Fork-only · Built with Claude Code</span>
        </div>
      </footer>
    </div>
  );
}
