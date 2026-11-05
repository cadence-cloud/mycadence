"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { getDb } from "@/db";
import { careAssignments, clinicSettings, patients, sessions, users } from "@/db/schema";
import { requireApiUser } from "@/server/session";
import { AuthzError } from "@/server/authz";
import { hashPassword } from "@/server/passwords";
import { audit } from "@/server/audit";
import { threadFor } from "@/server/messaging";
import { SETTING_DEFAULTS, type SettingKey } from "@/server/settings";
import { newId } from "@/lib/ids";
import { isDemo } from "@/lib/env";

type R = { error?: string; ok?: boolean; tempPassword?: string };

async function admin() {
  const user = await requireApiUser(["admin"]);
  if (!user) throw new AuthzError();
  return { user, db: await getDb() };
}

const tempPassword = () => randomBytes(9).toString("base64url");

async function emailTaken(db: Awaited<ReturnType<typeof getDb>>, email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return !!u;
}

export async function addStaff(_: unknown, form: FormData): Promise<R> {
  const { user, db } = await admin();
  const v = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email(), role: z.enum(["pt", "admin"]), credentials: z.string().max(40).optional() }).safeParse(Object.fromEntries(form));
  if (!v.success) return { error: "Enter a name, a valid email, and a role." };
  if (await emailTaken(db, v.data.email)) return { error: "That email is already in use." };
  const pw = tempPassword();
  const id = newId();
  await db.insert(users).values({ id, name: v.data.name, email: v.data.email, role: v.data.role, credentials: v.data.credentials?.trim() || null, passwordHash: await hashPassword(pw), isDemo: isDemo() });
  await audit(db, { actorId: user.id, action: "staff.create", entityType: "user", entityId: id, meta: { role: v.data.role } });
  revalidatePath("/admin");
  return { ok: true, tempPassword: pw };
}

export async function setStaffActive(form: FormData) {
  const { user, db } = await admin();
  const id = String(form.get("userId"));
  if (id === user.id) return;
  const active = form.get("active") === "1";
  await db.update(users).set({ deactivatedAt: active ? null : new Date() }).where(and(eq(users.id, id), sql`${users.role} <> 'patient'`));
  if (!active) await db.delete(sessions).where(eq(sessions.userId, id)); // sign out everywhere
  await audit(db, { actorId: user.id, action: active ? "staff.reactivate" : "staff.deactivate", entityType: "user", entityId: id });
  revalidatePath("/admin");
}

export async function addPatient(_: unknown, form: FormData): Promise<R> {
  const { user, db } = await admin();
  const v = z.object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), email: z.string().trim().email(), sport: z.string().max(120).optional(), primaryPtId: z.string().min(1) }).safeParse(Object.fromEntries(form));
  if (!v.success) return { error: "First name, last name, email and a primary PT are required." };
  if (await emailTaken(db, v.data.email)) return { error: "That email is already in use." };
  const [pt] = await db.select().from(users).where(and(eq(users.id, v.data.primaryPtId), eq(users.role, "pt"), isNull(users.deactivatedAt))).limit(1);
  if (!pt) return { error: "Choose an active PT." };
  const pw = tempPassword();
  const userId = newId();
  const patientId = newId();
  await db.insert(users).values({ id: userId, name: `${v.data.firstName} ${v.data.lastName}`, email: v.data.email, role: "patient", passwordHash: await hashPassword(pw), isDemo: isDemo() });
  await db.insert(patients).values({ id: patientId, userId, firstName: v.data.firstName, lastName: v.data.lastName, email: v.data.email, sport: v.data.sport?.trim() || null, isDemo: isDemo() });
  await db.insert(careAssignments).values({ id: newId(), patientId, staffUserId: pt.id, role: "primary", createdBy: user.id });
  await threadFor(db, patientId);
  await audit(db, { actorId: user.id, action: "patient.create", entityType: "patient", entityId: patientId, patientId });
  revalidatePath("/admin");
  return { ok: true, tempPassword: pw };
}

export async function assignStaff(_: unknown, form: FormData): Promise<R> {
  const { user, db } = await admin();
  const patientId = String(form.get("patientId"));
  const staffId = String(form.get("staffUserId"));
  const role = String(form.get("role")) === "primary" ? "primary" : "covering";
  const [pt] = await db.select().from(users).where(and(eq(users.id, staffId), eq(users.role, "pt"), isNull(users.deactivatedAt))).limit(1);
  if (!pt) return { error: "Choose an active PT." };
  const existing = await db.select().from(careAssignments).where(and(eq(careAssignments.patientId, patientId), isNull(careAssignments.endedAt)));
  if (existing.some((a) => a.staffUserId === staffId)) return { error: `${pt.name} is already on this care team.` };
  if (role === "primary") {
    // One primary at a time: the previous primary moves to covering.
    for (const a of existing.filter((a) => a.role === "primary")) await db.update(careAssignments).set({ role: "covering" }).where(eq(careAssignments.id, a.id));
  }
  const id = newId();
  await db.insert(careAssignments).values({ id, patientId, staffUserId: staffId, role, createdBy: user.id });
  await audit(db, { actorId: user.id, action: "assignment.create", entityType: "care_assignment", entityId: id, patientId, meta: { role } });
  revalidatePath("/admin");
  return { ok: true };
}

export async function endAssignment(form: FormData) {
  const { user, db } = await admin();
  const id = String(form.get("assignmentId"));
  const [a] = await db.update(careAssignments).set({ endedAt: new Date() }).where(eq(careAssignments.id, id)).returning();
  if (a) await audit(db, { actorId: user.id, action: "assignment.end", entityType: "care_assignment", entityId: id, patientId: a.patientId });
  revalidatePath("/admin");
}

export async function resetPassword(_: unknown, form: FormData): Promise<R> {
  const { user, db } = await admin();
  const id = String(form.get("userId"));
  const pw = tempPassword();
  await db.update(users).set({ passwordHash: await hashPassword(pw) }).where(eq(users.id, id));
  await db.delete(sessions).where(eq(sessions.userId, id));
  await audit(db, { actorId: user.id, action: "user.password_reset", entityType: "user", entityId: id });
  return { ok: true, tempPassword: pw };
}

export async function saveSettings(_: unknown, form: FormData): Promise<R> {
  const { user, db } = await admin();
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    const v = String(form.get(key) ?? "").trim();
    if (!v) continue;
    await db.insert(clinicSettings).values({ key, value: v.slice(0, 1000), updatedBy: user.id }).onConflictDoUpdate({ target: clinicSettings.key, set: { value: v.slice(0, 1000), updatedBy: user.id, updatedAt: new Date() } });
  }
  await audit(db, { actorId: user.id, action: "settings.update", entityType: "clinic_settings" });
  revalidatePath("/admin");
  return { ok: true };
}

// ---- Integrations --------------------------------------------------------------
import { patients as patientsTable } from "@/db/schema";
import { createPatientFromBooking, linkBookingToPatient, upsertBooking } from "@/server/scheduling";
import { processInboundEmail } from "@/server/inbound-email";
import { replyAddress, threadReplyToken } from "@/server/email";
import { threadFor as threadForPatient } from "@/server/messaging-thread";
import { clinicDateTime } from "@/lib/time";

export async function linkBooking(_: unknown, form: FormData): Promise<R> {
  const { user, db } = await admin();
  const patientId = String(form.get("patientId") ?? "");
  if (!patientId) return { error: "Choose a patient." };
  try {
    await linkBookingToPatient(db, user.id, String(form.get("appointmentId")), patientId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function newPatientFromBooking(_: unknown, form: FormData): Promise<R> {
  const { user, db } = await admin();
  try {
    await createPatientFromBooking(db, user.id, String(form.get("appointmentId")), { isDemo: isDemo() });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/admin");
  return { ok: true };
}

/** Demo only: runs the same code path a Calendly webhook would. */
export async function simulateBooking(_: unknown, form: FormData): Promise<R> {
  const { db } = await admin();
  if (!isDemo()) return { error: "Simulation is only available in the demo environment." };
  const v = z
    .object({ name: z.string().trim().min(1), email: z.string().trim().email(), ptEmail: z.string().email(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/), eventName: z.string().min(1) })
    .safeParse(Object.fromEntries(form));
  if (!v.success) return { error: "Fill in name, email, date and time." };
  await upsertBooking(db, { source: "calendly", externalId: `demo-${newId()}`, status: "scheduled", inviteeName: v.data.name, inviteeEmail: v.data.email, eventName: v.data.eventName, startsAt: clinicDateTime(v.data.date, v.data.time), hostEmails: [v.data.ptEmail], simulated: true });
  revalidatePath("/admin");
  return { ok: true };
}

/** Demo only: pretend a patient replied to a notification email. */
export async function simulateEmailReply(_: unknown, form: FormData): Promise<R> {
  const { db } = await admin();
  if (!isDemo()) return { error: "Simulation is only available in the demo environment." };
  const patientId = String(form.get("patientId") ?? "");
  const text = String(form.get("text") ?? "").trim();
  if (!patientId || !text) return { error: "Choose a patient and write a reply." };
  const [p] = await db.select({ email: patientsTable.email }).from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
  if (!p?.email) return { error: "That patient has no email on file." };
  const thread = await threadForPatient(db, patientId);
  const token = await threadReplyToken(db, thread.id);
  const r = await processInboundEmail(db, { from: p.email, to: replyAddress(token), text: `${text}\n\nOn Tue, Cadence <notifications@njcadencept.com> wrote:\n> You have a new update from Cadence` });
  if (!r.ok) return { error: r.reason };
  revalidatePath("/admin");
  return { ok: true };
}

