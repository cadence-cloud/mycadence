/**
 * Visit updates: drafts -> immutable published versions.
 * All functions assume the caller has ALREADY authorized the actor for the patient.
 */
import { and, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { exerciseAssignments, milestones, planDrafts, planTemplates, planVersions, visits } from "@/db/schema";
import { newId } from "@/lib/ids";
import { clonePlan, diffPlans, reviewChecks } from "@/lib/plan-logic";
import { EMPTY_PLAN, type PlanContent } from "@/lib/plan-types";
import { audit } from "./audit";
import { notifyPatient } from "./notify";

const num = z.number().int().min(0).max(100000).nullable().optional();
export const planContentSchema = z.object({
  recap: z.string().max(5000),
  runningGuidance: z.string().max(5000),
  nextMilestone: z.string().max(500),
  reassessNext: z.string().max(1000),
  links: z.array(z.object({ label: z.string().max(200), url: z.string().max(2000) })).max(20),
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        exerciseId: z.string().nullable().optional(),
        name: z.string().max(200),
        description: z.string().max(2000).nullable().optional(),
        circuit: z.string().max(100).nullable().optional(),
        dosage: z.object({
          sets: num,
          reps: num,
          repsUnit: z.enum(["reps", "steps"]).nullable().optional(),
          durationSec: num,
          holdSec: num,
          restSec: num,
          resistance: z.string().max(200).nullable().optional(),
          perSide: z.boolean().nullable().optional(),
          note: z.string().max(300).nullable().optional(),
        }),
        frequency: z.string().max(200).nullable().optional(),
        scheduleDays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).nullable().optional(),
        cues: z.string().max(2000).nullable().optional(),
        patientMediaId: z.string().nullable().optional(),
        isNew: z.boolean().optional(),
      }),
    )
    .max(80),
});

export async function currentVersion(db: Db, patientId: string) {
  const [v] = await db.select().from(planVersions).where(eq(planVersions.patientId, patientId)).orderBy(desc(planVersions.versionNumber)).limit(1);
  return v ?? null;
}

export type StartFrom = { kind: "current_plan" } | { kind: "template"; templateId: string } | { kind: "blank" } | { kind: "paste" };

/** Find or create the visit for a date. Re-opening never creates a duplicate appointment. */
export async function ensureVisit(db: Db, actorId: string, patientId: string, visitDate: string, ptUserId: string) {
  const [existing] = await db.select().from(visits).where(and(eq(visits.patientId, patientId), eq(visits.visitDate, visitDate))).limit(1);
  if (existing) return { visit: existing, created: false };
  const id = newId();
  await db.insert(visits).values({ id, patientId, ptUserId, visitDate, createdBy: actorId }).onConflictDoNothing();
  const [v] = await db.select().from(visits).where(and(eq(visits.patientId, patientId), eq(visits.visitDate, visitDate))).limit(1);
  await audit(db, { actorId, action: "visit.create", entityType: "visit", entityId: v.id, patientId });
  return { visit: v, created: v.id === id };
}

export async function createDraft(db: Db, actorId: string, patientId: string, visitId: string | null, start: StartFrom) {
  // One open visit-update draft per visit: return it instead of creating a second.
  if (visitId) {
    const [open] = await db.select().from(planDrafts).where(and(eq(planDrafts.visitId, visitId), eq(planDrafts.status, "draft"), eq(planDrafts.kind, "visit_update"))).limit(1);
    if (open) return open;
  }
  const base = await currentVersion(db, patientId);
  let content: PlanContent = clonePlan(EMPTY_PLAN);
  if (start.kind === "current_plan" && base) {
    content = clonePlan(base.content);
    content.recap = "";
    content.reassessNext = "";
    content.items = content.items.map((i) => ({ ...i, isNew: false }));
  } else if (start.kind === "template") {
    const [t] = await db.select().from(planTemplates).where(eq(planTemplates.id, start.templateId)).limit(1);
    if (!t) throw new Error("Template not found");
    content = clonePlan(t.content); // deep copy: later template edits never reach this plan
    content.items = content.items.map((i) => ({ ...i, key: newId(), patientMediaId: null }));
  }
  const id = newId();
  const [d] = await db
    .insert(planDrafts)
    .values({
      id,
      patientId,
      visitId,
      basePlanVersionId: base?.id ?? null,
      startedFrom: start.kind === "template" ? `template:${start.templateId}` : start.kind,
      content,
      reviewFlags: reviewChecks(content),
      authorId: actorId,
      lastEditedBy: actorId,
    })
    .returning();
  await audit(db, { actorId, action: "draft.create", entityType: "plan_draft", entityId: id, patientId, meta: { startedFrom: d.startedFrom } });
  return d;
}

export async function createCorrectionDraft(db: Db, actorId: string, versionId: string) {
  const [v] = await db.select().from(planVersions).where(eq(planVersions.id, versionId)).limit(1);
  if (!v) throw new Error("Version not found");
  const latest = await currentVersion(db, v.patientId);
  if (latest?.id !== v.id) throw new Error("Only the current published version can be corrected. Publish a new update instead.");
  const [open] = await db.select().from(planDrafts).where(and(eq(planDrafts.correctionOfVersionId, v.id), eq(planDrafts.status, "draft"))).limit(1);
  if (open) return open;
  const id = newId();
  const [d] = await db
    .insert(planDrafts)
    .values({ id, patientId: v.patientId, visitId: v.visitId, kind: "correction", basePlanVersionId: v.id, correctionOfVersionId: v.id, startedFrom: "correction", content: clonePlan(v.content), reviewFlags: reviewChecks(v.content), authorId: actorId, lastEditedBy: actorId })
    .returning();
  await audit(db, { actorId, action: "draft.create_correction", entityType: "plan_draft", entityId: id, patientId: v.patientId, meta: { correctionOf: v.versionNumber } });
  return d;
}

export type SaveResult =
  | { ok: true; revision: number; updatedAt: string; flags: ReturnType<typeof reviewChecks> }
  | { ok: false; reason: "conflict"; revision: number; lastEditedBy: string | null; updatedAt: string }
  | { ok: false; reason: "not_draft" | "invalid"; message: string };

/** Optimistic concurrency: the save only applies if the caller saw the latest revision. */
export async function saveDraft(db: Db, actorId: string, draftId: string, expectedRevision: number, content: unknown, extra?: { correctionNote?: string | null; visitId?: string | null }): Promise<SaveResult> {
  const parsed = planContentSchema.safeParse(content);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid content" };
  const c = parsed.data as PlanContent;
  const flags = reviewChecks(c);
  const [d] = await db.select().from(planDrafts).where(eq(planDrafts.id, draftId)).limit(1);
  if (!d || d.status !== "draft") return { ok: false, reason: "not_draft", message: "This update has already been published or discarded." };
  // Keep extractor flags that carry source text (e.g. conditional wording) for review.
  const keptExtractorFlags = (d.reviewFlags ?? []).filter((f) => f.source && !flags.some((x) => x.id === f.id) && (!f.itemKey || c.items.some((i) => i.key === f.itemKey && !i.dosage.sets && !i.dosage.reps && !i.dosage.durationSec && !i.dosage.holdSec && !i.dosage.note)));
  const updated = await db
    .update(planDrafts)
    .set({
      content: c,
      reviewFlags: [...flags.filter((f) => !keptExtractorFlags.some((k) => k.id === f.id)), ...keptExtractorFlags],
      revision: sql`${planDrafts.revision} + 1`,
      lastEditedBy: actorId,
      updatedAt: new Date(),
      ...(extra?.correctionNote !== undefined ? { correctionNote: extra.correctionNote } : {}),
    })
    .where(and(eq(planDrafts.id, draftId), eq(planDrafts.revision, expectedRevision), eq(planDrafts.status, "draft")))
    .returning({ revision: planDrafts.revision, updatedAt: planDrafts.updatedAt, reviewFlags: planDrafts.reviewFlags });
  if (!updated.length) {
    const [cur] = await db.select().from(planDrafts).where(eq(planDrafts.id, draftId)).limit(1);
    return { ok: false, reason: "conflict", revision: cur.revision, lastEditedBy: cur.lastEditedBy, updatedAt: cur.updatedAt.toISOString() };
  }
  return { ok: true, revision: updated[0].revision, updatedAt: updated[0].updatedAt.toISOString(), flags: updated[0].reviewFlags };
}

export type PublishResult =
  | { ok: true; versionId: string; versionNumber: number; alreadyPublished?: boolean }
  | { ok: false; reason: "stale_base"; currentVersionNumber: number }
  | { ok: false; reason: "conflict" | "invalid" | "not_draft"; message: string };

/**
 * Publish a draft. Safe to call twice: a unique index on draft_id plus the
 * status check means a double-click returns the same version instead of a duplicate.
 */
export async function publishDraft(db: Db, actorId: string, draftId: string, opts: { expectedRevision: number; acknowledgeNewerVersion?: boolean }): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Row lock so two publishes of the same draft serialize.
    const [d] = await t.select().from(planDrafts).where(eq(planDrafts.id, draftId)).for("update").limit(1);
    if (!d) return { ok: false, reason: "invalid", message: "Draft not found" } as const;
    if (d.status === "published") {
      const [v] = await t.select().from(planVersions).where(eq(planVersions.draftId, d.id)).limit(1);
      return { ok: true, versionId: v.id, versionNumber: v.versionNumber, alreadyPublished: true } as const;
    }
    if (d.status !== "draft") return { ok: false, reason: "not_draft", message: "This draft was discarded." } as const;
    if (d.revision !== opts.expectedRevision) return { ok: false, reason: "conflict", message: "This draft changed in another window. Reload to review the latest version before publishing." } as const;
    const items = d.content.items;
    if (items.some((i) => !i.name.trim())) return { ok: false, reason: "invalid", message: "Every exercise needs a name." } as const;
    if (d.kind === "correction" && !d.correctionNote?.trim()) return { ok: false, reason: "invalid", message: "Add a short note explaining the correction." } as const;
    if (d.content.links.some((l) => !/^https:\/\//i.test(l.url))) return { ok: false, reason: "invalid", message: "Links must start with https://" } as const;

    const [latest] = await t.select().from(planVersions).where(eq(planVersions.patientId, d.patientId)).orderBy(desc(planVersions.versionNumber)).limit(1);
    if ((latest?.id ?? null) !== (d.basePlanVersionId ?? null) && !opts.acknowledgeNewerVersion) {
      return { ok: false, reason: "stale_base", currentVersionNumber: latest?.versionNumber ?? 0 } as const;
    }
    const [{ n }] = await t.select({ n: max(planVersions.versionNumber) }).from(planVersions).where(eq(planVersions.patientId, d.patientId));
    const versionNumber = (n ?? 0) + 1;
    const versionId = newId();
    await t.insert(planVersions).values({
      id: versionId,
      patientId: d.patientId,
      visitId: d.visitId,
      draftId: d.id,
      versionNumber,
      content: d.content,
      changeSummary: diffPlans(latest?.content ?? null, d.content),
      supersedesVersionId: latest?.id ?? null,
      correctionOfVersionId: d.correctionOfVersionId,
      correctionNote: d.correctionNote,
      publishedBy: actorId,
    });
    if (items.length) {
      await t.insert(exerciseAssignments).values(
        items.map((i, idx) => ({
          id: newId(),
          planVersionId: versionId,
          patientId: d.patientId,
          itemKey: i.key,
          exerciseId: i.exerciseId ?? null,
          name: i.name,
          position: idx,
          circuit: i.circuit ?? null,
          dosage: i.dosage as Record<string, unknown>,
          frequency: i.frequency ?? null,
          scheduleDays: i.scheduleDays ?? null,
          cues: i.cues ?? null,
          patientMediaId: i.patientMediaId ?? null,
        })),
      );
    }
    await t.update(planDrafts).set({ status: "published", updatedAt: new Date() }).where(eq(planDrafts.id, d.id));
    // Milestone: replace the previous upcoming one if the text changed.
    const ms = d.content.nextMilestone.trim();
    const [up] = await t.select().from(milestones).where(and(eq(milestones.patientId, d.patientId), eq(milestones.status, "upcoming"))).orderBy(desc(milestones.createdAt)).limit(1);
    if (ms && up?.title !== ms) {
      if (up) await t.update(milestones).set({ status: "replaced" }).where(eq(milestones.id, up.id));
      await t.insert(milestones).values({ id: newId(), patientId: d.patientId, title: ms, planVersionId: versionId, createdBy: actorId });
    }
    await audit(t, { actorId, action: d.kind === "correction" ? "plan.publish_correction" : "plan.publish", entityType: "plan_version", entityId: versionId, patientId: d.patientId, meta: { versionNumber, items: items.length } });
    await notifyPatient(t, d.patientId, "plan_published");
    return { ok: true, versionId, versionNumber } as const;
  });
}

export async function discardDraft(db: Db, actorId: string, draftId: string) {
  const [d] = await db.update(planDrafts).set({ status: "discarded", updatedAt: new Date() }).where(and(eq(planDrafts.id, draftId), eq(planDrafts.status, "draft"))).returning();
  if (d) await audit(db, { actorId, action: "draft.discard", entityType: "plan_draft", entityId: draftId, patientId: d.patientId });
  return !!d;
}

export async function openDrafts(db: Db, patientIds: string[]) {
  if (!patientIds.length) return [];
  return db
    .select()
    .from(planDrafts)
    .where(and(eq(planDrafts.status, "draft"), sql`${planDrafts.patientId} in ${patientIds}`))
    .orderBy(desc(planDrafts.updatedAt));
}

