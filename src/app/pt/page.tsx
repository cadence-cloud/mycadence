import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { careAssignments, checkIns, patients, planDrafts, planVersions, visits } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { assignedPatientIds } from "@/server/authz";
import { unreadByPatient } from "@/server/messaging";
import { Avatar, Badge, Card, EmptyState, SectionHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/time";

export default async function PtDashboard({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePageUser(["pt"]);
  const { q = "" } = await searchParams;
  const db = await getDb();
  const ids = await assignedPatientIds(db, user.id);

  const pts = ids.length
    ? await db
        .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, sport: patients.sport, role: careAssignments.role })
        .from(patients)
        .innerJoin(careAssignments, and(eq(careAssignments.patientId, patients.id), eq(careAssignments.staffUserId, user.id), isNull(careAssignments.endedAt)))
        .where(and(inArray(patients.id, ids), isNull(patients.archivedAt)))
        .orderBy(patients.lastName)
    : [];
  const needle = q.trim().toLowerCase();
  const filtered = needle ? pts.filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(needle)) : pts;

  const [unread, unreviewed, drafts, recent, lastVisits] = await Promise.all([
    unreadByPatient(db, user.id, ids),
    ids.length ? db.select({ id: checkIns.id, patientId: checkIns.patientId, activityDate: checkIns.activityDate, activityType: checkIns.activityType, hasQuestion: checkIns.question }).from(checkIns).where(and(inArray(checkIns.patientId, ids), eq(checkIns.reviewStatus, "unreviewed"))).orderBy(desc(checkIns.createdAt)) : [],
    ids.length ? db.select({ id: planDrafts.id, patientId: planDrafts.patientId, kind: planDrafts.kind, updatedAt: planDrafts.updatedAt, visitDate: visits.visitDate }).from(planDrafts).leftJoin(visits, eq(visits.id, planDrafts.visitId)).where(and(inArray(planDrafts.patientId, ids), eq(planDrafts.status, "draft"))).orderBy(desc(planDrafts.updatedAt)) : [],
    ids.length ? db.select({ id: planVersions.id, patientId: planVersions.patientId, versionNumber: planVersions.versionNumber, publishedAt: planVersions.publishedAt }).from(planVersions).where(inArray(planVersions.patientId, ids)).orderBy(desc(planVersions.publishedAt)).limit(6) : [],
    ids.length ? db.select({ patientId: visits.patientId, visitDate: visits.visitDate }).from(visits).where(inArray(visits.patientId, ids)).orderBy(desc(visits.visitDate)) : [],
  ]);
  const nameOf = new Map(pts.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  const lastVisit = new Map<string, string>();
  for (const v of lastVisits) if (!lastVisit.has(v.patientId)) lastVisit.set(v.patientId, v.visitDate);
  const unreviewedBy = new Map<string, number>();
  for (const c of unreviewed) unreviewedBy.set(c.patientId, (unreviewedBy.get(c.patientId) ?? 0) + 1);
  const unreadTotal = [...unread.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Good to see you, {user.name.split(" ")[0]}</p>
        <h1 className="text-2xl font-semibold">Your patients</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Unread messages" value={unreadTotal} href="#inbox" />
        <Stat label="Check-ins to review" value={unreviewed.length} href="#inbox" />
        <Stat label="Draft updates" value={drafts.length} href="#drafts" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionHeader title="Assigned patients" />
          <form className="mb-3" role="search">
            <label htmlFor="q" className="sr-only">Search patients by name</label>
            <input id="q" name="q" defaultValue={q} placeholder="Search by name" className="input" />
          </form>
          {filtered.length === 0 ? (
            <EmptyState title={needle ? "No assigned patients match that name" : "No patients assigned yet"} body={needle ? undefined : "An admin assigns patients to you from the Admin area."} />
          ) : (
            <ul className="divide-y divide-sand-200">
              {filtered.map((p) => (
                <li key={p.id}>
                  <Link href={`/pt/patients/${p.id}`} className="flex min-h-16 items-center gap-3 py-2.5 hover:bg-sand-50 sm:-mx-2 sm:px-2 sm:rounded-xl">
                    <Avatar name={`${p.firstName} ${p.lastName}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {p.sport} · {lastVisit.get(p.id) ? `Last visit ${formatDate(lastVisit.get(p.id), { month: "short", day: "numeric" })}` : "No visits yet"}
                      </span>
                    </span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {p.role === "covering" && <Badge tone="neutral">Covering</Badge>}
                      {!!unread.get(p.id) && <Badge tone="lime">{unread.get(p.id)} unread</Badge>}
                      {!!unreviewedBy.get(p.id) && <Badge tone="amber">{unreviewedBy.get(p.id)} to review</Badge>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 id="inbox" className="mb-3 text-lg font-semibold">Needs your review</h2>
            {unreadTotal === 0 && unreviewed.length === 0 ? (
              <EmptyState title="You're all caught up" body="New messages and check-ins from your patients will appear here." />
            ) : (
              <ul className="space-y-2">
                {[...unread.entries()].map(([pid, n]) => (
                  <li key={`m-${pid}`}>
                    <Link href={`/pt/patients/${pid}?tab=messages`} className="flex min-h-11 items-center justify-between rounded-xl bg-sand-50 px-3 py-2 hover:bg-sand-100">
                      <span><span className="font-semibold">{nameOf.get(pid)}</span> <span className="text-muted">· message</span></span>
                      <Badge tone="lime">{n} unread</Badge>
                    </Link>
                  </li>
                ))}
                {unreviewed.map((c) => (
                  <li key={c.id}>
                    <Link href={`/pt/patients/${c.patientId}?tab=checkins`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-sand-50 px-3 py-2 hover:bg-sand-100">
                      <span>
                        <span className="font-semibold">{nameOf.get(c.patientId)}</span>{" "}
                        <span className="text-muted">· {c.activityType}, {formatDate(c.activityDate, { month: "short", day: "numeric" })}</span>
                      </span>
                      <span className="flex gap-1">{c.hasQuestion && <Badge tone="blue">Question</Badge>}<Badge tone="amber">Unreviewed</Badge></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 id="drafts" className="mb-3 text-lg font-semibold">Draft visit updates</h2>
            {drafts.length === 0 ? (
              <EmptyState title="No drafts in progress" />
            ) : (
              <ul className="space-y-2">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <Link href={`/pt/patients/${d.patientId}/update/${d.id}`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-sand-50 px-3 py-2 hover:bg-sand-100">
                      <span>
                        <span className="font-semibold">{nameOf.get(d.patientId)}</span>{" "}
                        <span className="text-muted">· {d.kind === "correction" ? "Correction" : d.visitDate ? `Visit ${formatDate(d.visitDate, { month: "short", day: "numeric" })}` : "Update"}</span>
                      </span>
                      <span className="text-xs text-muted">Saved {formatDateTime(d.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Recently published</h2>
            {recent.length === 0 ? (
              <EmptyState title="Nothing published yet" />
            ) : (
              <ul className="space-y-1 text-sm">
                {recent.map((v) => (
                  <li key={v.id} className="flex justify-between gap-2 py-1">
                    <Link className="font-medium text-pine-800 hover:underline" href={`/pt/patients/${v.patientId}?tab=history`}>
                      {nameOf.get(v.patientId)} · v{v.versionNumber}
                    </Link>
                    <span className="text-muted">{formatDateTime(v.publishedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <a href={href} className="card flex items-center justify-between px-4 py-3 hover:border-pine-600">
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className={`text-2xl font-semibold ${value ? "text-pine-900" : "text-sand-300"}`}>{value}</span>
    </a>
  );
}
