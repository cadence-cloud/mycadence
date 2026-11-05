import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, patients } from "@/db/schema";
import { isDemo } from "@/lib/env";
import { demoSwitchAction } from "@/app/actions/auth";
import { Avatar, Wordmark } from "@/components/ui";

export const dynamic = "force-dynamic";

const ROLE_COPY = {
  admin: { label: "Admin", desc: "Staff, assignments, clinic settings, audit log." },
  pt: { label: "Physical therapist", desc: "Assigned patients, visit updates, check-ins, messages." },
  patient: { label: "Patient", desc: "Their own plan, visits, media, progress and messages." },
} as const;

export default async function DemoPage() {
  if (!isDemo()) notFound();
  const db = await getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role, credentials: users.credentials, sport: patients.sport })
    .from(users)
    .leftJoin(patients, eq(patients.userId, users.id))
    .where(eq(users.isDemo, true))
    .orderBy(asc(users.role), asc(users.name));
  const groups = (["pt", "patient", "admin"] as const).map((r) => ({ role: r, list: rows.filter((u) => u.role === r) }));
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Wordmark className="text-xl text-black" />
      <h1 className="mt-4 text-2xl font-semibold">Demo environment</h1>
      <p className="mt-2 max-w-prose text-muted">
        Every patient here is fictional. Pick an account to see the app from that role. Role switching exists only in the demo
        environment; the live environment requires a real sign-in and enforces permissions on the server.
      </p>
      <p className="mt-2 text-sm text-muted">Password for every demo account: <code className="rounded bg-sand-100 px-1.5 py-0.5">cadence-demo</code></p>
      {groups.map((g) => (
        <section key={g.role} className="mt-8">
          <h2 className="text-lg font-semibold">{ROLE_COPY[g.role].label}</h2>
          <p className="text-sm text-muted">{ROLE_COPY[g.role].desc}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {g.list.map((u) => (
              <li key={u.id}>
                <form action={demoSwitchAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className="card flex w-full items-center gap-3 p-3 text-left hover:border-pine-600">
                    <Avatar name={u.name} />
                    <span>
                      <span className="block font-semibold">{u.name}{u.credentials ? `, ${u.credentials}` : ""}</span>
                      <span className="block text-sm text-muted">{u.sport ?? ROLE_COPY[g.role].label}</span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
