/** Pure plan helpers shared by client and server. */
import type { Dosage, PlanChangeSummary, PlanContent, PlanItem, ReviewFlag } from "./plan-types";

export function formatSeconds(s: number): string {
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  if (s > 60) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${s} s`;
}

/** Human-readable dosage built ONLY from fields the PT specified. */
export function formatDosage(d: Dosage): string | null {
  const parts: string[] = [];
  const reps = d.reps != null ? `${d.reps}${d.repsUnit === "steps" ? " steps" : ""}` : null;
  const per = d.perSide ? " each side" : "";
  if (d.sets != null && reps) parts.push(`${d.sets} × ${reps}${per}`);
  else if (d.sets != null && d.holdSec != null) parts.push(`${d.sets} × ${formatSeconds(d.holdSec)} hold${per}`);
  else if (d.sets != null && d.durationSec != null) parts.push(`${d.sets} × ${formatSeconds(d.durationSec)}${per}`);
  else {
    if (d.sets != null) parts.push(`${d.sets} sets`);
    if (reps) parts.push(`${reps}${per}`);
    if (d.holdSec != null) parts.push(`${formatSeconds(d.holdSec)} hold`);
    if (d.durationSec != null) parts.push(formatSeconds(d.durationSec));
  }
  if (d.resistance) parts.push(d.resistance);
  if (d.restSec != null) parts.push(`rest ${formatSeconds(d.restSec)}`);
  if (d.note) parts.push(d.note);
  return parts.length ? parts.join(" · ") : null;
}

export function hasDosage(d: Dosage): boolean {
  return d.sets != null || d.reps != null || d.durationSec != null || d.holdSec != null || !!d.note;
}

/**
 * Deterministic review checks run on every draft regardless of how it was created.
 * They flag — they never fill anything in.
 */
export function reviewChecks(c: PlanContent): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const noFreq = c.items.filter((i) => !i.frequency?.trim() && !(i.scheduleDays && i.scheduleDays.length));
  if (noFreq.length) {
    flags.push({
      id: "freq-missing",
      severity: "needs_input",
      field: "items",
      message: `Frequency not specified for ${noFreq.length === c.items.length ? "any exercise" : noFreq.map((i) => i.name).join(", ")}. Patients will see “Frequency: ask your PT” until you add one.`,
    });
  }
  for (const i of c.items) {
    if (!hasDosage(i.dosage)) {
      flags.push({ id: `dosage-${i.key}`, severity: "needs_input", field: "item", itemKey: i.key, message: `“${i.name}” has no dosage. Patients will see “Dosage: ask your PT”.` });
    }
    if (!i.name.trim()) flags.push({ id: `name-${i.key}`, severity: "needs_input", field: "item", itemKey: i.key, message: "An exercise is missing a name." });
  }
  if (!c.recap.trim()) flags.push({ id: "recap-missing", severity: "check", field: "recap", message: "No visit recap yet." });
  if (!c.nextMilestone.trim()) flags.push({ id: "milestone-missing", severity: "check", field: "milestone", message: "No next milestone yet." });
  for (const l of c.links) {
    if (!/^https:\/\//i.test(l.url)) flags.push({ id: `link-${l.url}`, severity: "needs_input", field: "links", message: `Link “${l.label || l.url}” must start with https://` });
  }
  return flags;
}

const DOSAGE_FIELDS = ["sets", "reps", "repsUnit", "durationSec", "holdSec", "restSec", "resistance", "perSide", "note"] as const;

/** Canonical comparison key: field order and null/undefined/empty don't count as changes. */
function dosageKey(i: PlanItem) {
  const d = DOSAGE_FIELDS.map((k) => {
    const v = i.dosage[k];
    return v === undefined || v === "" || v === false ? null : v;
  });
  return JSON.stringify({ d, f: i.frequency?.trim() || null, s: i.scheduleDays?.length ? i.scheduleDays : null });
}

/** What changed from the previous published plan — shown to the patient as “What changed”. */
export function diffPlans(prev: PlanContent | null, next: PlanContent): PlanChangeSummary {
  const prevItems = new Map((prev?.items ?? []).map((i) => [i.key, i]));
  const nextKeys = new Set(next.items.map((i) => i.key));
  const added: string[] = [];
  const changed: { name: string; fields: string[] }[] = [];
  for (const i of next.items) {
    const p = prevItems.get(i.key);
    if (!p) {
      added.push(i.name);
      continue;
    }
    const fields: string[] = [];
    if (dosageKey(p) !== dosageKey(i)) fields.push("dosage or frequency");
    if ((p.cues ?? "") !== (i.cues ?? "")) fields.push("technique cues");
    if (p.name !== i.name) fields.push("name");
    if (fields.length) changed.push({ name: i.name, fields });
  }
  const removed = (prev?.items ?? []).filter((i) => !nextKeys.has(i.key)).map((i) => i.name);
  return { added, removed, changed, runningChanged: (prev?.runningGuidance ?? "").trim() !== next.runningGuidance.trim() };
}

/** Strip patient-specific material before saving a draft as a shared template. */
export function toTemplateContent(c: PlanContent, opts: { keepCues: boolean }): PlanContent {
  return {
    recap: "",
    runningGuidance: "",
    nextMilestone: "",
    reassessNext: "",
    links: [],
    items: c.items.map((i) => ({ ...i, patientMediaId: null, isNew: false, cues: opts.keepCues ? i.cues : null })),
  };
}

/** Deep copy so later template edits can never reach into a patient plan. */
export function clonePlan(c: PlanContent): PlanContent {
  return JSON.parse(JSON.stringify(c));
}
