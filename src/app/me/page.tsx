import Link from "next/link";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { completionEntries } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { patientIdForUser } from "@/server/authz";
import { careTeam, getAssignments, getMilestones, getPatient, getVersions } from "@/server/patient-data";
import { getSettings } from "@/server/settings";
import { patientSendMessage } from "@/app/actions/patient";
import { Card, EmptyState } from "@/components/ui";
import { ChangeSummary } from "@/components/plan-view";
import { MessageForm } from "@/components/forms";
import { addDays, formatDate, formatDateTime, localDate, relativeDay, weekdayOf } from "@/lib/time";
import type { PlanItem } from "@/lib/plan-types";
import { Tracker, type TrackItem } from "./tracker";

export default async function PatientHome() {
  const user = await requirePageUser(["patient"]);
  const db = await getDb();
  const pid = await patientIdForUser(db, user.id);
  if (!pid) return <EmptyState title="Your account isn't linked to a patient record yet" body="Please contact the clinic." />;
  const [patient, versions, milestones, team, settings] = await Promise.all([getPatient(db, pid), getVersions(db, pid), getMilestones(db, pid), careTeam(db, pid), getSettings(db)]);
  const current = versions[0];
  const today = localDate();
  const primary = team.find((t) => t.role === "primary") ?? team[0];

  if (!current) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold">Hi {patient!.firstName}</h1>
        <EmptyState title="Your plan will appear here" body="After your visit, your PT will publish your exercises, running guidance and next steps here." />
        <QuickAsk firstName={primary?.name.split(" ")[0]} settings={settings} />
      </div>
    );
  }

  const assignments = await getAssignments(db, current.id);
  const since = addDays(today, -6);
  const entryRows = await db.select().from(completionEntries).where(and(eq(completionEntries.patientId, pid), eq(completionEntries.planVersionId, current.id), gte(completionEntries.sessionDate, since)));
  const entries: Record<string, Record<string, { status: "completed" | "partial" | "skipped"; comment: string | null }>> = {};
  for (const e of entryRows) (entries[e.sessionDate] ??= {})[e.assignmentId] = { status: e.status, comment: e.comment };

  const byKey = new Map(current.content.items.map((i) => [i.key, i]));
  const track: TrackItem[] = assignments.map((a) => {
    const item: PlanItem = byKey.get(a.itemKey) ?? { key: a.itemKey, name: a.name, dosage: a.dosage, frequency: a.frequency, scheduleDays: a.scheduleDays as PlanItem["scheduleDays"], cues: a.cues };
    return { assignmentId: a.id, item, mediaHref: a.patientMediaId ? `/me/media#m-${a.patientMediaId}` : null };
  });
  // "Today's plan" only when the PT actually set a schedule.
  const hasSchedule = track.some((t) => t.item.scheduleDays?.length);
  const dow = weekdayOf(today);
  const groups = hasSchedule
    ? [
        { title: "Scheduled today", items: track.filter((t) => t.item.scheduleDays?.includes(dow)) },
        { title: "Not scheduled today", items: track.filter((t) => !t.item.scheduleDays?.includes(dow)) },
      ].filter((g) => g.items.length)
    : [{ title: null, items: track }];
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).map((d) => ({ value: d, label: relativeDay(d, today) }));
  const milestone = milestones.find((m) => m.status === "upcoming");
  const c = current.content;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-muted">Hi {patient!.firstName}</p>
        <h1 className="text-2xl font-semibold">{hasSchedule ? "Today’s plan" : "Current plan"}</h1>
        <p className="text-sm text-muted">
          Updated {formatDate(localDate(current.publishedAt), { month: "short", day: "numeric" })} by {current.publishedByName}
        </p>
      </div>

      {current.correctionNote && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[15px]">
          <span className="font-semibold">Your PT corrected your plan: </span>
          {current.correctionNote}
        </div>
      )}

      <Card>
        <Tracker groups={groups} entries={entries} dates={dates} />
        {c.links.length > 0 && (
          <div className="mt-4 border-t border-sand-200 pt-3">
            {c.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center font-semibold text-pine-800 underline">
                {l.label || "Open link"} ↗
              </a>
            ))}
            <p className="text-xs text-muted">Opens outside My Cadence.</p>
          </div>
        )}
      </Card>

      <Card>
        <p className="eyebrow">Latest update from {current.publishedByName.split(" ")[0]}</p>
        <p className="mt-1 text-sm text-muted">{formatDateTime(current.publishedAt)}</p>
        {c.recap && <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{c.recap}</p>}
        {current.changeSummary && versions.length > 1 && (
          <div className="mt-3">
            <p className="mb-1 text-sm font-semibold">What changed</p>
            <ChangeSummary s={current.changeSummary} />
          </div>
        )}
        <Link href="/me/visits" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-pine-800">All visits →</Link>
      </Card>

      {c.runningGuidance && (
        <Card>
          <p className="eyebrow">Running guidance</p>
          <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">{c.runningGuidance}</p>
          <Link href="/me/check-in" className="btn-secondary mt-3 w-full sm:w-auto">Log a run or workout</Link>
        </Card>
      )}

      {(milestone || c.reassessNext) && (
        <Card>
          {milestone && (
            <>
              <p className="eyebrow">Next milestone</p>
              <p className="mt-1 text-[17px] font-semibold">{milestone.title}</p>
            </>
          )}
          {c.reassessNext && <p className={`${milestone ? "mt-3" : ""} text-[15px]`}><span className="font-semibold">At your next visit: </span>{c.reassessNext}</p>}
        </Card>
      )}

      <QuickAsk firstName={primary?.name.split(" ")[0]} settings={settings} />
    </div>
  );
}

function QuickAsk({ firstName, settings }: { firstName?: string; settings: { responseExpectation: string; urgentGuidance: string } }) {
  return (
    <Card>
      <p className="eyebrow">Questions or feedback?</p>
      <p className="mb-2 mt-1 text-[15px]">Send a message to {firstName ? `${firstName} and your care team` : "your care team"}.</p>
      <MessageForm action={patientSendMessage} hidden={{}} placeholder="Ask a question or tell us how things are going" />
      <p className="mt-2 text-sm text-muted">{settings.responseExpectation}</p>
      <p className="mt-1 text-sm text-muted">{settings.urgentGuidance}</p>
    </Card>
  );
}
