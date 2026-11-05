import Link from "next/link";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { careAssignments, checkIns, patients, planDrafts, planVersions, visits } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { assignedPatientIds } from "@/server/authz";
import { unreadByPatient } from "@/server/messaging";
import { materializeVisits, upcomingForPt } from "@/server/scheduling";
import { Avatar, Badge, Card, EmptyState } from "@/components/ui";
import { addDays, formatDate, formatDateTime, formatTime, localDate } from "@/lib/time";

const PAGE = 40;
type View = "upcoming" | "recent" | "all";
type Filter = "all" | "primary" | "covering" | "inactive";

export default async function PtDashboard({ searchParams }: { searchParams: Promise<{ q?: string; view?: string; filter?: string; page?: string }> }) {
  const user = await requirePageUser(["pt"]);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const view: View = sp.view === "recent" || sp.view === "all" ? sp.view : "upcoming";
  const filter: Filter = (["primary", "covering", "inactive"] as const).find((f) => f === sp.filter) ?? "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const db = await getDb();
  await materializeVisits(db); // bookings whose time has passed become visits
  const ids = await assignedPatientIds(db, user.id);
  const today = localDate();

  const [pts, lastVisitRows, unread, unreviewed, drafts, recent, upcoming, myRecentVisits] = await Promise.all([
    ids.length
      ? db
          .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, sport: patients.sport, role: careAssignments.role })
          .from(patients)
          .innerJoin(careAssignments, and(eq(careAssignments.patientId, patients.id), eq(careAssignments.staffUserId, user.id), isNull(careAssignments.endedAt)))
          .where(and(inArray(patients.id, ids), isNull(patients.archivedAt)))
          .orderBy(patients.lastName, patients.firstName)
      : [],
    ids.length ? db.select({ patientId: visits.patientId, last: sql<string>`max(${visits.visitDate})::text` }).from(visits).where(inArray(visits.patientId, ids)).groupBy(visits.patientId) : [],
    unreadByPatient(db, user.id, ids),
    ids.length ? db.select({ id: checkIns.id, patientId: checkIns.patientId, activityDate: checkIns.activityDate, activityType: checkIns.activityType, hasQuestion: checkIns.question }).from(checkIns).where(and(inArray(checkIns.patientId, ids), eq(checkIns.reviewStatus, "unreviewed"))).orderBy(desc(checkIns.createdAt)) : [],
    ids.length ? db.select({ id: planDrafts.id, patientId: planDrafts.patientId, kind: planDrafts.kind, visitId: planDrafts.visitId, updatedAt: planDrafts.updatedAt, visitDate: visits.visitDate }).from(planDrafts).leftJoin(visits, eq(visits.id, planDrafts.visitId)).where(and(inArray(planDrafts.patientId, ids), eq(planDrafts.status, "draft"))).orderBy(desc(planDrafts.updatedAt)) : [],
    ids.length ? db.select({ id: planVersions.id, patientId: planVersions.patientId, visitId: planVersions.visitId, versionNumber: planVersions.versionNumber, publishedAt: planVersions.publishedAt }).from(planVersions).where(inArray(planVersions.patientId, ids)).orderBy(desc(planVersions.publishedAt)).limit(200) : [],
    upcomingForPt(db, user.id, ids, 7),
    ids.length ? db.select({ id: visits.id, patientId: visits.patientId, visitDate: visits.visitDate }).from(visits).where(and(inArray(visits.patientId, ids), eq(visits.ptUserId, user.id), gte(visits.visitDate, addDays(today, -7)))).orderBy(desc(visits.visitDate)) : [],
  ]);

  const nameOf = new Map(pts.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  const lastVisit = new Map(lastVisitRows.map((r) => [r.patientId, r.last]));
  const nextAppt = new Map<string, Date>();
  for (const u of upcoming) if (u.a.patientId && !nextAppt.has(u.a.patientId)) nextAppt.set(u.a.patientId, u.a.startsAt);
  const unreviewedBy = new Map<string, number>();
  for (const c of unreviewed) unreviewedBy.set(c.patientId, (unreviewedBy.get(c.patientId) ?? 0) + 1);
  const unreadTotal = [...unread.values()].reduce((a, b) => a + b, 0);
  const updatedVisitIds = new Set([...recent.map((v) => v.visitId), ...drafts.map((d) => d.visitId)].filter(Boolean));
  const awaitingUpdate = myRecentVisits.filter((v) => !updatedVisitIds.has(v.id));
  const todayCount = upcoming.filter((u) => localDate(u.a.startsAt) === today).length;

  const row = (p: (typeof pts)[number], extra?: React.ReactNode) => (
    <li key={p.id}>
      <Link href={`/pt/patients/${p.id}`} className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-sand-50">
        <Avatar name={`${p.firstName} ${p.lastName}`} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{p.lastName}, {p.firstName}</span>
          <span className="block truncate text-sm text-muted">{extra ?? `${p.sport ?? ""}${lastVisit.get(p.id) ? ` · last visit ${formatDate(lastVisit.get(p.id), { month: "short", day: "numeric" })}` : " · no visits yet"}`}</span>
        </span>
        <span className="flex flex-wrap justify-end gap-1">
          {p.role === "covering" && <Badge tone="neutral">Covering</Badge>}
          {!!unread.get(p.id) && <Badge tone="lime">{unread.get(p.id)} unread</Badge>}
          {!!unreviewedBy.get(p.id) && <Badge tone="amber">{unreviewedBy.get(p.id)} to review</Badge>}
        </span>
      </Link>
    </li>
  );

  // ---- list body ----
  let body: React.ReactNode;
  if (q) {
    const hits = pts.filter((p) => `${p.firstName} ${p.lastName} ${p.lastName}, ${p.firstName}`.toLowerCase().includes(q.toLowerCase()));
    body = hits.length ? <ul className="divide-y divide-sand-200">{hits.slice(0, 60).map((p) => row(p))}</ul> : <EmptyState title="No assigned patients match that name" />;
  } else if (view === "upcoming") {
    const byDay = new Map<string, typeof upcoming>();
    for (const u of upcoming) byDay.set(localDate(u.a.startsAt), [...(byDay.get(localDate(u.a.startsAt)) ?? []), u]);
    body = upcoming.length ? (
      <div className="space-y-4">
        {[...byDay.entries()].map(([day, list]) => (
          <section key={day}>
            <h3 className="eyebrow mb-1">{day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : formatDate(day, { weekday: "long", month: "short", day: "numeric" })}</h3>
            <ul className="divide-y divide-sand-200">
              {list.map((u) => (
                <li key={u.a.id}>
                  <Link href={`/pt/patients/${u.a.patientId}`} className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-sand-50">
                    <span className="w-20 shrink-0 text-sm font-semibold tabular-nums">{formatTime(u.a.startsAt)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{u.firstName} {u.lastName}</span>
                      <span className="block truncate text-sm text-muted">{u.a.eventName ?? "Appointment"}</span>
                    </span>
                    {!lastVisit.get(u.a.patientId!) && <Badge tone="blue">New patient</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    ) : (
      <EmptyState title="No booked appointments in the next 7 days" body="Bookings appear here automatically from Calendly." />
    );
  } else if (view === "recent") {
    const cutoff = addDays(today, -30);
    const list = pts.filter((p) => (lastVisit.get(p.id) ?? "") >= cutoff).sort((a, b) => (lastVisit.get(b.id) ?? "").localeCompare(lastVisit.get(a.id) ?? ""));
    body = list.length ? (
      <ul className="divide-y divide-sand-200">
        {list.map((p) => row(p, `Seen ${formatDate(lastVisit.get(p.id), { weekday: "short", month: "short", day: "numeric" })}${nextAppt.get(p.id) ? ` · next ${formatDate(localDate(nextAppt.get(p.id)), { weekday: "short", month: "short", day: "numeric" })}` : ""}`))}
      </ul>
    ) : (
      <EmptyState title="No visits in the last 30 days" />
    );
  } else {
    const inactiveCutoff = addDays(today, -60);
    const list = pts.filter((p) => (filter === "primary" ? p.role === "primary" : filter === "covering" ? p.role === "covering" : filter === "inactive" ? (lastVisit.get(p.id) ?? "") < inactiveCutoff && !nextAppt.has(p.id) : true));
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const slice = list.slice((page - 1) * PAGE, page * PAGE);
    let letter = "";
    body = (
      <>
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter">
          {(
            [
              ["all", "All"],
              ["primary", "My primary"],
              ["covering", "Covering"],
              ["inactive", "Not seen in 60+ days"],
            ] as const
          ).map(([k, l]) => (
            <Link key={k} href={`/pt?view=all&filter=${k}`} aria-current={filter === k ? "true" : undefined} className={`flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${filter === k ? "border-pine-900 bg-pine-900 text-white" : "border-sand-300 bg-white"}`}>
              {l}
            </Link>
          ))}
        </div>
        <p className="mb-1 text-sm text-muted">{list.length} patient{list.length === 1 ? "" : "s"}</p>
        {slice.length === 0 ? (
          <EmptyState title="No patients in this view" />
        ) : (
          <ul>
            {slice.map((p) => {
              const l = p.lastName[0]?.toUpperCase() ?? "#";
              const head = l !== letter ? ((letter = l), <li key={`h-${l}`} className="eyebrow mt-3 border-b border-sand-200 pb-1">{l}</li>) : null;
              return [head, row(p)];
            })}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-3 flex items-center justify-between">
            {page > 1 ? <Link className="btn-secondary btn-sm" href={`/pt?view=all&filter=${filter}&page=${page - 1}`}>Previous</Link> : <span />}
            <span className="text-sm text-muted">Page {page} of {pages}</span>
            {page < pages ? <Link className="btn-secondary btn-sm" href={`/pt?view=all&filter=${filter}&page=${page + 1}`}>Next</Link> : <span />}
          </nav>
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Good to see you, {user.name}</p>
        <h1 className="text-2xl font-semibold">Your patients</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Appointments today" value={todayCount} href="/pt?view=upcoming" />
        <Stat label="Unread messages" value={unreadTotal} href="#review" />
        <Stat label="Check-ins to review" value={unreviewed.length} href="#review" />
        <Stat label="Visits this week without an update" value={awaitingUpdate.length} href="#review" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <form role="search" className="mb-3">
            <label htmlFor="q" className="sr-only">Search all your patients by name</label>
            <input id="q" name="q" defaultValue={q} placeholder={`Search all ${pts.length} of your patients`} className="input" />
          </form>
          {!q && (
            <nav aria-label="Patient views" className="mb-3 flex gap-1 border-b border-sand-200">
              {(
                [
                  ["upcoming", `Upcoming (${upcoming.length})`],
                  ["recent", "Recently seen"],
                  ["all", `All (${pts.length})`],
                ] as const
              ).map(([k, l]) => (
                <Link key={k} href={`/pt?view=${k}`} aria-current={view === k ? "page" : undefined} className={`flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold ${view === k ? "border-pine-900 text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                  {l}
                </Link>
              ))}
            </nav>
          )}
          {q && (
            <p className="mb-2 text-sm text-muted">
              Results for “{q}” · <Link href="/pt" className="font-semibold text-pine-800 underline">Clear</Link>
            </p>
          )}
          {body}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 id="review" className="mb-3 text-lg font-semibold">Needs your attention</h2>
            {unreadTotal === 0 && unreviewed.length === 0 && awaitingUpdate.length === 0 ? (
              <EmptyState title="You're all caught up" body="Messages, check-ins and visits that still need an update will appear here." />
            ) : (
              <ul className="space-y-2">
                {awaitingUpdate.slice(0, 6).map((v) => (
                  <li key={`v-${v.id}`}>
                    <Link href={`/pt/patients/${v.patientId}/update/new?visitId=${v.id}`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-sand-50 px-3 py-2 hover:bg-sand-100">
                      <span>
                        <span className="font-semibold">{nameOf.get(v.patientId)}</span> <span className="text-muted">· visit {formatDate(v.visitDate, { month: "short", day: "numeric" })}</span>
                      </span>
                      <Badge tone="blue">Write update</Badge>
                    </Link>
                  </li>
                ))}
                {awaitingUpdate.length > 6 && <li className="px-3 text-sm text-muted">and {awaitingUpdate.length - 6} more visits from the last week</li>}
                {[...unread.entries()].map(([pid, n]) => (
                  <li key={`m-${pid}`}>
                    <Link href={`/pt/patients/${pid}?tab=messages`} className="flex min-h-11 items-center justify-between rounded-xl bg-sand-50 px-3 py-2 hover:bg-sand-100">
                      <span><span className="font-semibold">{nameOf.get(pid)}</span> <span className="text-muted">· message</span></span>
                      <Badge tone="lime">{n} unread</Badge>
                    </Link>
                  </li>
                ))}
                {unreviewed.slice(0, 12).map((c) => (
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
            <h2 className="mb-3 text-lg font-semibold">Draft visit updates</h2>
            {drafts.length === 0 ? (
              <p className="text-sm text-muted">No drafts in progress.</p>
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
              <p className="text-sm text-muted">Nothing published yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {recent.slice(0, 6).map((v) => (
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
    <a href={href} className="card flex items-center justify-between gap-2 px-4 py-3 hover:border-pine-600">
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${value ? "text-pine-900" : "text-sand-300"}`}>{value}</span>
    </a>
  );
}

