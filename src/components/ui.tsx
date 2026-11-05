import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Approximation of the Cadence logo from the 2026 brand guidelines (three overlapping
 * circles + "cadence."). Always black or white via currentColor. Replace with the
 * official SVG when available.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="cadence.">
      <svg viewBox="-84 -88 168 158" aria-hidden width="26" height="24" fill="none" stroke="currentColor" strokeWidth="7">
        <circle cx="0" cy="-33" r="50" />
        <circle cx="-30" cy="16" r="50" />
        <circle cx="30" cy="16" r="50" />
      </svg>
      <span className="font-semibold lowercase tracking-tight">cadence.</span>
    </span>
  );
}

export function Card({ children, className = "", as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={`card p-4 sm:p-5 ${className}`}>{children}</As>;
}

export function SectionHeader({ title, action, eyebrow }: { title: string; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

const TONES = {
  neutral: "bg-sand-100 text-ink",
  green: "bg-pine-100 text-pine-900",
  lime: "bg-lime-200 text-pine-950",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-900",
  blue: "bg-sky-100 text-sky-900",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`chip ${TONES[tone]}`}>{children}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-sand-300 bg-sand-50/60 px-5 py-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "success" | "error"; title?: string; children: ReactNode }) {
  const t = {
    info: "border-pine-200 bg-pine-50 text-pine-950",
    warn: "border-amber-200 bg-amber-50 text-amber-950",
    success: "border-lime-300 bg-lime-200/40 text-pine-950",
    error: "border-red-200 bg-red-50 text-red-950",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${t}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-pine-800 hover:underline">
      <span aria-hidden>←</span> {children}
    </Link>
  );
}

export function SourceTag({ source }: { source: "pt" | "patient" }) {
  return source === "pt" ? <Badge tone="green">PT-entered</Badge> : <Badge tone="blue">Patient-reported</Badge>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-pine-100 font-semibold text-pine-900" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}
