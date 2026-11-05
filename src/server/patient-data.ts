/**
 * Read models for a single patient. Callers MUST authorize first.
 * `audience: "patient"` returns only published / patient-visible data.
 */
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  checkIns,
  completionEntries,
  exerciseAssignments,
  goals,
  measureDefinitions,
  measureEntries,
  media,
  milestones,
  patientMeasures,
  patients,
  planDrafts,
  planVersions,
  users,
  visits,
} from "@/db/schema";
import { careTeam } from "./authz";

export async function getPatient(db: Db, patientId: string) {
  const [p] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  return p ?? null;
}

export async function getVersions(db: Db, patientId: string) {
  return db
    .select({
      id: planVersions.id,
      versionNumber: planVersions.versionNumber,
      visitId: planVersions.visitId,
      content: planVersions.content,
      changeSummary: planVersions.changeSummary,
      publishedAt: planVersions.publishedAt,
      publishedByName: users.name,
      correctionOfVersionId: planVersions.correctionOfVersionId,
      correctionNote: planVersions.correctionNote,
    })
    .from(planVersions)
    .innerJoin(users, eq(users.id, planVersions.publishedBy))
    .where(eq(planVersions.patientId, patientId))
    .orderBy(desc(planVersions.versionNumber));
}

export async function getVisits(db: Db, patientId: string) {
  return db
    .select({ id: visits.id, visitDate: visits.visitDate, kind: visits.kind, ptName: users.name, ptCredentials: users.credentials })
    .from(visits)
    .innerJoin(users, eq(users.id, visits.ptUserId))
    .where(eq(visits.patientId, patientId))
    .orderBy(desc(visits.visitDate));
}

export async function getMedia(db: Db, patientId: string, audience: "staff" | "patient") {
  return db
    .select({
      id: media.id,
      title: media.title,
      explanation: media.explanation,
      mimeType: media.mimeType,
      category: media.category,
      exerciseName: media.exerciseName,
      planItemKey: media.planItemKey,
      capturedOn: media.capturedOn,
      createdAt: media.createdAt,
      visitId: media.visitId,
      draftId: media.draftId,
      visitDate: visits.visitDate,
    })
    .from(media)
    .leftJoin(visits, eq(visits.id, media.visitId))
    .where(and(eq(media.patientId, patientId), eq(media.status, "ready"), isNull(media.deletedAt), ...(audience === "patient" ? [eq(media.visibleToPatient, true)] : [])))
    .orderBy(desc(media.createdAt));
}

export async function getCheckIns(db: Db, patientId: string) {
  return db
    .select({ c: checkIns, versionNumber: planVersions.versionNumber, reviewedByName: users.name })
    .from(checkIns)
    .leftJoin(planVersions, eq(planVersions.id, checkIns.planVersionId))
    .leftJoin(users, eq(users.id, checkIns.reviewedBy))
    .where(eq(checkIns.patientId, patientId))
    .orderBy(desc(checkIns.activityDate), desc(checkIns.createdAt));
}

export async function getAssignments(db: Db, versionId: string) {
  return db.select().from(exerciseAssignments).where(eq(exerciseAssignments.planVersionId, versionId)).orderBy(exerciseAssignments.position);
}

export async function getCompletions(db: Db, patientId: string, sinceDate?: string) {
  const rows = await db
    .select({ e: completionEntries, name: exerciseAssignments.name, versionNumber: planVersions.versionNumber })
    .from(completionEntries)
    .innerJoin(exerciseAssignments, eq(exerciseAssignments.id, completionEntries.assignmentId))
    .innerJoin(planVersions, eq(planVersions.id, completionEntries.planVersionId))
    .where(eq(completionEntries.patientId, patientId))
    .orderBy(desc(completionEntries.sessionDate));
  return sinceDate ? rows.filter((r) => r.e.sessionDate >= sinceDate) : rows;
}

export async function getMeasures(db: Db, patientId: string) {
  const selected = await db
    .select({ def: measureDefinitions })
    .from(patientMeasures)
    .innerJoin(measureDefinitions, eq(measureDefinitions.id, patientMeasures.definitionId))
    .where(eq(patientMeasures.patientId, patientId));
  const entries = await db
    .select({ e: measureEntries, enteredByName: users.name })
    .from(measureEntries)
    .innerJoin(users, eq(users.id, measureEntries.enteredBy))
    .where(eq(measureEntries.patientId, patientId))
    .orderBy(measureEntries.recordedOn, measureEntries.createdAt);
  const allDefs = await db.select().from(measureDefinitions);
  return { selected: selected.map((s) => s.def), entries, allDefs };
}

export async function getMilestones(db: Db, patientId: string) {
  return db.select().from(milestones).where(and(eq(milestones.patientId, patientId), ne(milestones.status, "replaced"))).orderBy(desc(milestones.createdAt));
}

export async function getGoals(db: Db, patientId: string) {
  return db.select().from(goals).where(eq(goals.patientId, patientId)).orderBy(goals.createdAt);
}

export async function getOpenDrafts(db: Db, patientId: string) {
  return db
    .select({ id: planDrafts.id, kind: planDrafts.kind, updatedAt: planDrafts.updatedAt, visitDate: visits.visitDate, visitId: planDrafts.visitId })
    .from(planDrafts)
    .leftJoin(visits, eq(visits.id, planDrafts.visitId))
    .where(and(eq(planDrafts.patientId, patientId), eq(planDrafts.status, "draft")))
    .orderBy(desc(planDrafts.updatedAt));
}

export async function mediaByIds(db: Db, patientId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.select({ id: media.id, title: media.title, mimeType: media.mimeType }).from(media).where(and(eq(media.patientId, patientId), inArray(media.id, ids), eq(media.status, "ready"), isNull(media.deletedAt)));
}

export { careTeam };
