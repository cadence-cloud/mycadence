import { notFound } from "next/navigation";
import { isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { planTemplates } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { canAccessPatient } from "@/server/authz";
import { careTeam, getPatient, getVersions, getVisits } from "@/server/patient-data";
import { startVisitUpdate } from "@/app/actions/pt";
import { BackLink, Card, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { formatDate, localDate } from "@/lib/time";

export default async function NewUpdatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ visitId?: string; error?: string }> }) {
  const { id } = await params;
  const { visitId: preselect, error } = await searchParams;
  const user = await requirePageUser(["pt"]);
  const db = await getDb();
  if (!(await canAccessPatient(db, user, id))) notFound();
  const [patient, visits, versions, team, templates] = await Promise.all([getPatient(db, id), getVisits(db, id), getVersions(db, id), careTeam(db, id), db.select().from(planTemplates).where(isNull(planTemplates.archivedAt))]);
  if (!patient) notFound();
  const visitIdsWithPlan = new Set(versions.map((v) => v.visitId));
  const openVisits = visits.filter((v) => !visitIdsWithPlan.has(v.id)).slice(0, 5);
  const today = localDate();
  const todayVisit = visits.find((v) => v.visitDate === today);
  const defaultVisit = preselect ?? todayVisit?.id ?? openVisits[0]?.id ?? "new";
  const current = versions[0];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <BackLink href={`/pt/patients/${id}`}>{patient.firstName} {patient.lastName}</BackLink>
      <h1 className="text-2xl font-semibold">Create visit update</h1>
      {error === "date" && <Notice tone="error">Choose a visit date.</Notice>}
      {error === "future" && <Notice tone="error">Visit updates are for visits that have happened. Choose today or an earlier date.</Notice>}
      <form action={startVisitUpdate} className="space-y-5">
        <input type="hidden" name="patientId" value={id} />
        <Card>
          <fieldset>
            <legend className="text-lg font-semibold">1. Which visit?</legend>
            <p className="hint mb-3">Updating an existing visit never creates another appointment.</p>
            <div className="space-y-2">
              {openVisits.map((v) => (
                <label key={v.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-sand-300 px-3 has-[:checked]:border-pine-700 has-[:checked]:bg-pine-50">
                  <input type="radio" name="visitId" value={v.id} defaultChecked={defaultVisit === v.id} className="size-5 accent-pine-800" />
                  <span>
                    <span className="font-semibold">{formatDate(v.visitDate, { weekday: "short", month: "short", day: "numeric" })}</span>
                    <span className="text-muted"> · {v.ptName} · no update yet</span>
                  </span>
                </label>
              ))}
              <label className="flex min-h-12 cursor-pointer flex-wrap items-center gap-3 rounded-xl border border-sand-300 px-3 py-2 has-[:checked]:border-pine-700 has-[:checked]:bg-pine-50">
                <input type="radio" name="visitId" value="new" defaultChecked={defaultVisit === "new"} className="size-5 accent-pine-800" />
                <span className="font-semibold">Visit on</span>
                <input type="date" name="visitDate" defaultValue={today} max={today} aria-label="Visit date" className="input w-auto" />
                <select name="treatingPtId" defaultValue={user.id} aria-label="Treating PT" className="input w-auto">
                  {team.map((t) => (
                    <option key={t.userId} value={t.userId}>{t.name}</option>
                  ))}
                </select>
              </label>
              <p className="hint">If a visit already exists on that date, the update is attached to it.</p>
            </div>
          </fieldset>
        </Card>
        <Card>
          <fieldset>
            <legend className="text-lg font-semibold">2. Start from</legend>
            <div className="mt-3 space-y-2">
              <StartOption value="current_plan" checked={!!current} disabled={!current} title="Current plan" body={current ? `Version ${current.versionNumber} · ${current.content.items.length} exercises. Keep, change, add, or remove.` : "No published plan yet."} />
              <StartOption value="paste" checked={!current} title="Paste existing instructions" body="Paste an email you've written. We'll turn it into an editable draft and flag anything missing." />
              <StartOption value="blank" title="Blank plan" body="Start with nothing." />
              {templates.length > 0 && (
                <div className="rounded-xl border border-sand-300 px-3 py-2 has-[:checked]:border-pine-700 has-[:checked]:bg-pine-50">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input type="radio" name="start" value="template" className="size-5 accent-pine-800" />
                    <span className="font-semibold">Template</span>
                  </label>
                  <select name="templateId" aria-label="Template" className="input mt-1">
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.content.items.length} exercises)</option>
                    ))}
                  </select>
                  <p className="hint">The template is copied. Later template changes won&apos;t affect this plan.</p>
                </div>
              )}
            </div>
          </fieldset>
        </Card>
        <SubmitButton pendingText="Opening draft…" className="btn-primary w-full">Start draft</SubmitButton>
      </form>
    </div>
  );
}

function StartOption({ value, title, body, checked, disabled }: { value: string; title: string; body: string; checked?: boolean; disabled?: boolean }) {
  return (
    <label className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-sand-300 px-3 py-2.5 has-[:checked]:border-pine-700 has-[:checked]:bg-pine-50 ${disabled ? "opacity-50" : ""}`}>
      <input type="radio" name="start" value={value} defaultChecked={checked} disabled={disabled} className="mt-0.5 size-5 accent-pine-800" />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
    </label>
  );
}
