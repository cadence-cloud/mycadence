/**
 * Scheduling sync. Calendly is the source of truth for bookings (it also feeds
 * Google Calendar), so bookings arrive here via Calendly webhooks.
 *
 *  booking created  -> appointment (matched to a patient by email, to a PT by host email)
 *  start time passes -> a visit is created automatically (one per patient per day)
 *  booking canceled  -> appointment canceled; an auto-created visit with nothing in it is removed
 *  PT marks no-show  -> same as canceled, recorded as no_show
 *
 * Unmatched bookings (new patients, typos in email) wait in an admin queue.
 */
import { and, eq, gt, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { appointments, careAssignments, media, patients, planDrafts, planVersions, users, visits } from "@/db/schema";
import { newId } from "@/lib/ids";
import { localDate } from "@/lib/time";
import { audit } from "./audit";
import { threadFor } from "./messaging";

export interface BookingInput {
  source: "calendly" | "google" | "manual";
  externalId: string;
  status: "scheduled" | "canceled";
  inviteeName: string;
  inviteeEmail: string;
  eventName?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  hostEmails?: string[];
  simulated?: boolean;
}

async function staffByEmail(db: Db, emails: string[]) {
  if (!emails.length) return null;
  const lowered = emails.map((e) => e.toLowerCase());
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "pt"), isNull(users.deactivatedAt), inArray(sql`lower(${users.email})`, lowered)))
    .limit(1);
  return u?.id ?? null;
}

async function patientByEmail(db: Db, email: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(sql`lower(${patients.email}) = ${email.toLowerCase()}`, isNull(patients.archivedAt))).limit(1);
  return p?.id ?? null;
}

async function primaryPt(db: Db, patientId: string) {
  const [a] = await db.select({ id: careAssignments.staffUserId }).from(careAssignments).where(and(eq(careAssignments.patientId, patientId), eq(careAssignments.role, "primary"), isNull(careAssignments.endedAt))).limit(1);
  return a?.id ?? null;
}

/** A booked PT who isn't on the care team gets covering access, so they can document the visit. */
async function ensureOnCareTeam(db: Db, patientId: string, ptUserId: string) {
  const [a] = await db.select({ id: careAssignments.id }).from(careAssignments).where(and(eq(careAssignments.patientId, patientId), eq(careAssignments.staffUserId, ptUserId), isNull(careAssignments.endedAt))).limit(1);
  if (a) return;
  const hasPrimary = await primaryPt(db, patientId);
  const id = newId();
  await db.insert(careAssignments).values({ id, patientId, staffUserId: ptUserId, role: hasPrimary ? "covering" : "primary" });
  await audit(db, { actorId: null, action: "assignment.auto_from_booking", entityType: "care_assignment", entityId: id, patientId, meta: { role: hasPrimary ? "covering" : "primary" } });
}

/** Idempotent: the same booking delivered twice updates one row. */
export async function upsertBooking(db: Db, b: BookingInput) {
  const [existing] = await db.select().from(appointments).where(and(eq(appointments.source, b.source), eq(appointments.externalId, b.externalId))).limit(1);
  if (existing) {
    if (b.status === "canceled" && existing.status === "scheduled") await cancelAppointment(db, null, existing.id, "canceled");
    else if (b.status === "scheduled") await db.update(appointments).set({ startsAt: b.startsAt, endsAt: b.endsAt ?? null, eventName: b.eventName ?? existing.eventName, updatedAt: new Date() }).where(eq(appointments.id, existing.id));
    return { id: existing.id, created: false };
  }
  const patientId = await patientByEmail(db, b.inviteeEmail);
  let ptUserId = await staffByEmail(db, b.hostEmails ?? []);
  if (!ptUserId && patientId) ptUserId = await primaryPt(db, patientId);
  if (patientId && ptUserId) await ensureOnCareTeam(db, patientId, ptUserId);
  const id = newId();
  await db.insert(appointments).values({
    id,
    source: b.source,
    externalId: b.externalId,
    patientId,
    ptUserId,
    inviteeName: b.inviteeName.slice(0, 200),
    inviteeEmail: b.inviteeEmail.slice(0, 320),
    eventName: b.eventName?.slice(0, 200) ?? null,
    startsAt: b.startsAt,
    endsAt: b.endsAt ?? null,
    status: b.status,
    simulated: !!b.simulated,
  });
  await audit(db, { actorId: null, action: "appointment.sync", entityType: "appointment", entityId: id, patientId, meta: { source: b.source, matched: !!patientId, status: b.status } });
  await materializeVisits(db);
  return { id, created: true };
}

async function visitIsEmpty(db: Db, visitId: string) {
  const [v] = await db.select({ n: sql<number>`count(*)::int` }).from(planVersions).where(eq(planVersions.visitId, visitId));
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(planDrafts).where(and(eq(planDrafts.visitId, visitId), eq(planDrafts.status, "draft")));
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(media).where(and(eq(media.visitId, visitId), isNull(media.deletedAt)));
  return v.n + d.n + m.n === 0;
}

export async function cancelAppointment(db: Db, actorId: string | null, appointmentId: string, status: "canceled" | "no_show") {
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  if (!a) return { ok: false as const, message: "Appointment not found." };
  if (a.visitId) {
    if (!(await visitIsEmpty(db, a.visitId))) {
      return { ok: false as const, message: "This visit already has an update, files, or a draft, so it can't be removed. Discard those first if the visit didn't happen." };
    }
    await db.update(appointments).set({ visitId: null }).where(eq(appointments.id, a.id));
    await db.delete(visits).where(and(eq(visits.id, a.visitId), eq(visits.source, "booking")));
  }
  await db.update(appointments).set({ status, updatedAt: new Date() }).where(eq(appointments.id, a.id));
  await audit(db, { actorId, action: `appointment.${status}`, entityType: "appointment", entityId: a.id, patientId: a.patientId });
  return { ok: true as const };
}

/** Turn booked appointments whose start time has passed into visits. Safe to call often. */
export async function materializeVisits(db: Db, now = new Date()) {
  const due = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.status, "scheduled"), isNull(appointments.visitId), lte(appointments.startsAt, now), sql`${appointments.patientId} is not null`));
  for (const a of due) {
    const ptUserId = a.ptUserId ?? (await primaryPt(db, a.patientId!));
    if (!ptUserId) continue;
    const visitDate = localDate(a.startsAt);
    const [existing] = await db.select().from(visits).where(and(eq(visits.patientId, a.patientId!), eq(visits.visitDate, visitDate))).limit(1);
    let visitId = existing?.id;
    if (!existing) {
      visitId = newId();
      await db
        .insert(visits)
        .values({ id: visitId, patientId: a.patientId!, ptUserId, visitDate, source: "booking", appointmentId: a.id, createdBy: ptUserId })
        .onConflictDoNothing();
      const [v] = await db.select().from(visits).where(and(eq(visits.patientId, a.patientId!), eq(visits.visitDate, visitDate))).limit(1);
      visitId = v.id;
      await audit(db, { actorId: null, action: "visit.create_from_booking", entityType: "visit", entityId: visitId, patientId: a.patientId });
    } else if (!existing.appointmentId) {
      await db.update(visits).set({ appointmentId: a.id }).where(eq(visits.id, existing.id));
    }
    await db.update(appointments).set({ visitId, updatedAt: new Date() }).where(eq(appointments.id, a.id));
  }
  return due.length;
}

export async function linkBookingToPatient(db: Db, actorId: string, appointmentId: string, patientId: string) {
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  if (!a) throw new Error("Appointment not found");
  // Future bookings from this address match automatically if the patient has no email yet.
  const [p] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!p) throw new Error("Patient not found");
  if (!p.email) await db.update(patients).set({ email: a.inviteeEmail }).where(eq(patients.id, patientId));
  const ptUserId = a.ptUserId ?? (await primaryPt(db, patientId));
  if (ptUserId) await ensureOnCareTeam(db, patientId, ptUserId);
  await db.update(appointments).set({ patientId, ptUserId, updatedAt: new Date() }).where(eq(appointments.id, a.id));
  await audit(db, { actorId, action: "appointment.link_patient", entityType: "appointment", entityId: a.id, patientId });
  await materializeVisits(db);
}

/** New patient from a booking. The account has no password until an invite/reset is sent. */
export async function createPatientFromBooking(db: Db, actorId: string, appointmentId: string, opts: { isDemo: boolean }) {
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  if (!a) throw new Error("Appointment not found");
  const [taken] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${a.inviteeEmail.toLowerCase()}`).limit(1);
  if (taken) throw new Error("A person with this email already exists. Link the booking to them instead.");
  const parts = a.inviteeName.trim().split(/\s+/);
  const firstName = parts[0] ?? "New";
  const lastName = parts.slice(1).join(" ") || "Patient";
  const userId = newId();
  const patientId = newId();
  await db.insert(users).values({ id: userId, name: a.inviteeName, email: a.inviteeEmail, role: "patient", passwordHash: null, isDemo: opts.isDemo });
  await db.insert(patients).values({ id: patientId, userId, firstName, lastName, email: a.inviteeEmail, isDemo: opts.isDemo });
  await threadFor(db, patientId);
  await audit(db, { actorId, action: "patient.create_from_booking", entityType: "patient", entityId: patientId, patientId });
  await linkBookingToPatient(db, actorId, appointmentId, patientId);
  return patientId;
}

export async function upcomingForPt(db: Db, ptUserId: string, patientIds: string[], days = 7) {
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400_000);
  if (!patientIds.length) return [];
  return db
    .select({ a: appointments, firstName: patients.firstName, lastName: patients.lastName })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        eq(appointments.status, "scheduled"),
        gt(appointments.startsAt, new Date(now.getTime() - 3600_000)), // keep the one in progress
        lt(appointments.startsAt, until),
        inArray(appointments.patientId, patientIds),
        sql`(${appointments.ptUserId} = ${ptUserId} or ${appointments.ptUserId} is null)`,
      ),
    )
    .orderBy(appointments.startsAt);
}
