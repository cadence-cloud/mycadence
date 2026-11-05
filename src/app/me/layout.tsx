import { getDb } from "@/db";
import { requirePageUser } from "@/server/session";
import { patientIdForUser } from "@/server/authz";
import { unreadByPatient } from "@/server/messaging";
import { Wordmark } from "@/components/ui";
import { PatientNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser(["patient"]);
  const db = await getDb();
  const pid = await patientIdForUser(db, user.id);
  const unread = pid ? (await unreadByPatient(db, user.id, [pid])).get(pid) ?? 0 : 0;
  return (
    <div className="min-h-dvh pb-24 sm:pb-0">
      <header className="border-b border-sand-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2">
          <div className="flex min-h-11 items-center gap-2">
            <Wordmark className="text-black" />
            <span className="text-sm text-muted">My Cadence</span>
          </div>
          <form action="/logout" method="post">
            <button className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:bg-sand-100">Sign out</button>
          </form>
        </div>
        <div className="mx-auto hidden max-w-3xl px-4 sm:block">
          <PatientNav unread={unread} variant="top" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-sand-200 bg-white sm:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <PatientNav unread={unread} variant="bottom" />
      </div>
    </div>
  );
}
