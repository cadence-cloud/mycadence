import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requirePageUser } from "@/server/session";
import { canAccessPatient } from "@/server/authz";
import {
  careTeam,
  getCheckIns,
  getCompletions,
  getGoals,
  getMeasures,
  getMedia,
  getMilestones,
  getOpenDrafts,
  getPatient,
  getVersions,
  getVisits,
} from "@/server/patient-data";
import { listMessages, markRead, threadFor } from "@/server/messaging";
import { getSettings } from "@/server/settings";
import { addMeasureEntry, markMilestone, markNoShow, ptSendMessage, reviewCheckIn, startCorrection, toggleMeasure } from "@/app/actions/pt";
import { materializeVisits } from "@/server/scheduling";
import { appointments } from "@/db/schema";
import { and as andOp, asc, eq as eqOp, gt } from "drizzle-orm";
import { Avatar, Badge, Card, EmptyState, Notice, SectionHeader, SourceTag } from "@/components/ui";
import { ChangeSummary, PlanFull } from "@/components/plan-view";
import { MediaTile } from "@/components/media-tile";
import { MediaUploader } from "@/components/media-uploader";
import { MessageThread } from "@/components/message-thread";
import { ActionForm, MessageForm, SubmitButton } from "@/components/forms";
import { addDays, formatDate, formatDateTime, formatTime, localDate } from "@/lib/time";
import { MeasureChart } from "@/components/measure-chart";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "visits", label: "Visits" },
  { key: "checkins", label: "Check-ins & tracking" },
  { key: "progress", label: "Progress" },
  { key: "media", label: "Photos, videos & docs" },
  { key: "messages", label: "Messages" },
  { key: "history", label: "Plan history" },
] as const;

export default async function PatientWorkspace({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; published?: string }> }) {
  const { id } = await params;
  const { tab = "overview", published } = await searchParams;
  const user = await requirePageUser(["pt"]);
  const db = await getDb();
  // Not assigned => 404 (don't reveal the patient exists).
  if (!(await canAccessPatient(db, user, id))) notFound();
  const patient = await getPatient(db, id);
  if (!patient) notFound();
  await materializeVisits(db);
  const upcomingAppts = await db.select().from(appointments).where(andOp(eqOp(appointments.patientId, id), eqOp(appointments.status, "scheduled"), gt(appointments.startsAt, new Date()))).orderBy(asc(appointments.startsAt)).limit(3);

  const [team, versions, drafts, goals, milestones] = await Promise.all([careTeam(db, id), getVersions(db, id), getOpenDrafts(db, id), getGoals(db, id), getMilestones(db, id)]);
  const current = versions[0] ?? null;
  const name = `${patient.firstName} ${patient.lastName}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={name} size={48} />
          <div>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <p className="text-muted">{patient.sport}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/pt/library?patient=${id}`} className="btn-secondary">Add from library</Link>
          {drafts[0] ? (
            <Link href={`/pt/patients/${id}/update/${drafts[0].id}`} className="btn-primary">Continue draft update</Link>
          ) : (
            <Link href={`/pt/patients/${id}/update/new`} className="btn-primary">Create visit update</Link>
          )}
        </div>
      </div>

      {published && <Notice tone="success" title={`Version ${published} published`}>{patient.firstName} can see it now. A generic notification was recorded{" "}(simulated in the demo).</Notice>}

      <nav aria-label="Patient sections" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-sand-200">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`/pt/patients/${id}?tab=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={`flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold ${tab === t.key ? "border-pine-800 text-pine-900" : "border-transparent text-muted hover:text-ink"}`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Card>
            <SectionHeader
              eyebrow={current ? `Version ${current.versionNumber} · published ${formatDateTime(current.publishedAt)} by ${current.publishedByName}` : undefined}
              title="Current published plan"
            />
            {current ? <PlanFull content={current.content} /> : <EmptyState title="No published plan yet" body="Create a visit update to publish the first plan." action={<Link className="btn-primary" href={`/pt/patients/${id}/update/new`}>Create visit update</Link>} />}
          </Card>
          <div className="space-y-5">
            {drafts.length > 0 && (
              <Card>
                <SectionHeader title="Drafts in progress" />
                <ul className="space-y-2">
                  {drafts.map((d) => (
                    <li key={d.id}>
                      <Link href={`/pt/patients/${id}/update/${d.id}`} className="flex min-h-11 items-center justify-between rounded-xl bg-sand-50 px-3 hover:bg-sand-100">
                        <span className="font-semibold">{d.kind === "correction" ? "Correction" : `Visit ${formatDate(d.visitDate)}`}</span>
                        <span className="text-xs text-muted">Saved {formatDateTime(d.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card>
              <SectionHeader title="Upcoming appointments" eyebrow="From Calendly" />
              {upcomingAppts.length === 0 ? (
                <p className="text-sm text-muted">Nothing booked.</p>
              ) : (
                <ul className="space-y-1.5 text-[15px]">
                  {upcomingAppts.map((a) => (
                    <li key={a.id} className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">{formatDate(localDate(a.startsAt), { weekday: "short", month: "short", day: "numeric" })} · {formatTime(a.startsAt)}</span>
                      <span className="text-muted">{a.eventName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <SectionHeader title="Care team" />
              <ul className="space-y-2">
                {team.map((t) => (
                  <li key={t.userId} className="flex items-center gap-2">
                    <Avatar name={t.name} size={32} />
                    <span className="flex-1">{t.name}</span>
                    <Badge tone={t.role === "primary" ? "green" : "neutral"}>{t.role === "primary" ? "Primary" : "Covering"}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <SectionHeader title="Running goals" eyebrow="In the patient's words" />
              {goals.length === 0 ? (
                <p className="text-sm text-muted">{patient.firstName} hasn&apos;t added goals yet.</p>
              ) : (
                <ul className="space-y-2">
                  {goals.map((g) => (
                    <li key={g.id} className="rounded-xl bg-sand-50 px-3 py-2">
                      <p className="text-[15px]">“{g.text}”</p>
                      {(g.targetEvent || g.targetDate) && <p className="text-sm text-muted">{[g.targetEvent, g.targetDate && formatDate(g.targetDate)].filter(Boolean).join(" · ")}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <SectionHeader title="Milestones" />
              {milestones.length === 0 ? (
                <p className="text-sm text-muted">Milestones are set when you publish an update.</p>
              ) : (
                <ul className="space-y-2">
                  {milestones.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-2">
                      <span className="text-[15px]">{m.title}</span>
                      {m.status === "achieved" ? (
                        <Badge tone="lime">Achieved {formatDate(m.achievedOn, { month: "short", day: "numeric" })}</Badge>
                      ) : (
                        <form action={markMilestone}>
                          <input type="hidden" name="patientId" value={id} />
                          <input type="hidden" name="milestoneId" value={m.id} />
                          <SubmitButton className="btn-secondary btn-sm" pendingText="…">Mark achieved</SubmitButton>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "visits" && <VisitsTab patientId={id} versions={versions} />}
      {tab === "history" && (
        <Card>
          <SectionHeader title="Published plan history" eyebrow="Every published version is kept" />
          {versions.length === 0 ? (
            <EmptyState title="Nothing published yet" />
          ) : (
            <ol className="space-y-3">
              {versions.map((v, idx) => {
                const correctedBy = versions.find((x) => x.correctionOfVersionId === v.id);
                return (
                  <li key={v.id}>
                    <details className="rounded-xl border border-sand-200 bg-white" open={idx === 0}>
                      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2">
                        <span className="font-semibold">Version {v.versionNumber}</span>
                        {idx === 0 && <Badge tone="green">Current</Badge>}
                        {v.correctionOfVersionId && <Badge tone="blue">Correction of v{versions.find((x) => x.id === v.correctionOfVersionId)?.versionNumber}</Badge>}
                        {correctedBy && <Badge tone="amber">Corrected in v{correctedBy.versionNumber}</Badge>}
                        <span className="text-sm text-muted">{formatDateTime(v.publishedAt)} · {v.publishedByName}</span>
                      </summary>
                      <div className="space-y-4 border-t border-sand-200 p-4">
                        {v.correctionNote && <Notice tone="info" title="Correction note">{v.correctionNote}</Notice>}
                        <div>
                          <p className="eyebrow mb-1">What changed</p>
                          <ChangeSummary s={v.changeSummary} />
                        </div>
                        <PlanFull content={v.content} />
                        {idx === 0 && (
                          <form action={startCorrection} className="border-t border-sand-200 pt-3">
                            <input type="hidden" name="patientId" value={id} />
                            <input type="hidden" name="versionId" value={v.id} />
                            <p className="mb-2 text-sm text-muted">Found a mistake? A correction publishes a new version with a note. This version stays in history.</p>
                            <SubmitButton className="btn-secondary" pendingText="Opening…">Correct this version</SubmitButton>
                          </form>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      )}
      {tab === "checkins" && <CheckInsTab patientId={id} firstName={patient.firstName} />}
      {tab === "progress" && <ProgressTab patientId={id} />}
      {tab === "media" && <MediaTab patientId={id} />}
      {tab === "messages" && <MessagesTab patientId={id} viewerId={user.id} team={team} firstName={patient.firstName} />}
    </div>
  );
}

async function VisitsTab({ patientId, versions }: { patientId: string; versions: Awaited<ReturnType<typeof getVersions>> }) {
  const db = await getDb();
  const [visits, mediaRows] = await Promise.all([getVisits(db, patientId), getMedia(db, patientId, "staff")]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{visits.length} visit{visits.length === 1 ? "" : "s"}. Booked appointments become visits automatically once their start time passes. Clinical notes stay in WebPT.</p>
        <Link href={`/pt/patients/${patientId}/update/new`} className="btn-secondary">New visit update</Link>
      </div>
      {visits.length === 0 && <EmptyState title="No visits yet" />}
      {visits.map((v) => {
        const vv = versions.filter((x) => x.visitId === v.id);
        const vm = mediaRows.filter((m) => m.visitId === v.id);
        return (
          <Card key={v.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold">{formatDate(v.visitDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h3>
                <p className="text-sm text-muted">Treating PT: {v.ptName}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {v.source === "booking" && <Badge tone="blue">From booking</Badge>}
                {vv.length === 0 ? <Badge tone="neutral">No plan published</Badge> : vv.map((x) => <Badge key={x.id} tone="green">Plan v{x.versionNumber}</Badge>)}
              </div>
            </div>
            {vv[vv.length - 1]?.content.recap && <p className="mt-3 text-[15px]">{vv[vv.length - 1].content.recap}</p>}
            {vm.length > 0 && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {vm.map((m) => <MediaTile key={m.id} m={m} />)}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {vv.length === 0 && (
                <form action={`/pt/patients/${patientId}/update/new`} method="get">
                  <input type="hidden" name="visitId" value={v.id} />
                  <button className="btn-secondary btn-sm">Write update for this visit</button>
                </form>
              )}
              {vv.length === 0 && vm.length === 0 && v.source === "booking" && v.appointmentId && (
                <ActionForm action={markNoShow} className="flex flex-wrap items-center gap-2" okText="Marked as didn't happen.">
                  <input type="hidden" name="patientId" value={patientId} />
                  <input type="hidden" name="appointmentId" value={v.appointmentId} />
                  <SubmitButton className="btn-ghost btn-sm" pendingText="…">Didn&apos;t happen (no-show / late cancel)</SubmitButton>
                </ActionForm>
              )}
            </div>
            <details className="mt-3">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-pine-800">+ Add photo, video, or invoice to this visit</summary>
              <div className="mt-2 rounded-xl bg-sand-50 p-3">
                <MediaUploader patientId={patientId} visitId={v.id} exercises={(vv[0]?.content.items ?? versions[0]?.content.items ?? []).map((i) => ({ key: i.key, name: i.name }))} />
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}

async function CheckInsTab({ patientId, firstName }: { patientId: string; firstName: string }) {
  const db = await getDb();
  const since = addDays(localDate(), -13);
  const [cis, comps] = await Promise.all([getCheckIns(db, patientId), getCompletions(db, patientId, since)]);
  const byDate = new Map<string, typeof comps>();
  for (const c of comps) byDate.set(c.e.sessionDate, [...(byDate.get(c.e.sessionDate) ?? []), c]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <SectionHeader title="Running check-ins" eyebrow="Patient-reported" />
        <p className="mb-3 text-sm text-muted">Check-ins never change the plan automatically. Review them and respond in Messages or your next update.</p>
        {cis.length === 0 ? (
          <EmptyState title="No check-ins yet" />
        ) : (
          <ul className="space-y-3">
            {cis.map(({ c, versionNumber, reviewedByName }) => (
              <li key={c.id} className={`rounded-xl border p-3 ${c.reviewStatus === "unreviewed" ? "border-amber-300 bg-amber-50/40" : "border-sand-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{c.activityType} · {formatDate(c.activityDate, { weekday: "short", month: "short", day: "numeric" })}</p>
                  {versionNumber && <Badge tone="neutral">During plan v{versionNumber}</Badge>}
                </div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[15px]">
                  <dt className="text-muted">Duration</dt><dd>{c.durationMin} min{c.distance ? ` · ${Number(c.distance)} ${c.distanceUnit}` : ""}</dd>
                  <dt className="text-muted">During</dt><dd>{c.duringFeel}{c.duringNote ? ` — ${c.duringNote}` : ""}</dd>
                  <dt className="text-muted">After</dt><dd>{c.afterSymptoms || <span className="text-muted">—</span>}</dd>
                  <dt className="text-muted">Next morning</dt><dd>{c.nextMorning || <span className="italic text-muted">Not added yet</span>}</dd>
                </dl>
                {c.question && <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-[15px]"><span className="font-semibold">Question: </span>{c.question}</p>}
                <form action={reviewCheckIn} className="mt-2 flex items-center justify-between gap-2">
                  <input type="hidden" name="patientId" value={patientId} />
                  <input type="hidden" name="checkInId" value={c.id} />
                  <input type="hidden" name="reviewed" value={c.reviewStatus === "reviewed" ? "0" : "1"} />
                  <span className="text-sm text-muted">{c.reviewStatus === "reviewed" ? `Reviewed by ${reviewedByName} ${formatDateTime(c.reviewedAt)}` : "Not reviewed"}</span>
                  <SubmitButton className={c.reviewStatus === "reviewed" ? "btn-ghost btn-sm" : "btn-primary btn-sm"} pendingText="…">{c.reviewStatus === "reviewed" ? "Mark unreviewed" : "Mark reviewed"}</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <SectionHeader title="Exercise tracking" eyebrow="Last 14 days" />
        {byDate.size === 0 ? (
          <EmptyState title={`${firstName} hasn't logged exercises in the last two weeks`} body="Entries appear here when the patient marks exercises completed, partly completed, or skipped." />
        ) : (
          <ul className="space-y-3">
            {[...byDate.entries()].map(([date, rows]) => (
              <li key={date}>
                <p className="text-sm font-semibold">{formatDate(date, { weekday: "short", month: "short", day: "numeric" })} <span className="font-normal text-muted">· plan v{rows[0].versionNumber}</span></p>
                <ul className="mt-1 space-y-1">
                  {rows.map((r) => (
                    <li key={r.e.id} className="flex flex-wrap items-center gap-2 text-[15px]">
                      <StatusBadge s={r.e.status} />
                      <span>{r.name}</span>
                      {r.e.comment && <span className="text-sm text-muted">“{r.e.comment}”</span>}
                      {r.e.history.length > 0 && <span className="text-xs text-muted">(edited)</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  return s === "completed" ? <Badge tone="green">Completed</Badge> : s === "partial" ? <Badge tone="amber">Partly</Badge> : <Badge tone="neutral">Skipped</Badge>;
}

async function ProgressTab({ patientId }: { patientId: string }) {
  const db = await getDb();
  const { selected, entries, allDefs } = await getMeasures(db, patientId);
  const ptDefs = selected.filter((d) => d.source === "pt");
  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-4">
        {selected.length === 0 && <EmptyState title="No measures selected" body="Choose a few measures that matter for this runner." />}
        {selected.map((d) => {
          const rows = entries.filter((e) => e.e.definitionId === d.id);
          return (
            <Card key={d.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{d.name} <span className="font-normal text-muted">({d.unit})</span></h3>
                  <p className="text-sm text-muted">{d.definition}</p>
                </div>
                <SourceTag source={d.source} />
              </div>
              {rows.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No entries yet.</p>
              ) : (
                <>
                  <MeasureChart points={rows.map((r) => ({ date: r.e.recordedOn, value: Number(r.e.value) }))} unit={d.unit} label={d.name} />
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="text-muted"><tr><th className="py-1 font-medium">Date</th><th className="font-medium">Value</th><th className="font-medium">Source</th><th className="font-medium">Note</th></tr></thead>
                    <tbody>
                      {[...rows].reverse().map((r) => (
                        <tr key={r.e.id} className="border-t border-sand-200">
                          <td className="py-1.5">{formatDate(r.e.recordedOn, { month: "short", day: "numeric" })}</td>
                          <td className="font-semibold">{Number(r.e.value)} {d.unit}</td>
                          <td>{r.e.source === "pt" ? r.enteredByName : "Patient"}</td>
                          <td className="text-muted">{r.e.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          );
        })}
      </div>
      <div className="space-y-5">
        <Card>
          <SectionHeader title="Record a measure" />
          {ptDefs.length === 0 ? (
            <p className="text-sm text-muted">Select a PT-entered measure below first.</p>
          ) : (
            <ActionForm action={addMeasureEntry}>
              <input type="hidden" name="patientId" value={patientId} />
              <div>
                <label className="label" htmlFor="m-def">Measure</label>
                <select id="m-def" name="definitionId" className="input">
                  {ptDefs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.unit})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="m-val">Value</label>
                  <input id="m-val" name="value" inputMode="decimal" required className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="m-date">Date</label>
                  <input id="m-date" name="recordedOn" type="date" defaultValue={localDate()} max={localDate()} required className="input" />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="m-note">Note (optional)</label>
                <input id="m-note" name="note" className="input" maxLength={300} />
              </div>
              <SubmitButton>Save measure</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card>
          <SectionHeader title="Measures for this patient" />
          <p className="mb-2 text-sm text-muted">Keep it to a few. Definitions are shared across patients so values stay comparable.</p>
          <ul className="space-y-1">
            {allDefs.map((d) => {
              const on = selected.some((s) => s.id === d.id);
              return (
                <li key={d.id}>
                  <form action={toggleMeasure} className="flex min-h-11 items-center justify-between gap-2">
                    <input type="hidden" name="patientId" value={patientId} />
                    <input type="hidden" name="definitionId" value={d.id} />
                    <input type="hidden" name="on" value={on ? "0" : "1"} />
                    <span className="text-[15px]">{d.name} <SourceTag source={d.source} /></span>
                    <SubmitButton className={on ? "btn-ghost btn-sm" : "btn-secondary btn-sm"} pendingText="…">{on ? "Remove" : "Add"}</SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

async function MediaTab({ patientId }: { patientId: string }) {
  const db = await getDb();
  const [rows, versions] = await Promise.all([getMedia(db, patientId, "staff"), getVersions(db, patientId)]);
  const footage = rows.filter((r) => r.category === "patient_footage");
  const docs = rows.filter((r) => r.category === "document" || r.category === "invoice");
  const byExercise = new Map<string, typeof footage>();
  for (const f of footage) if (f.exerciseName) byExercise.set(f.exerciseName, [...(byExercise.get(f.exerciseName) ?? []), f]);
  const comparisons = [...byExercise.entries()].filter(([, l]) => l.length >= 2);
  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-5">
        {comparisons.map(([ex, list]) => {
          const sorted = [...list].sort((a, b) => (a.capturedOn ?? a.visitDate ?? "").localeCompare(b.capturedOn ?? b.visitDate ?? ""));
          return (
            <Card key={ex}>
              <SectionHeader title={`Compare: ${ex}`} eyebrow="Dated side by side" />
              <div className="grid grid-cols-2 gap-3">
                <MediaTile m={sorted[0]} />
                <MediaTile m={sorted[sorted.length - 1]} />
              </div>
            </Card>
          );
        })}
        <Card>
          <SectionHeader title="Patient photos & videos" />
          {footage.length === 0 ? <EmptyState title="No photos or videos yet" /> : <div className="grid gap-3 sm:grid-cols-2">{footage.map((m) => <MediaTile key={m.id} m={m} />)}</div>}
        </Card>
        <Card>
          <SectionHeader title="Documents & invoices" />
          {docs.length === 0 ? <EmptyState title="No documents yet" /> : <div className="grid gap-3 sm:grid-cols-2">{docs.map((m) => <MediaTile key={m.id} m={m} />)}</div>}
        </Card>
      </div>
      <Card>
        <SectionHeader title="Upload" />
        <p className="mb-3 text-sm text-muted">Files are private to this patient and their care team. To attach to a specific visit, use the Visits tab.</p>
        <MediaUploader patientId={patientId} exercises={(versions[0]?.content.items ?? []).map((i) => ({ key: i.key, name: i.name }))} compact />
      </Card>
    </div>
  );
}

async function MessagesTab({ patientId, viewerId, team, firstName }: { patientId: string; viewerId: string; team: Awaited<ReturnType<typeof careTeam>>; firstName: string }) {
  const db = await getDb();
  const thread = await threadFor(db, patientId);
  const msgs = await listMessages(db, thread.id);
  const settings = await getSettings(db);
  await markRead(db, thread.id, viewerId);
  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <Card>
        <SectionHeader title={`Conversation with ${firstName}`} />
        <MessageThread messages={msgs} viewerId={viewerId} />
        <div className="mt-4 border-t border-sand-200 pt-4">
          <MessageForm action={ptSendMessage} hidden={{ patientId }} placeholder={`Reply to ${firstName}`} />
          <p className="mt-2 text-xs text-muted">{firstName} gets a generic notification (“{"You have a new update from Cadence"}”) with no message content. In the demo this is simulated.</p>
        </div>
      </Card>
      <Card>
        <SectionHeader title="Who sees this thread" />
        <ul className="space-y-1 text-[15px]">
          <li>{firstName} (patient)</li>
          {team.map((t) => <li key={t.userId}>{t.name} · {t.role === "primary" ? "Primary PT" : "Covering"}</li>)}
        </ul>
        <p className="mt-3 text-sm text-muted">Patient-facing response expectation: {settings.responseExpectation}</p>
      </Card>
    </div>
  );
}
