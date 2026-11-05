"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/me", label: "My plan", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/me/visits", label: "My visits", icon: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
  { href: "/me/media", label: "Photos & videos", icon: "M4 7h3l2-2h6l2 2h3v12H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
  { href: "/me/progress", label: "My progress", icon: "M4 19h16M7 15l4-4 3 3 5-6" },
  { href: "/me/messages", label: "Messages", icon: "M4 5h16v11H8l-4 4z" },
];

export function PatientNav({ unread, variant }: { unread: number; variant: "top" | "bottom" }) {
  const path = usePathname();
  const active = (href: string) => (href === "/me" ? path === "/me" || path.startsWith("/me/check-in") : path.startsWith(href));
  if (variant === "top")
    return (
      <nav aria-label="Main" className="flex gap-1">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={`flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold ${active(i.href) ? "border-pine-800 text-pine-900" : "border-transparent text-muted hover:text-ink"}`}>
            {i.label}
            {i.href === "/me/messages" && unread > 0 && <span className="rounded-full bg-lime-400 px-1.5 text-xs text-pine-950">{unread}</span>}
          </Link>
        ))}
      </nav>
    );
  return (
    <nav aria-label="Main" className="grid grid-cols-5">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold leading-tight ${active(i.href) ? "text-pine-900" : "text-muted"}`}>
          <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={active(i.href) ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d={i.icon} />
          </svg>
          <span className="text-center">{i.label}</span>
          {i.href === "/me/messages" && unread > 0 && <span className="absolute right-3 top-2 rounded-full bg-lime-400 px-1.5 text-[10px] text-pine-950">{unread}<span className="sr-only"> unread</span></span>}
          {active(i.href) && <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-pine-800" />}
        </Link>
      ))}
    </nav>
  );
}
