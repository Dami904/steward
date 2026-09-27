import Link from "next/link";

// Shared look for every page, lifted from the landing page (app/page.tsx): dark bar, bold
// display type, pill buttons, rounded-3xl cards. Server-safe (no hooks), so client components
// can import it too.
//
// Nav labels deliberately differ from each page's <h1> ("Verifier", "Honeypot", ...): the e2e
// specs find those titles with exact getByText, which would match twice otherwise.

const NAV = [
  { href: "/demo", label: "Walkthrough" },
  { href: "/simulate", label: "Simulate" },
  { href: "/verify", label: "Verify" },
  { href: "/honeypot", label: "Break it" },
  { href: "/app", label: "Account" },
];

// The Steward mark: a shield (the account guarding the funds) holding a staircase (the tiers
// an agent climbs by earning them). White strokes on the brand gradient tile; size it with
// className (w-7 h-7 in the nav). app/icon.svg is the same drawing for the favicon.
export function LogoMark({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid place-items-center rounded-lg bg-gradient-to-br from-green to-blue shrink-0 ${className}`}>
      <svg viewBox="0 0 32 32" className="w-full h-full" fill="none" stroke="#fff" strokeWidth={2.1} strokeLinejoin="round">
        <path d="M16 5.2 25.2 8.6v6.9c0 5.8-3.9 9.9-9.2 11.5-5.3-1.6-9.2-5.7-9.2-11.5V8.6Z" />
        <path d="M10.6 21.2h3.6v-3.4h3.6v-3.4h3.6v-3.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function SiteNav({ current }: { current?: string }) {
  return (
    <nav className="w-full bg-[#12110e] text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <Link href="/" className="flex items-center gap-2.5 font-display font-bold text-lg tracking-tight shrink-0 px-2 sm:px-0">
          <LogoMark className="w-7 h-7" />
          Steward
        </Link>
        <div className="flex items-center justify-between sm:justify-end sm:gap-1 text-xs sm:text-sm font-semibold">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`whitespace-nowrap rounded-full px-2.5 sm:px-3 py-1.5 transition-colors ${
                current === n.href ? "bg-white text-ink" : "text-white/60 hover:text-white"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

export function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div className={`text-xs font-bold uppercase tracking-[0.18em] ${dark ? "text-[#8fd1bb]" : "text-green"}`}>
      {children}
    </div>
  );
}

/** Page shell: nav, a bold one-line header, then content. */
export function Page({
  current,
  eyebrow,
  title,
  lead,
  children,
  width = "max-w-5xl",
}: {
  current: string;
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="flex-grow flex flex-col">
      <SiteNav current={current} />
      <main className={`flex-grow w-full ${width} mx-auto px-6 py-12 md:py-16 flex flex-col gap-8`}>
        <header className="flex flex-col gap-3">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight leading-[1.05]">{title}</h1>
          {lead && <p className="text-lg text-ink-muted max-w-2xl">{lead}</p>}
        </header>
        {children}
      </main>
      <footer className="w-full border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-ink-faintest">
          Unaudited · local fork only · no real funds · not financial advice
        </div>
      </footer>
    </div>
  );
}

export function Card({ children, className = "", dark = false }: { children: React.ReactNode; className?: string; dark?: boolean }) {
  return (
    <div className={`rounded-3xl p-6 sm:p-8 ${dark ? "bg-ink text-cream" : "bg-surface border border-border"} ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  href,
  children,
  variant = "primary",
  "aria-label": ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "outline";
  "aria-label"?: string;
}) {
  const styles = {
    primary: "bg-green text-white hover:bg-[#346a5a] shadow-[0_8px_24px_-8px_rgba(62,124,106,0.7)]",
    outline: "text-ink border-2 border-ink hover:bg-ink hover:text-cream",
  }[variant];
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`group inline-flex items-center justify-center gap-2 font-bold text-sm rounded-full px-5 py-3 transition-all ${styles}`}
    >
      {children}
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

/** Class for native <button>/submit elements so they match Button. */
export const buttonClass =
  "inline-flex items-center justify-center gap-2 font-bold text-sm rounded-full px-5 py-3 transition-all bg-green text-white hover:bg-[#346a5a] disabled:opacity-40 disabled:cursor-not-allowed";

export const inputClass =
  "border border-border rounded-xl px-3.5 py-2.5 font-mono text-sm bg-cream focus:outline-none focus:border-green";

/** Honest one-liner for what a page needs / doesn't do. */
export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-faintest">{children}</p>;
}

/** Shown by fork-backed pages on a deployment with no FORK_RPC_URL (see lib/deployment.ts). */
export function ForkNotHosted() {
  return (
    <Card className="flex flex-col gap-3 !bg-approval-bg !border-[#EAD9B0]">
      <div className="font-display font-bold text-xl">This page reads the demo chain, which isn&apos;t hosted here</div>
      <p className="text-sm text-ink-muted">
        Steward&apos;s on-chain history lives on a pinned fork of BNB Chain that runs locally, so there is no public
        chain for this page to read. The simulator runs the same policy engine entirely in your browser, and the
        repo has the steps to run the fork yourself.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button href="/simulate">Try the simulator</Button>
        <Button href="https://github.com/Dami904/steward/blob/main/LIVE.md" variant="outline">
          Run it locally
        </Button>
      </div>
    </Card>
  );
}
