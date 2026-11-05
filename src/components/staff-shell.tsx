import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthUser } from "@/server/authz";
import { Wordmark } from "./ui";

export function StaffShell({ user, children, nav }: { user: AuthUser; children: ReactNode; nav: { href: string; label: string }[] }) {
  return (
    <div className="min-h-dvh">
      <header className="z-20 border-b border-black bg-black text-white sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <Link href={user.role === "admin" ? "/admin" : "/pt"} className="flex min-h-11 items-center gap-2">
            <Wordmark className="text-base text-white" />
            <span className="hidden text-xs text-white/70 sm:inline">{user.role === "admin" ? "Admin" : "Clinician"}</span>
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="flex min-h-11 items-center rounded-lg px-3 font-medium text-white/80 hover:bg-white/10 hover:text-white">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action="/logout" method="post" className="flex items-center gap-3">
            <span className="hidden text-sm text-white/80 md:inline">
              {user.name}
              {user.credentials ? `, ${user.credentials}` : ""}
            </span>
            <button className="min-h-11 rounded-lg px-3 text-sm font-medium text-white/80 hover:bg-white/10">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 sm:py-8">{children}</main>
    </div>
  );
}
