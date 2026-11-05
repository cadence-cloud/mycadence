/** Shared (client + server) types for plan content. */

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

/**
 * Dosage fields are all optional — only what the PT actually specified is set.
 * Nothing is defaulted or inferred.
 */
export interface Dosage {
  sets?: number | null;
  reps?: number | null;
  repsUnit?: "reps" | "steps" | null;
  durationSec?: number | null;
  holdSec?: number | null;
  resistance?: string | null;
  restSec?: number | null;
  perSide?: boolean | null;
  /** Free-text dosage when it does not fit structured fields, kept verbatim. */
  note?: string | null;
}

export interface PlanItem {
  key: string; // stable id for this exercise within a patient's plan lineage
  exerciseId?: string | null;
  name: string;
  description?: string | null;
  circuit?: string | null;
  dosage: Dosage;
  /** Free-text frequency exactly as the PT wrote it, e.g. "daily", "3x/week". */
  frequency?: string | null;
  /** Structured schedule. Only when set does the patient see "Today's plan". */
  scheduleDays?: Weekday[] | null;
  cues?: string | null;
  patientMediaId?: string | null;
  isNew?: boolean;
}

export interface PlanLink {
  label: string;
  url: string;
}

export interface PlanContent {
  recap: string;
  items: PlanItem[];
  runningGuidance: string;
  nextMilestone: string;
  reassessNext: string;
  links: PlanLink[];
}

export const EMPTY_PLAN: PlanContent = {
  recap: "",
  items: [],
  runningGuidance: "",
  nextMilestone: "",
  reassessNext: "",
  links: [],
};

export type FlagSeverity = "needs_input" | "check";
export interface ReviewFlag {
  id: string;
  severity: FlagSeverity;
  field: "recap" | "items" | "running" | "milestone" | "links" | "item";
  itemKey?: string;
  message: string;
  /** Verbatim source text the flag refers to, for side-by-side comparison. */
  source?: string;
}

export interface PlanChangeSummary {
  added: string[];
  removed: string[];
  changed: { name: string; fields: string[] }[];
  runningChanged: boolean;
}
