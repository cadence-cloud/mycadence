"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { checkIns, measureDefinitions, measureEntries, milestones, patientMeasures, planDrafts, visits } from "@/db/schema";
import { requireApiUser } from "@/server/session";
import { assertPatientAccess, AuthzError, careTeam } from "@/server/authz";
import { createCorrectionDraft, createDraft, discardDraft, ensureVisit } from "@/server/plans";
import { sendMessage } from "@/server/messaging";
import { audit } from "@/server/audit";
import { newId } from "@/lib/ids";
import { localDate } from "@/lib/time";

async function ptFor(patientId: string) {
  const user = await requireApiUser(["pt"]);
  if (!user) throw new AuthzError();
  const db = await getDb();
  await assertPatientAccess(db, user, patientId);
  return { user, db };
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function startVisitUpdate(form: FormData) {
  const patientId = String(form.get("patientId"));
  const { user, db } = await ptFor(patientId);
  const start = String(form.get("start") ?? "current_plan");
  let visitId = String(form.get("visitId") ?? "");
  if (!visitId || visitId === "new") {
    const date = ymd.safeParse(String(form.get("visitDate") ?? ""));
    if (!date.success) redirect(`/pt/patients/${patientId}/update/new?error=date`);
    if (date.data > localDate()) redirect(`/pt/patients/${patientId}/update/new?error=future`);
    // Treating PT = the PT writing the update unless chosen from the care team.
    const treating = String(form.get("treatingPtId") || user.id);
    const team = await careTeam(db, patientId);
    if (!team.some((t) => t.userId === treating)) throw new AuthzError("Treating PT must be on the care team");
    visitId = (await ensureVisit(db, user.id, patientId, date.data, treating)).visit.id;
  } else {
    const [v] = await db.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.patientId, patientId))).limit(1);
    if (!v) throw new AuthzError();
  }
  const draft = await createDraft(
    db,
    user.id,
    patientId,
    visitId,
    start === "template" ? { kind: "template", templateId: String(form.get("templateId")) } : start === "blank" ? { kind: "blank" } : start === "paste" ? { kind: "paste" } : { kind: "current_plan" },
  );
  redirect(`/pt/patients/${patientId}/update/${draft.id}${start === "paste" ? "?step=paste" : ""}`);
}

export async function startCorrection(form: FormData) {
  const patientId = String(form.get("patientId"));
  const { user, db } = await ptFor(patientId);
  const d = await createCorrectionDraft(db, user.id, String(form.get("versionId")));
  redirect(`/pt/patients/${patientId}/update/${d.id}`);
}

export async function discardDraftAction(form: FormData) {
  const patientId = String(form.get("patientId"));
  const { user, db } = await ptFor(patientId);
  const draftId = String(form.get("draftId"));
  const [d] = await db.select({ patientId: planDrafts.patientId }).from(planDrafts).where(eq(planDrafts.id, draftId)).limit(1);
  if (d?.patientId !== patientId) throw new AuthzError();
  await discardDraft(db, user.id, draftId);
  redirect(`/pt/patients/${patientId}`);
}

export async function reviewCheckIn(form: FormData) {
  const patientId = String(form.get("patientId"));
  const { user, db } = await ptFor(patientId);
  const id = String(form.get("checkInId"));
  const reviewed = form.get("reviewed") === "1";
  await db
    .update(checkIns)
    .set(reviewed ? { reviewStatus: "reviewed", reviewedBy: user.id, reviewedAt: new Date() } : { reviewStatus: "unreviewed", reviewedBy: null, reviewedAt: null })
    .where(and(eq(checkIns.id, id), eq(checkIns.patientId, patientId)));
  await audit(db, { actorId: user.id, action: reviewed ? "checkin.review" : "checkin.unreview", entityType: "check_in", entityId: id, patientId });
  revalidatePath(`/pt/patients/${patientId}`);
}

export async function ptSendMessage(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const patientId = String(form.get("patientId"));
  const { user, db } = await ptFor(patientId);
  try {
    await sendMessage(db, user, patientId, String(form.get("body") ?? ""));
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/pt/patients/${patientId}`);
  return { ok: true };
}

export async function addMeasureEntry(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const patientId = String(form.get("patientId"));
  const { user, db } = await ptFor(patientId);
  const definitionId = String(form.get("definitionId"));
  const [def] = await db.select().from(measureDefinitions).where(eq(measureDefinitions.id, definitionId)).limit(1);
  if (!def) return { error: "Choose a measure." };
  const value = Number(form.get("value"));
  if (!Number.isFinite(value)) return { error: "Enter a number." };
  if ((def.minValue != null && value < Number(def.minValue)) || (def.maxValue != null && value > Number(def.maxValue))) return { error: `Value must be between ${def.minValue} and ${def.maxValue} ${def.unit}.` };
  const date = ymd.safeParse(String(form.get("recordedOn") ?? ""));
  if (!date.success || date.data > localDate()) return { error: "Choose a date that isn't in the future." };
  await db.insert(measureEntries).values({ id: newId(), patientId, definitionId, value: String(value), recordedOn: date.data, source: "pt", enteredBy: user.id, note: String(form.get("note") ?? "").trim() || null });
  await audit(db, { actorId: user.id, action: "measure.add", entityType: "measure_entry", patientId });
  revalidatePath(`/pt/patients/${patientId}`);
  return { ok: true };
}

export async function toggleMeasure(form: FormData) {
  const patientId = String(form.get("patientId"));
  const { user, db } = await ptFor(patientId);
  const definitionId = String(form.get("definitionId"));
  if (form.get("on") === "1") await db.insert(patientMeasures).values({ id: newId(), patientId, definitionId, selectedBy: user.id }).onConflictDoNothing();
  else await db.delete(patientMeasures).where(and(eq(patientMeasures.patientId, patientId), eq(patientMeasures.definitionId, definitionId)));
  revalidatePath(`/pt/patients/${patientId}`);
}

export async function markMilestone(form: FormData) {
  const patientId = String(form.get("patientId"));
  const { user, db } = await ptFor(patientId);
  const id = String(form.get("milestoneId"));
  await db.update(milestones).set({ status: "achieved", achievedOn: localDate() }).where(and(eq(milestones.id, id), eq(milestones.patientId, patientId)));
  await audit(db, { actorId: user.id, action: "milestone.achieve", entityType: "milestone", entityId: id, patientId });
  revalidatePath(`/pt/patients/${patientId}`);
}
