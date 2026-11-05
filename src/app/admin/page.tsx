import Link from "next/link";
import { desc, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, careAssignments, notificationEvents, patients, users } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { getSettings, SETTING_DEFAULTS } from "@/server/settings";
import { addPatient, addStaff, assignStaff, endAssignment, resetPassword, saveSettings, setStaffActive } from "@/app/actions/admin";
import { StaffShell } from "@/components/staff-shell";
import { Badge, Card, SectionHeader } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { formatDateTime } from "@/lib/time";
import { isDemo } from "@/lib/env";
import { AdminForm } from "./admin-forms";

export const dynamic = "force-dynamic";

const TABS = ["patients", "staff", "settings", "audit", "notifications"] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser(["admin"]);
  const { tab = "patients" } = await searchParams;
  const db = await getDb();
  const staff = await db.select().from(users).where(ne(users.role, "patient")).orderBy(users.role, users.name);
  const pts = staff.filter((s) => s.role === "pt" && !s.deactivatedAt);

  return (
    <StaffShell user={user} nav={TABS.map((t) => ({ href: `/admin?tab=${t}`, label: t[0].toUpperCase() + t.slice(1) }))}>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Clinic admin</h1>
          <p className="text-muted">Operational settings only. Clinical content (plans, messages, check-ins, media) is visible to each patient&apos;s assigned care team, not to admins.</p>
        </div>

        {tab === "patients" && <PatientsTab pts={pts} />}

        {tab === "staff" && (
          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <SectionHeader title="Staff" />
              <ul className="divide-y divide-sand-200">
                {staff.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <p className="font-semibold">{s.name}{s.credentials ? `, ${s.credentials}` : ""} {s.deactivatedAt && <Badge tone="neutral">Deactivated</Badge>}</p>
                      <p className="text-sm text-muted">{s.email} · {s.role === "pt" ? "Physical therapist" : "Admin"}</p>
                    </div>
                    {s.id !== user.id && (
                      <div className="flex gap-2">
                        <AdminForm action={resetPassword} className="contents" okText="Password reset.">
                          <input type="hidden" name="userId" value={s.id} />
                          <button className="btn-ghost btn-sm">Reset password</button>
                        </AdminForm>
                        <form action={setStaffActive}>
                          <input type="hidden" name="userId" value={s.id} />
                          <input type="hidden" name="active" value={s.deactivatedAt ? "1" : "0"} />
                          <SubmitButton className="btn-secondary btn-sm" pendingText="…">{s.deactivatedAt ? "Reactivate" : "Deactivate"}</SubmitButton>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <SectionHeader title="Add staff member" />
              <AdminForm action={addStaff} okText="Staff member added.">
                <div><label className="label" htmlFor="s-name">Name</label><input id="s-name" name="name" className="input" required /></div>
                <div><label className="label" htmlFor="s-email">Email</label><input id="s-email" name="email" type="email" className="input" required /></div>
                <div><label className="label" htmlFor="s-cred">Credentials (optional)</label><input id="s-cred" name="credentials" className="input" placeholder="DPT" /></div>
                <div>
                  <label className="label" htmlFor="s-role">Role</label>
                  <select id="s-role" name="role" className="input"><option value="pt">Physical therapist</option><option value="admin">Admin</option></select>
                </div>
                <button className="btn-primary">Add staff member</button>
              </AdminForm>
            </Card>
          </div>
        )}

        {tab === "settings" && <SettingsTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "notifications" && <NotificationsTab />}
      </div>
    </StaffShell>
  );
}

async function PatientsTab({ pts }: { pts: { id: string; name: string }[] }) {
  const db = await getDb();
  const list = await db.select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, sport: patients.sport, email: patients.email }).from(patients).where(isNull(patients.archivedAt)).orderBy(patients.lastName);
  const assigns = await db
    .select({ id: careAssignments.id, patientId: careAssignments.patientId, role: careAssignments.role, name: users.name })
    .from(careAssignments)
    .innerJoin(users, eq(users.id, careAssignments.staffUserId))
    .where(isNull(careAssignments.endedAt));
  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <Card>
        <SectionHeader title="Patients & care teams" />
        <ul className="space-y-3">
          {list.map((p) => {
            const team = assigns.filter((a) => a.patientId === p.id);
            return (
              <li key={p.id} className="rounded-xl border border-sand-200 p-3">
                <p className="font-semibold">{p.firstName} {p.lastName}</p>
                <p className="text-sm text-muted">{p.email}{p.sport ? ` · ${p.sport}` : ""}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {team.length === 0 && <li><Badge tone="amber">No PT assigned</Badge></li>}
                  {team.map((a) => (
                    <li key={a.id}>
                      <form action={endAssignment} className="flex items-center gap-1 rounded-full bg-sand-100 py-0.5 pl-3 pr-1 text-sm">
                        <input type="hidden" name="assignmentId" value={a.id} />
                        {a.name} · {a.role === "primary" ? "Primary" : "Covering"}
                        <button aria-label={`Remove ${a.name} from care team`} className="flex size-8 items-center justify-center rounded-full hover:bg-sand-200">×</button>
                      </form>
                    </li>
                  ))}
                </ul>
                <AdminForm action={assignStaff} className="mt-2 flex flex-wrap gap-2" okText="Assigned.">
                  <input type="hidden" name="patientId" value={p.id} />
                  <select name="staffUserId" aria-label="PT" className="input w-auto">{pts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  <select name="role" aria-label="Assignment role" className="input w-auto"><option value="covering">Covering</option><option value="primary">Primary</option></select>
                  <button className="btn-secondary btn-sm">Assign</button>
                </AdminForm>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <SectionHeader title="Add patient" />
        <AdminForm action={addPatient} okText="Patient added.">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="p-f">First name</label><input id="p-f" name="firstName" className="input" required /></div>
            <div><label className="label" htmlFor="p-l">Last name</label><input id="p-l" name="lastName" className="input" required /></div>
          </div>
          <div><label className="label" htmlFor="p-e">Email</label><input id="p-e" name="email" type="email" className="input" required /></div>
          <div><label className="label" htmlFor="p-s">Sport (optional)</label><input id="p-s" name="sport" className="input" placeholder="e.g. Marathon" /></div>
          <div>
            <label className="label" htmlFor="p-pt">Primary PT</label>
            <select id="p-pt" name="primaryPtId" className="input">{pts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
          {isDemo() && <p className="hint">Demo environment: use fictional people only.</p>}
          <button className="btn-primary">Add patient</button>
        </AdminForm>
      </Card>
    </div>
  );
}

async function SettingsTab() {
  const db = await getDb();
  const s = await getSettings(db);
  return (
    <Card className="max-w-2xl">
      <SectionHeader title="Messaging expectations" />
      <AdminForm action={saveSettings}>
        <div>
          <label className="label" htmlFor="set-r">Response expectation (shown to patients)</label>
          <textarea id="set-r" name="responseExpectation" className="input min-h-20" defaultValue={s.responseExpectation} placeholder={SETTING_DEFAULTS.responseExpectation} />
        </div>
        <div>
          <label className="label" htmlFor="set-u">Urgent-care guidance (shown with messages and check-ins)</label>
          <textarea id="set-u" name="urgentGuidance" className="input min-h-24" defaultValue={s.urgentGuidance} />
        </div>
        <div>
          <label className="label" htmlFor="set-n">Clinic name</label>
          <input id="set-n" name="clinicName" className="input" defaultValue={s.clinicName} />
        </div>
        <button className="btn-primary">Save settings</button>
      </AdminForm>
    </Card>
  );
}

async function AuditTab() {
  const db = await getDb();
  const rows = await db.select({ a: auditEvents, actor: users.name }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorId)).orderBy(desc(auditEvents.at)).limit(100);
  return (
    <Card>
      <SectionHeader title="Audit log" eyebrow="Latest 100 events · metadata only, no clinical content" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-muted"><tr><th className="py-1.5 font-medium">When</th><th className="font-medium">Who</th><th className="font-medium">Action</th><th className="font-medium">Record</th><th className="font-medium">Details</th></tr></thead>
          <tbody>
            {rows.map(({ a, actor }) => (
              <tr key={a.id} className="border-t border-sand-200">
                <td className="py-1.5 whitespace-nowrap">{formatDateTime(a.at)}</td>
                <td>{actor ?? "—"}</td>
                <td><code>{a.action}</code></td>
                <td className="text-muted">{a.entityType}{a.entityId ? ` ${a.entityId.slice(0, 8)}` : ""}</td>
                <td className="text-muted">{a.meta ? Object.entries(a.meta).map(([k, v]) => `${k}=${v}`).join(", ") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function NotificationsTab() {
  const db = await getDb();
  const rows = await db.select({ n: notificationEvents, to: users.name }).from(notificationEvents).innerJoin(users, eq(users.id, notificationEvents.recipientUserId)).orderBy(desc(notificationEvents.createdAt)).limit(50);
  return (
    <Card>
      <SectionHeader title="Notification outbox" eyebrow={isDemo() ? "Demo: nothing is actually sent" : "No email provider is configured"} />
      <p className="mb-3 text-sm text-muted">Every notification uses the same generic wording and a sign-in link. Status is never shown as “delivered”.</p>
      <ul className="divide-y divide-sand-200 text-sm">
        {rows.map(({ n, to }) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><span className="font-semibold">{to}</span> · “{n.subject}” · <code>{n.linkPath.replace(/[0-9a-f-]{36}/g, ":id")}</code></span>
            <span className="flex items-center gap-2"><Badge tone="neutral">{n.status === "simulated" ? "Simulated" : n.status === "not_sent" ? "Not sent (no provider)" : n.status}</Badge><span className="text-muted">{formatDateTime(n.createdAt)}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted"><Link href="/admin?tab=audit" className="underline">Audit log</Link></p>
    </Card>
  );
}

