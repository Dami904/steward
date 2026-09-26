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

export function SiteNav({ current }: { current?: string }) {
  return (
    <nav className="w-full bg-[#12110e] text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <Link href="/" className="flex items-center gap-2.5 font-display font-bold text-lg tracking-tight shrink-0 px-2 sm:px-0">
          <span className="grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-green to-blue text-xs">S</span>
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
