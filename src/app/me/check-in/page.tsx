import { getDb } from "@/db";
import { requirePageUser } from "@/server/session";
import { patientIdForUser } from "@/server/authz";
import { getCheckIns } from "@/server/patient-data";
import { addNextMorning } from "@/app/actions/patient";
import { BackLink, Badge, Card, EmptyState, Notice } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { formatDate, localDate } from "@/lib/time";
import { CheckInForm } from "./form";

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const user = await requirePageUser(["patient"]);
  const db = await getDb();
  const pid = (await patientIdForUser(db, user.id))!;
  const list = await getCheckIns(db, pid);
  const today = localDate();
  const awaitingMorning = list.filter(({ c }) => !c.nextMorning && c.activityDate < today && c.activityDate >= addDaysSafe(today, -7));

  return (
    <div className="space-y-5">
      <BackLink href="/me">My plan</BackLink>
      <h1 className="text-2xl font-semibold">Run & workout check-in</h1>
      {saved && <Notice tone="success" title="Check-in saved">Your care team will review it. Your plan won’t change automatically. Come back tomorrow morning to add how you feel.</Notice>}

      {awaitingMorning.length > 0 && (
        <Card>
          <p className="eyebrow mb-2">How did you feel the next morning?</p>
          <div className="space-y-4">
            {awaitingMorning.map(({ c }) => (
              <ActionForm key={c.id} action={addNextMorning} okText="Added. Thanks!">
                <input type="hidden" name="checkInId" value={c.id} />
                <label htmlFor={`nm-${c.id}`} className="label">{c.activityType} on {formatDate(c.activityDate, { weekday: "long", month: "short", day: "numeric" })} · {c.durationMin} min</label>
                <textarea id={`nm-${c.id}`} name="nextMorning" className="input min-h-20" placeholder="e.g. A little stiff for the first few steps, then fine." required />
                <SubmitButton className="btn-secondary">Add next-morning update</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CheckInForm today={today} />
      </Card>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Your recent check-ins</h2>
        {list.length === 0 ? (
          <EmptyState title="No check-ins yet" />
        ) : (
          <ul className="space-y-2">
            {list.slice(0, 10).map(({ c }) => (
              <li key={c.id} className="card p-3 text-[15px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{c.activityType} · {formatDate(c.activityDate, { month: "short", day: "numeric" })}</span>
                  {c.reviewStatus === "reviewed" ? <Badge tone="green">Seen by your PT</Badge> : <Badge tone="neutral">Not yet reviewed</Badge>}
                </div>
                <p className="text-muted">{c.durationMin} min{c.distance ? ` · ${Number(c.distance)} ${c.distanceUnit}` : ""} · {c.duringFeel}</p>
                {c.nextMorning && <p className="mt-1">Next morning: {c.nextMorning}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function addDaysSafe(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
}
