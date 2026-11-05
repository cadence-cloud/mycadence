import { getDb } from "@/db";
import { requirePageUser } from "@/server/session";
import { patientIdForUser } from "@/server/authz";
import { getGoals, getMeasures, getMilestones } from "@/server/patient-data";
import { addGoal, addSelfReport, setGoalStatus } from "@/app/actions/patient";
import { Badge, Card, EmptyState, SourceTag } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { MeasureChart } from "@/components/measure-chart";
import { formatDate } from "@/lib/time";

export default async function MyProgress() {
  const user = await requirePageUser(["patient"]);
  const db = await getDb();
  const pid = (await patientIdForUser(db, user.id))!;
  const [{ selected, entries }, goals, milestones] = await Promise.all([getMeasures(db, pid), getGoals(db, pid), getMilestones(db, pid)]);
  const selfReport = selected.filter((d) => d.source === "patient");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">My progress</h1>

      <Card>
        <h2 className="text-lg font-semibold">My goals</h2>
        {goals.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Add a goal in your own words. Your PT will see it.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {goals.map((g) => (
              <li key={g.id} className="rounded-xl bg-sand-50 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[15px]">{g.text}</p>
                  {g.status === "achieved" ? <Badge tone="lime">Achieved</Badge> : g.status === "set_aside" ? <Badge tone="neutral">Set aside</Badge> : null}
                </div>
                {(g.targetEvent || g.targetDate) && <p className="text-sm text-muted">{[g.targetEvent, g.targetDate && formatDate(g.targetDate)].filter(Boolean).join(" · ")}</p>}
                {g.status === "active" && (
                  <form action={setGoalStatus} className="mt-1 flex gap-2">
                    <input type="hidden" name="goalId" value={g.id} />
                    <button name="status" value="achieved" className="btn-ghost btn-sm">Mark achieved</button>
                    <button name="status" value="set_aside" className="btn-ghost btn-sm">Set aside</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-pine-800">+ Add a goal</summary>
          <ActionForm action={addGoal} className="mt-2 space-y-3">
            <div>
              <label className="label" htmlFor="g-text">Your goal</label>
              <textarea id="g-text" name="text" className="input min-h-20" required maxLength={500} placeholder="e.g. Run my fall half marathon without knee pain" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="g-ev">Event (optional)</label>
                <input id="g-ev" name="targetEvent" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="g-d">Date (optional)</label>
                <input id="g-d" name="targetDate" type="date" className="input" />
              </div>
            </div>
            <SubmitButton>Add goal</SubmitButton>
          </ActionForm>
        </details>
      </Card>

      {milestones.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">Milestones</h2>
          <p className="text-sm text-muted">Set by your PT.</p>
          <ul className="mt-2 space-y-2">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2 text-[15px]">
                <span>{m.title}</span>
                {m.status === "achieved" ? <Badge tone="lime">Reached {formatDate(m.achievedOn, { month: "short", day: "numeric" })}</Badge> : <Badge tone="neutral">Working on it</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {selected.length === 0 && <EmptyState title="No measures yet" body="Your PT may choose a few measures to track with you." />}
      {selected.map((d) => {
        const rows = entries.filter((e) => e.e.definitionId === d.id);
        return (
          <Card key={d.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-lg font-semibold">{d.name}</h2>
              <SourceTag source={d.source} />
            </div>
            <p className="text-sm text-muted">{d.definition}</p>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No entries yet.</p>
            ) : (
              <>
                <MeasureChart points={rows.map((r) => ({ date: r.e.recordedOn, value: Number(r.e.value) }))} unit={d.unit} label={d.name} />
                <ul className="mt-2 divide-y divide-sand-200 text-[15px]">
                  {[...rows].reverse().map((r) => (
                    <li key={r.e.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span>{formatDate(r.e.recordedOn)}</span>
                      <span className="font-semibold">{Number(r.e.value)} {d.unit}</span>
                      <span className="text-sm text-muted">{r.e.source === "pt" ? "PT-entered" : "You reported"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {selfReport.some((s) => s.id === d.id) && (
              <ActionForm action={addSelfReport} className="mt-3 flex flex-wrap items-end gap-2" okText="Thanks — saved.">
                <input type="hidden" name="definitionId" value={d.id} />
                <div>
                  <label className="label" htmlFor={`sr-${d.id}`}>Today ({d.unit})</label>
                  <select id={`sr-${d.id}`} name="value" className="input w-28">
                    {Array.from({ length: Number(d.maxValue ?? 10) - Number(d.minValue ?? 0) + 1 }, (_, i) => i + Number(d.minValue ?? 0)).map((n) => <option key={n}>{n}</option>)}
                  </select>
                </div>
                <SubmitButton className="btn-secondary">Save</SubmitButton>
              </ActionForm>
            )}
          </Card>
        );
      })}
    </div>
  );
}
