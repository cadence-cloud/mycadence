/**
 * Server-side authorization. Every route, action and file read goes through here.
 *
 * Rules:
 *  - patient: only their own patient record, and only published / patient-visible data.
 *  - pt: patients with an ACTIVE care assignment (primary or covering).
 *  - admin: operational data (names, assignments, settings, audit metadata).
 *           No clinical content unless separately granted (not supported yet).
 */
import { shownName } from "@/server/names";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { careAssignments, patients, users } from "@/db/schema";

export type Role = "admin" | "pt" | "patient";
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  credentials: string | null;
  isDemo: boolean;
  fullName?: string;
}
export type AccessPurpose = "clinical" | "operational";

export class AuthzError extends Error {
  status = 403;
  constructor(message = "Not authorized") {
    super(message);
  }
}

export async function patientIdForUser(db: Db, userId: string): Promise<string | null> {
  const [p] = await db.select({ id: patients.id }).from(patients).where(eq(patients.userId, userId)).limit(1);
  return p?.id ?? null;
}

export async function canAccessPatient(db: Db, user: AuthUser, patientId: string, purpose: AccessPurpose = "clinical"): Promise<boolean> {
  if (user.role === "patient") {
    return (await patientIdForUser(db, user.id)) === patientId;
  }
  if (user.role === "admin") return purpose === "operational";
  const rows = await db
    .select({ id: careAssignments.id })
    .from(careAssignments)
    .innerJoin(users, eq(users.id, careAssignments.staffUserId))
    .where(
      and(
        eq(careAssignments.patientId, patientId),
        eq(careAssignments.staffUserId, user.id),
        isNull(careAssignments.endedAt),
        isNull(users.deactivatedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function assertPatientAccess(db: Db, user: AuthUser, patientId: string, purpose: AccessPurpose = "clinical") {
  if (!(await canAccessPatient(db, user, patientId, purpose))) throw new AuthzError();
}

export async function assignedPatientIds(db: Db, staffUserId: string): Promise<string[]> {
  const rows = await db
    .select({ id: careAssignments.patientId })
    .from(careAssignments)
    .where(and(eq(careAssignments.staffUserId, staffUserId), isNull(careAssignments.endedAt)));
  return [...new Set(rows.map((r) => r.id))];
}

/** Active care team for a patient — the only staff who receive that patient's messages. */
export async function careTeam(db: Db, patientId: string) {
  return db
    .select({ userId: users.id, name: shownName, email: users.email, notifyByEmail: users.notifyByEmail, credentials: users.credentials, role: careAssignments.role })
    .from(careAssignments)
    .innerJoin(users, eq(users.id, careAssignments.staffUserId))
    .where(and(eq(careAssignments.patientId, patientId), isNull(careAssignments.endedAt), isNull(users.deactivatedAt)))
    .orderBy(careAssignments.role);
}
