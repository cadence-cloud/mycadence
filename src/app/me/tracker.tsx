"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearCompletion, logCompletion } from "@/app/actions/patient";
import type { PlanItem } from "@/lib/plan-types";
import { ExerciseCard } from "@/components/plan-view";

type Status = "completed" | "partial" | "skipped";
export interface TrackItem {
  assignmentId: string;
  item: PlanItem;
  mediaHref: string | null;
}

const LABELS: Record<Status, string> = { completed: "Completed", partial: "Partly", skipped: "Skipped" };

/**
 * Per-day tracking: each entry is (exercise assignment, date). Not a permanent checkbox.
 */
export function Tracker({ groups, entries, dates }: { groups: { title: string | null; items: TrackItem[] }[]; entries: Record<string, Record<string, { status: Status; comment: string | null }>>; dates: { value: string; label: string }[] }) {
  const [date, setDate] = useState(dates[0].value);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="track-date" className="text-sm font-semibold">Logging for</label>
        <select id="track-date" className="input w-auto" value={date} onChange={(e) => setDate(e.target.value)}>
          {dates.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-5">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.title && <p className="eyebrow mb-2">{g.title}</p>}
            <div className="space-y-2">
              {g.items.map((t) => (
                <ExerciseCard key={t.assignmentId} item={t.item} mediaHref={t.mediaHref} action={<TrackRow assignmentId={t.assignmentId} date={date} entry={entries[date]?.[t.assignmentId] ?? null} name={t.item.name} />} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrackRow({ assignmentId, date, entry, name }: { assignmentId: string; date: string; entry: { status: Status; comment: string | null } | null; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(entry?.comment ?? "");

  const submit = (status: Status, comment = note) =>
    start(async () => {
      setErr(null);
      const r = await logCompletion({ assignmentId, date, status, comment });
      if (r.error) setErr(r.error);
      else router.refresh();
    });

  return (
    <div className="mt-3 border-t border-sand-200 pt-3">
      <div role="group" aria-label={`How did ${name} go?`} className="grid grid-cols-3 gap-2">
        {(Object.keys(LABELS) as Status[]).map((s) => {
          const on = entry?.status === s;
          return (
            <button
              key={s}
              type="button"
              disabled={pending}
              aria-pressed={on}
              onClick={() => (on ? start(async () => { await clearCompletion({ assignmentId, date }); router.refresh(); }) : submit(s))}
              className={`min-h-11 whitespace-nowrap rounded-xl border px-1 text-[13px] font-semibold transition-colors ${on ? (s === "completed" ? "border-pine-800 bg-pine-900 text-white" : s === "partial" ? "border-amber-500 bg-amber-100 text-amber-950" : "border-sand-300 bg-sand-200 text-ink") : "border-sand-300 bg-white text-ink hover:bg-sand-50"}`}
            >
              {on && "✓ "}
              {LABELS[s]}
            </button>
          );
        })}
      </div>
      {entry && !showNote && (
        <button type="button" className="mt-1 min-h-9 text-sm font-semibold text-pine-800" onClick={() => setShowNote(true)}>
          {entry.comment ? `Note: “${entry.comment}” · edit` : "+ Add a note"}
        </button>
      )}
      {showNote && entry && (
        <div className="mt-2 flex gap-2">
          <label htmlFor={`n-${assignmentId}`} className="sr-only">Note</label>
          <input id={`n-${assignmentId}`} className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for your PT" />
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => { submit(entry.status, note); setShowNote(false); }}>Save</button>
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-sm text-red-800">{err}</p>}
    </div>
  );
}
