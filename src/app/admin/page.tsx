import { shownName } from "@/server/names";
import Link from "next/link";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { appointments, auditEvents, careAssignments, integrationEvents, notificationEvents, patients, users } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { getSettings, SETTING_DEFAULTS } from "@/server/settings";
import { addPatient, addStaff, assignStaff, endAssignment, linkBooking, newPatientFromBooking, resetPassword, saveSettings, setStaffActive, simulateBooking, simulateEmailReply } from "@/app/actions/admin";
import { emailMode, inboundEnabled } from "@/server/email";
import { localDate } from "@/lib/time";
import { StaffShell } from "@/components/staff-shell";
import { Badge, Card, SectionHeader } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { formatDateTime } from "@/lib/time";
import { isDemo } from "@/lib/env";
import { AdminForm } from "./admin-forms";

export const dynamic = "force-dynamic";

const TABS = ["patients", "integrations", "staff", "settings", "audit"] as const;

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
                      <p className="font-semibold">{s.displayName ?? s.name}{s.displayName ? <span className="font-normal text-muted"> · {s.name}{s.credentials ? `, ${s.credentials}` : ""}</span> : s.credentials ? `, ${s.credentials}` : ""} {s.deactivatedAt && <Badge tone="neutral">Deactivated</Badge>}</p>
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
        {tab === "integrations" && <IntegrationsTab />}
      </div>
    </StaffShell>
  );
}

async function PatientsTab({ pts }: { pts: { id: string; name: string }[] }) {
  const db = await getDb();
  const list = await db.select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, sport: patients.sport, email: patients.email }).from(patients).where(isNull(patients.archivedAt)).orderBy(patients.lastName);
  const assigns = await db
    .select({ id: careAssignments.id, patientId: careAssignments.patientId, role: careAssignments.role, name: shownName })
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
  const rows = await db.select({ a: auditEvents, actor: shownName }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorId)).orderBy(desc(auditEvents.at)).limit(100);
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

async function IntegrationsTab() {
  const db = await getDb();
  const demo = isDemo();
  const base = (process.env.APP_URL || "https://<your-domain>").replace(/\/$/, "");
  const calendlyOn = !!process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  const mode = emailMode();
  const [unmatched, pts, allPatients, events, outbox] = await Promise.all([
    db.select().from(appointments).where(and(isNull(appointments.patientId), eq(appointments.status, "scheduled"))).orderBy(appointments.startsAt),
    db.select({ id: users.id, name: shownName, email: users.email }).from(users).where(and(eq(users.role, "pt"), isNull(users.deactivatedAt))),
    db.select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName }).from(patients).where(isNull(patients.archivedAt)).orderBy(patients.lastName, patients.firstName),
    db.select().from(integrationEvents).orderBy(desc(integrationEvents.receivedAt)).limit(15),
    db.select({ n: notificationEvents, to: shownName }).from(notificationEvents).innerJoin(users, eq(users.id, notificationEvents.recipientUserId)).orderBy(desc(notificationEvents.createdAt)).limit(25),
  ]);
  const today = localDate();
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Calendly" eyebrow="Bookings → appointments → visits" />
          <p className="text-sm">{calendlyOn ? <Badge tone="green">Connected</Badge> : <Badge tone="amber">Not connected</Badge>} {demo && <Badge tone="neutral">Demo bookings are simulated</Badge>}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>New bookings and cancellations arrive by webhook and match patients by email and PTs by host email.</li>
            <li>When an appointment&apos;s start time passes, it becomes a visit automatically. PTs never add visits by hand.</li>
            <li>Only name, email, time and event type are stored. Intake answers are not imported.</li>
          </ul>
          <p className="mt-3 text-sm">Webhook URL: <code className="break-all rounded bg-sand-100 px-1.5 py-0.5">{base}/api/integrations/calendly</code></p>
          <p className="hint">Create a webhook subscription in Calendly for <code>invitee.created</code> and <code>invitee.canceled</code> with a signing key, then set <code>CALENDLY_WEBHOOK_SIGNING_KEY</code>.</p>
          {demo && (
            <details className="mt-4">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-pine-800">Simulate a Calendly booking (demo)</summary>
              <AdminForm action={simulateBooking} okText="Booking received." className="mt-2 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label" htmlFor="sb-n">Patient name</label><input id="sb-n" name="name" className="input" defaultValue="Robin Walsh" /></div>
                  <div><label className="label" htmlFor="sb-e">Patient email</label><input id="sb-e" name="email" type="email" className="input" defaultValue="robin.walsh@demo.cadence.test" /></div>
                  <div><label className="label" htmlFor="sb-d">Date</label><input id="sb-d" name="date" type="date" className="input" defaultValue={today} /></div>
                  <div><label className="label" htmlFor="sb-t">Time (ET)</label><input id="sb-t" name="time" type="time" className="input" defaultValue="16:00" /></div>
                  <div><label className="label" htmlFor="sb-p">With</label><select id="sb-p" name="ptEmail" className="input">{pts.map((p) => <option key={p.id} value={p.email}>{p.name}</option>)}</select></div>
                  <div><label className="label" htmlFor="sb-ev">Event type</label><select id="sb-ev" name="eventName" className="input"><option>Initial evaluation (75 min)</option><option>Follow-up visit (60 min)</option><option>Virtual check-in (30 min)</option></select></div>
                </div>
                <p className="hint">Use an existing patient&apos;s email (e.g. alex@demo.cadence.test) to see it match, or a new one to see it land in the queue below.</p>
                <button className="btn-primary">Send booking</button>
              </AdminForm>
            </details>
          )}
        </Card>

        <Card>
          <SectionHeader title="Email" eyebrow="Notifications and replies" />
          <p className="text-sm">
            {mode === "smtp" ? <Badge tone="green">Sending via SMTP</Badge> : mode === "simulated" ? <Badge tone="neutral">Simulated (demo)</Badge> : <Badge tone="amber">No email provider configured</Badge>}{" "}
            {inboundEnabled() ? <Badge tone="green">Replies by email on</Badge> : <Badge tone="neutral">Replies by email off</Badge>}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>PTs are emailed when a patient messages them or submits a check-in. Patients are emailed when a plan is published or a PT replies.</li>
            <li>Every email says only “You have a new update from Cadence” with a sign-in link. At most one per conversation every 15 minutes.</li>
            <li>Replying to the email adds the reply to the secure message thread, but only if it comes from that patient&apos;s address or their care team.</li>
          </ul>
          <p className="mt-3 text-sm">Inbound webhook: <code className="break-all rounded bg-sand-100 px-1.5 py-0.5">{base}/api/integrations/email/inbound</code></p>
          {demo && (
            <details className="mt-4">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-pine-800">Simulate a patient replying by email (demo)</summary>
              <AdminForm action={simulateEmailReply} okText="Reply added to the patient's thread." className="mt-2 space-y-3">
                <div><label className="label" htmlFor="er-p">From patient</label><select id="er-p" name="patientId" className="input">{allPatients.slice(0, 60).map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}</select></div>
                <div><label className="label" htmlFor="er-t">Reply text</label><textarea id="er-t" name="text" className="input min-h-20" defaultValue="Thanks! Is it OK if I swap Thursday's run for the bike this week?" /></div>
                <button className="btn-primary">Send reply</button>
              </AdminForm>
            </details>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeader title="Bookings that need a patient record" eyebrow="Email didn't match anyone" />
        {unmatched.length === 0 ? (
          <p className="text-sm text-muted">Every booking matched a patient.</p>
        ) : (
          <ul className="space-y-3">
            {unmatched.map((a) => (
              <li key={a.id} className="rounded-xl border border-sand-200 p-3">
                <p className="font-semibold">{a.inviteeName} <span className="font-normal text-muted">· {a.inviteeEmail}</span></p>
                <p className="text-sm text-muted">{a.eventName} · {formatDateTime(a.startsAt)}{a.simulated ? " · simulated" : ""}</p>
                <div className="mt-2 flex flex-wrap items-start gap-3">
                  <AdminForm action={newPatientFromBooking} className="contents" okText="Patient created.">
                    <input type="hidden" name="appointmentId" value={a.id} />
                    <button className="btn-primary btn-sm">Create new patient</button>
                  </AdminForm>
                  <AdminForm action={linkBooking} className="flex flex-wrap gap-2" okText="Linked.">
                    <input type="hidden" name="appointmentId" value={a.id} />
                    <select name="patientId" aria-label="Existing patient" className="input w-auto">
                      <option value="">Link to existing patient…</option>
                      {allPatients.map((p) => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}</option>)}
                    </select>
                    <button className="btn-secondary btn-sm">Link</button>
                  </AdminForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Notification outbox" eyebrow={mode === "simulated" ? "Demo: nothing is actually sent" : undefined} />
          <ul className="divide-y divide-sand-200 text-sm">
            {outbox.map(({ n, to }) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-semibold">{to}</span> · “{n.subject}”</span>
                <span className="flex items-center gap-2"><Badge tone="neutral">{({ simulated: "Simulated", not_sent: "Not sent (no provider)", throttled: "Skipped (sent recently)", sent: "Sent to provider", failed: "Failed", queued: "Queued" } as Record<string, string>)[n.status]}</Badge><span className="text-muted">{formatDateTime(n.createdAt)}</span></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <SectionHeader title="Integration log" eyebrow="Latest 15 · no message or intake content" />
          {events.length === 0 ? <p className="text-sm text-muted">Nothing received yet.</p> : (
            <ul className="divide-y divide-sand-200 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><code>{e.source}</code> · {e.eventType} · <span className="text-muted">{e.detail}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={e.outcome === "processed" ? "green" : e.outcome === "rejected" ? "red" : "neutral"}>{e.outcome}</Badge><span className="text-muted">{formatDateTime(e.receivedAt)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
