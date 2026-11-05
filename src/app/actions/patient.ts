"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { checkIns, completionEntries, exerciseAssignments, goals, measureDefinitions, measureEntries, patientMeasures, planVersions } from "@/db/schema";
import { requireApiUser } from "@/server/session";
import { AuthzError, careTeam, patientIdForUser } from "@/server/authz";
import { sendMessage } from "@/server/messaging";
import { notifyUser } from "@/server/notify";
import { audit } from "@/server/audit";
import { newId } from "@/lib/ids";
import { addDays, localDate } from "@/lib/time";

async function me() {
  const user = await requireApiUser(["patient"]);
  if (!user) throw new AuthzError();
  const db = await getDb();
  const patientId = await patientIdForUser(db, user.id);
  if (!patientId) throw new AuthzError();
  return { user, db, patientId };
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Record (or correct) how an exercise went on a given day.
 * New entries only against the CURRENT plan version; the entry keeps that
 * version forever. Corrections keep the previous value in `history`.
 */
export async function logCompletion(input: { assignmentId: string; date: string; status: "completed" | "partial" | "skipped"; comment?: string | null }): Promise<{ ok?: boolean; error?: string }> {
  const { user, db, patientId } = await me();
  const parsed = z.object({ assignmentId: z.string(), date: ymd, status: z.enum(["completed", "partial", "skipped"]), comment: z.string().max(500).nullable().optional() }).safeParse(input);
  if (!parsed.success) return { error: "Something was missing. Try again." };
  const { assignmentId, date, status } = parsed.data;
  const comment = parsed.data.comment?.trim() || null;
  const today = localDate();
  if (date > today || date < addDays(today, -14)) return { error: "You can log the last 14 days." };
  const [a] = await db.select().from(exerciseAssignments).where(and(eq(exerciseAssignments.id, assignmentId), eq(exerciseAssignments.patientId, patientId))).limit(1);
  if (!a) return { error: "That exercise isn't in your plan." };
  const [existing] = await db.select().from(completionEntries).where(and(eq(completionEntries.assignmentId, assignmentId), eq(completionEntries.sessionDate, date))).limit(1);
  if (existing) {
    if (existing.status === status && existing.comment === comment) return { ok: true };
    await db
      .update(completionEntries)
      .set({ status, comment, updatedAt: new Date(), history: [...existing.history, { status: existing.status, comment: existing.comment, at: existing.updatedAt.toISOString() }] })
      .where(eq(completionEntries.id, existing.id));
    await audit(db, { actorId: user.id, action: "completion.correct", entityType: "completion_entry", entityId: existing.id, patientId });
  } else {
    const [cur] = await db.select({ id: planVersions.id }).from(planVersions).where(eq(planVersions.patientId, patientId)).orderBy(desc(planVersions.versionNumber)).limit(1);
    if (cur?.id !== a.planVersionId) return { error: "Your plan was updated. Refresh to see the latest exercises." };
    const id = newId();
    await db.insert(completionEntries).values({ id, patientId, assignmentId, planVersionId: a.planVersionId, sessionDate: date, status, comment }).onConflictDoNothing();
    await audit(db, { actorId: user.id, action: "completion.add", entityType: "completion_entry", entityId: id, patientId });
  }
  revalidatePath("/me");
  return { ok: true };
}

export async function clearCompletion(input: { assignmentId: string; date: string }): Promise<{ ok?: boolean; error?: string }> {
  const { user, db, patientId } = await me();
  const [e] = await db.select().from(completionEntries).where(and(eq(completionEntries.assignmentId, input.assignmentId), eq(completionEntries.sessionDate, input.date), eq(completionEntries.patientId, patientId))).limit(1);
  if (!e) return { ok: true };
  await db.delete(completionEntries).where(eq(completionEntries.id, e.id));
  await audit(db, { actorId: user.id, action: "completion.clear", entityType: "completion_entry", entityId: e.id, patientId });
  revalidatePath("/me");
  return { ok: true };
}

const checkInSchema = z.object({
  activityDate: ymd,
  activityType: z.string().trim().min(1).max(60),
  durationMin: z.coerce.number().int().min(1, "Add how long it lasted").max(1440),
  distance: z.union([z.literal(""), z.coerce.number().min(0).max(1000)]).optional(),
  distanceUnit: z.enum(["mi", "km"]).optional(),
  duringFeel: z.string().trim().min(1, "Choose how it felt").max(60),
  duringNote: z.string().max(1000).optional(),
  afterSymptoms: z.string().max(1000).optional(),
  question: z.string().max(2000).optional(),
});

export async function submitCheckIn(_: unknown, form: FormData): Promise<{ error?: string }> {
  const { user, db, patientId } = await me();
  const raw = Object.fromEntries(form.entries());
  const parsed = checkInSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  if (v.activityDate > localDate()) return { error: "The activity date can't be in the future." };
  const [cur] = await db.select({ id: planVersions.id }).from(planVersions).where(eq(planVersions.patientId, patientId)).orderBy(desc(planVersions.versionNumber)).limit(1);
  const id = newId();
  await db.insert(checkIns).values({
    id,
    patientId,
    planVersionId: cur?.id ?? null,
    activityDate: v.activityDate,
    activityType: v.activityType,
    durationMin: v.durationMin,
    distance: v.distance === "" || v.distance == null ? null : String(v.distance),
    distanceUnit: v.distance === "" || v.distance == null ? null : v.distanceUnit ?? "mi",
    duringFeel: v.duringFeel,
    duringNote: v.duringNote?.trim() || null,
    afterSymptoms: v.afterSymptoms?.trim() || null,
    question: v.question?.trim() || null,
  });
  await audit(db, { actorId: user.id, action: "checkin.create", entityType: "check_in", entityId: id, patientId });
  for (const t of await careTeam(db, patientId)) await notifyUser(db, t.userId, "check_in", `/pt/patients/${patientId}?tab=checkins`);
  redirect("/me/check-in?saved=1");
}

export async function addNextMorning(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { user, db, patientId } = await me();
  const id = String(form.get("checkInId"));
  const text = String(form.get("nextMorning") ?? "").trim();
  if (!text) return { error: "Describe how you felt the next morning." };
  // Adding the next-morning note re-opens the check-in for PT review.
  const r = await db
    .update(checkIns)
    .set({ nextMorning: text.slice(0, 1000), nextMorningAt: new Date(), reviewStatus: "unreviewed" })
    .where(and(eq(checkIns.id, id), eq(checkIns.patientId, patientId)))
    .returning({ id: checkIns.id });
  if (!r.length) return { error: "Check-in not found." };
  await audit(db, { actorId: user.id, action: "checkin.next_morning", entityType: "check_in", entityId: id, patientId });
  revalidatePath("/me/check-in");
  return { ok: true };
}

export async function patientSendMessage(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { user, db, patientId } = await me();
  try {
    await sendMessage(db, user, patientId, String(form.get("body") ?? ""));
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/me/messages");
  revalidatePath("/me");
  return { ok: true };
}

export async function addSelfReport(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { user, db, patientId } = await me();
  const definitionId = String(form.get("definitionId"));
  const [def] = await db
    .select({ d: measureDefinitions })
    .from(patientMeasures)
    .innerJoin(measureDefinitions, eq(measureDefinitions.id, patientMeasures.definitionId))
    .where(and(eq(patientMeasures.patientId, patientId), eq(patientMeasures.definitionId, definitionId), eq(measureDefinitions.source, "patient")))
    .limit(1);
  if (!def) return { error: "That measure isn't available." };
  const value = Number(form.get("value"));
  if (!Number.isFinite(value) || value < Number(def.d.minValue ?? 0) || value > Number(def.d.maxValue ?? 10)) return { error: `Choose a value from ${def.d.minValue} to ${def.d.maxValue}.` };
  await db.insert(measureEntries).values({ id: newId(), patientId, definitionId, value: String(value), recordedOn: localDate(), source: "patient", enteredBy: user.id, note: String(form.get("note") ?? "").trim().slice(0, 300) || null });
  await audit(db, { actorId: user.id, action: "measure.self_report", entityType: "measure_entry", patientId });
  revalidatePath("/me/progress");
  return { ok: true };
}

export async function addGoal(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { user, db, patientId } = await me();
  const text = String(form.get("text") ?? "").trim();
  if (!text) return { error: "Describe your goal in your own words." };
  const targetDate = String(form.get("targetDate") ?? "");
  await db.insert(goals).values({ id: newId(), patientId, text: text.slice(0, 500), targetEvent: String(form.get("targetEvent") ?? "").trim().slice(0, 200) || null, targetDate: /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : null, createdBy: user.id });
  await audit(db, { actorId: user.id, action: "goal.create", entityType: "goal", patientId });
  revalidatePath("/me/progress");
  return { ok: true };
}

export async function setGoalStatus(form: FormData) {
  const { db, patientId } = await me();
  const status = z.enum(["active", "achieved", "set_aside"]).parse(form.get("status"));
  await db.update(goals).set({ status }).where(and(eq(goals.id, String(form.get("goalId"))), eq(goals.patientId, patientId)));
  revalidatePath("/me/progress");
}
