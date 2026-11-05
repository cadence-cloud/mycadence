/**
 * Exercise libraries.
 *  - Shared library (owner_id null): every PT sees it. Archivable by its creator.
 *  - Your library (owner_id = PT): private to that PT.
 * Library items never carry patient media or patient-specific dosage.
 */
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { exercises, planDrafts, planVersions, visits } from "@/db/schema";
import type { PlanItem } from "@/lib/plan-types";
import { newId } from "@/lib/ids";
import { createDraft, saveDraft } from "./plans";
import { audit } from "./audit";

export const visibleTo = (userId: string) => and(isNull(exercises.archivedAt), or(isNull(exercises.ownerId), eq(exercises.ownerId, userId)));

export async function visibleExercises(db: Db, userId: string) {
  return db
    .select({ id: exercises.id, name: exercises.name, description: exercises.description, bodyRegion: exercises.bodyRegion, ownerId: exercises.ownerId, createdBy: exercises.createdBy, demoMediaId: exercises.demoMediaId, createdAt: exercises.createdAt })
    .from(exercises)
    .where(visibleTo(userId))
    .orderBy(exercises.name);
}

export function canManage(ex: { ownerId: string | null; createdBy: string | null }, userId: string) {
  return ex.ownerId === userId || (ex.ownerId === null && ex.createdBy === userId);
}

/**
 * Add library exercises to a patient's plan. Uses the patient's open visit-update
 * draft if there is one; otherwise starts a draft from the current plan, attached to
 * the most recent visit that has no update yet. Dosage is left blank for the PT to set.
 */
export async function addExercisesToPatient(db: Db, actorId: string, patientId: string, exerciseIds: string[]) {
  const picked = await db.select().from(exercises).where(and(inArray(exercises.id, exerciseIds), visibleTo(actorId)));
  if (!picked.length) throw new Error("Choose at least one exercise.");
  let [draft] = await db.select().from(planDrafts).where(and(eq(planDrafts.patientId, patientId), eq(planDrafts.status, "draft"), eq(planDrafts.kind, "visit_update"))).orderBy(desc(planDrafts.updatedAt)).limit(1);
  if (!draft) {
    const recent = await db.select({ id: visits.id }).from(visits).where(eq(visits.patientId, patientId)).orderBy(desc(visits.visitDate)).limit(5);
    const withPlan = new Set(
      recent.length ? (await db.select({ v: planVersions.visitId }).from(planVersions).where(inArray(planVersions.visitId, recent.map((r) => r.id)))).map((r) => r.v) : [],
    );
    const target = recent.find((r) => !withPlan.has(r.id));
    draft = await createDraft(db, actorId, patientId, target?.id ?? null, { kind: "current_plan" });
  }
  const have = new Set(draft.content.items.map((i) => i.exerciseId).filter(Boolean));
  const add: PlanItem[] = picked
    .filter((e) => !have.has(e.id))
    .map((e) => ({ key: newId(), exerciseId: e.id, name: e.name, description: e.description, dosage: {}, frequency: null, scheduleDays: null, cues: null, circuit: null, patientMediaId: null, isNew: true }));
  if (add.length) {
    const res = await saveDraft(db, actorId, draft.id, draft.revision, { ...draft.content, items: [...draft.content.items, ...add] });
    if (!res.ok) throw new Error("The draft changed at the same moment. Try again.");
  }
  await audit(db, { actorId, action: "library.add_to_patient", entityType: "plan_draft", entityId: draft.id, patientId, meta: { added: add.length } });
  return { draftId: draft.id, added: add.length, skipped: picked.length - add.length };
}

export async function copyExercise(db: Db, actorId: string, exerciseId: string, to: "mine" | "shared") {
  const [e] = await db.select().from(exercises).where(and(eq(exercises.id, exerciseId), visibleTo(actorId))).limit(1);
  if (!e) throw new Error("Exercise not found.");
  const id = newId();
  await db.insert(exercises).values({ id, name: e.name, description: e.description, bodyRegion: e.bodyRegion, demoMediaId: e.demoMediaId, isCustom: true, ownerId: to === "mine" ? actorId : null, createdBy: actorId });
  await audit(db, { actorId, action: to === "mine" ? "exercise.copy_to_mine" : "exercise.share", entityType: "exercise", entityId: id });
  return id;
}
