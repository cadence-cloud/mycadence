"use client";
import { useActionState, useState } from "react";
import { submitCheckIn } from "@/app/actions/patient";

const ACTIVITIES = ["Run", "Long run", "Trail run", "Workout / intervals", "Bike", "Swim", "Elliptical", "Strength", "Other"];
const FEELS = ["Felt good", "Some discomfort", "Painful", "Had to stop"];
const AFTER = ["Nothing notable", "Mild ache", "Soreness that lingered", "Pain that worries me"];

export function CheckInForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(submitCheckIn, {});
  const [feel, setFeel] = useState("");
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ci-type">Activity</label>
          <select id="ci-type" name="activityType" className="input" defaultValue="Run">
            {ACTIVITIES.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ci-date">Date</label>
          <input id="ci-date" name="activityDate" type="date" className="input" defaultValue={today} max={today} required />
        </div>
        <div>
          <label className="label" htmlFor="ci-dur">Duration (min)</label>
          <input id="ci-dur" name="durationMin" inputMode="numeric" pattern="[0-9]*" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="ci-dist">Distance <span className="font-normal text-muted">(optional)</span></label>
          <div className="flex">
            <input id="ci-dist" name="distance" inputMode="decimal" className="input rounded-r-none" />
            <select aria-label="Distance unit" name="distanceUnit" className="rounded-r-xl border border-l-0 border-sand-300 bg-sand-50 px-2">
              <option value="mi">mi</option>
              <option value="km">km</option>
            </select>
          </div>
        </div>
      </div>
      <fieldset>
        <legend className="label">How did it feel during?</legend>
        <div className="grid grid-cols-2 gap-2">
          {FEELS.map((f) => (
            <label key={f} className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-sand-300 px-2 text-center text-sm font-semibold has-[:checked]:border-pine-800 has-[:checked]:bg-pine-900 has-[:checked]:text-white">
              <input type="radio" name="duringFeel" value={f} className="sr-only" required onChange={() => setFeel(f)} />
              {f}
            </label>
          ))}
        </div>
      </fieldset>
      {feel && feel !== "Felt good" && (
        <div>
          <label className="label" htmlFor="ci-dn">Where and when? <span className="font-normal text-muted">(optional)</span></label>
          <input id="ci-dn" name="duringNote" className="input" placeholder="e.g. Arch ache around minute 12" />
        </div>
      )}
      <fieldset>
        <legend className="label">Afterward <span className="font-normal text-muted">(optional)</span></legend>
        <div className="grid grid-cols-2 gap-2">
          {AFTER.map((f) => (
            <label key={f} className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-sand-300 px-2 text-center text-sm font-semibold has-[:checked]:border-pine-800 has-[:checked]:bg-pine-900 has-[:checked]:text-white">
              <input type="radio" name="afterSymptoms" value={f} className="sr-only" />
              {f}
            </label>
          ))}
        </div>
        <p className="hint">You can add how you feel tomorrow morning later. No need to guess now.</p>
      </fieldset>
      <div>
        <label className="label" htmlFor="ci-q">Question or comment for your PT <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="ci-q" name="question" className="input min-h-20" maxLength={2000} />
      </div>
      {state?.error && <p role="alert" className="text-sm font-medium text-red-800">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Save check-in"}</button>
      <p className="text-xs text-muted">If something feels seriously wrong, don’t wait for a reply. Contact your physician, urgent care, or call 911 in an emergency.</p>
    </form>
  );
}
