"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { exercises, media, planTemplates } from "@/db/schema";
import { requireApiUser } from "@/server/session";
import { AuthzError } from "@/server/authz";
import { planContentSchema } from "@/server/plans";
import { audit } from "@/server/audit";
import { newId } from "@/lib/ids";
import { addExercisesToPatient, canManage, copyExercise } from "@/server/library";
import { canAccessPatient } from "@/server/authz";
import type { PlanContent } from "@/lib/plan-types";

async function pt() {
  const user = await requireApiUser(["pt"]);
  if (!user) throw new AuthzError();
  return { user, db: await getDb() };
}

export async function addExercise(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { user, db } = await pt();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  const demo = String(form.get("demoMediaId") ?? "") || null;
  if (demo) {
    // Only general (non-patient) demonstrations can be attached to the shared library.
    const [m] = await db.select().from(media).where(eq(media.id, demo)).limit(1);
    if (!m || m.category !== "general_demo" || m.patientId) return { error: "Only general demonstrations can be added to the library." };
  }
  const where = form.get("where") === "shared" ? "shared" : "mine";
  const id = newId();
  await db.insert(exercises).values({ id, name: name.slice(0, 200), description: String(form.get("description") ?? "").trim().slice(0, 2000) || null, bodyRegion: String(form.get("bodyRegion") ?? "").trim().slice(0, 60) || null, demoMediaId: demo, isCustom: true, ownerId: where === "mine" ? user.id : null, createdBy: user.id });
  await audit(db, { actorId: user.id, action: "exercise.create", entityType: "exercise", entityId: id, meta: { library: where } });
  revalidatePath("/pt/library");
  return { ok: true };
}

export async function archiveExercise(form: FormData) {
  const { user, db } = await pt();
  const id = String(form.get("id"));
  const [e] = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
  if (!e || !canManage(e, user.id)) throw new AuthzError("Only the person who added this exercise can remove it.");
  await db.update(exercises).set({ archivedAt: new Date() }).where(eq(exercises.id, id));
  await audit(db, { actorId: user.id, action: "exercise.archive", entityType: "exercise", entityId: id });
  revalidatePath("/pt/library");
}

export async function createTemplate(form: FormData) {
  const { user, db } = await pt();
  const name = String(form.get("name") ?? "").trim() || "Untitled template";
  const id = newId();
  const content: PlanContent = { recap: "", items: [], runningGuidance: "", nextMilestone: "", reassessNext: "", links: [] };
  await db.insert(planTemplates).values({ id, name: name.slice(0, 120), content, createdBy: user.id });
  await audit(db, { actorId: user.id, action: "template.create", entityType: "plan_template", entityId: id });
  redirect(`/pt/templates/${id}`);
}

/** Template edits only touch the template. Patient plans hold their own copies. */
export async function saveTemplate(input: { id: string; name: string; description: string; content: unknown }): Promise<{ error?: string; ok?: boolean }> {
  const { user, db } = await pt();
  const parsed = planContentSchema.safeParse(input.content);
  if (!parsed.success) return { error: "Some fields are invalid." };
  const name = z.string().trim().min(1).max(120).safeParse(input.name);
  if (!name.success) return { error: "Name is required." };
  const content = { ...(parsed.data as PlanContent), recap: "", runningGuidance: "", nextMilestone: "", reassessNext: "", links: [] };
  content.items = content.items.map((i) => ({ ...i, patientMediaId: null, isNew: false }));
  await db.update(planTemplates).set({ name: name.data, description: input.description.slice(0, 500) || null, content, updatedAt: new Date() }).where(eq(planTemplates.id, input.id));
  await audit(db, { actorId: user.id, action: "template.update", entityType: "plan_template", entityId: input.id });
  revalidatePath("/pt/templates");
  return { ok: true };
}

export async function archiveTemplate(form: FormData) {
  const { user, db } = await pt();
  const id = String(form.get("id"));
  await db.update(planTemplates).set({ archivedAt: new Date() }).where(eq(planTemplates.id, id));
  await audit(db, { actorId: user.id, action: "template.archive", entityType: "plan_template", entityId: id });
  redirect("/pt/templates");
}

export async function copyExerciseAction(form: FormData) {
  const { user, db } = await pt();
  const to = form.get("to") === "shared" ? "shared" : "mine";
  await copyExercise(db, user.id, String(form.get("id")), to);
  revalidatePath("/pt/library");
}

/** Add selected library exercises to a patient's plan, then open the draft. */
export async function addToPatientAction(input: { patientId: string; exerciseIds: string[] }): Promise<{ error?: string; url?: string; added?: number }> {
  const { user, db } = await pt();
  if (!(await canAccessPatient(db, user, input.patientId))) return { error: "You're not on this patient's care team." };
  if (!input.exerciseIds.length) return { error: "Select at least one exercise." };
  try {
    const r = await addExercisesToPatient(db, user.id, input.patientId, input.exerciseIds.slice(0, 50));
    return { url: `/pt/patients/${input.patientId}/update/${r.draftId}`, added: r.added };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** From the visit editor: keep a custom exercise in "Your library" for next time. */
export async function saveCustomToMyLibrary(input: { name: string }): Promise<{ id?: string; error?: string }> {
  const { user, db } = await pt();
  const name = input.name.trim().slice(0, 200);
  if (!name) return { error: "Name is required." };
  const id = newId();
  await db.insert(exercises).values({ id, name, isCustom: true, ownerId: user.id, createdBy: user.id });
  await audit(db, { actorId: user.id, action: "exercise.create", entityType: "exercise", entityId: id, meta: { library: "mine", from: "editor" } });
  return { id };
}
