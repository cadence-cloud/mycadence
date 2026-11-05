import { shownName } from "@/server/names";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { exercises, media, planDrafts, planVersions, visits, users } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { canAccessPatient } from "@/server/authz";
import { currentVersion } from "@/server/plans";
import { getPatient } from "@/server/patient-data";
import { visibleExercises } from "@/server/library";
import { aiAvailability } from "@/server/extraction";
import { isDemo } from "@/lib/env";
import { ALEX_SAMPLE_EMAIL } from "@/lib/sample-content";
import { VisitUpdateEditor } from "./editor";

export default async function DraftPage({ params, searchParams }: { params: Promise<{ id: string; draftId: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id, draftId } = await params;
  const { step } = await searchParams;
  const user = await requirePageUser(["pt"]);
  const db = await getDb();
  if (!(await canAccessPatient(db, user, id))) notFound();
  const [draft] = await db.select().from(planDrafts).where(and(eq(planDrafts.id, draftId), eq(planDrafts.patientId, id))).limit(1);
  if (!draft) notFound();
  if (draft.status === "published") {
    const [v] = await db.select().from(planVersions).where(eq(planVersions.draftId, draft.id)).limit(1);
    redirect(`/pt/patients/${id}?tab=history&published=${v?.versionNumber ?? ""}`);
  }
  if (draft.status === "discarded") redirect(`/pt/patients/${id}`);
  const patient = (await getPatient(db, id))!;
  const [visit] = draft.visitId ? await db.select({ id: visits.id, visitDate: visits.visitDate, ptName: shownName }).from(visits).innerJoin(users, eq(users.id, visits.ptUserId)).where(eq(visits.id, draft.visitId)).limit(1) : [];
  const base = draft.basePlanVersionId ? (await db.select().from(planVersions).where(eq(planVersions.id, draft.basePlanVersionId)).limit(1))[0] : null;
  const latest = await currentVersion(db, id);
  const library = (await visibleExercises(db, user.id)).map((e) => ({ id: e.id, name: e.name, description: e.description, bodyRegion: e.bodyRegion, mine: e.ownerId === user.id }));
  const patientMedia = await db
    .select({ id: media.id, title: media.title, mimeType: media.mimeType, planItemKey: media.planItemKey, draftId: media.draftId, visitId: media.visitId, category: media.category })
    .from(media)
    .where(and(eq(media.patientId, id), eq(media.status, "ready"), isNull(media.deletedAt), or(eq(media.draftId, draftId), draft.visitId ? eq(media.visitId, draft.visitId) : eq(media.category, "patient_footage"))));
  const [editor] = draft.lastEditedBy ? await db.select({ name: shownName }).from(users).where(eq(users.id, draft.lastEditedBy)).limit(1) : [];
  const ai = aiAvailability();

  return (
    <VisitUpdateEditor
      patient={{ id, firstName: patient.firstName, lastName: patient.lastName }}
      draft={{
        id: draft.id,
        kind: draft.kind,
        revision: draft.revision,
        content: draft.content,
        flags: draft.reviewFlags,
        originalPastedText: draft.originalPastedText,
        extractionSource: draft.extractionSource,
        correctionNote: draft.correctionNote,
        updatedAt: draft.updatedAt.toISOString(),
        lastEditedByName: editor?.name ?? null,
        startedFrom: draft.startedFrom,
      }}
      visit={visit ?? null}
      base={base ? { versionNumber: base.versionNumber, content: base.content } : null}
      newerVersionNumber={latest && latest.id !== draft.basePlanVersionId ? latest.versionNumber : null}
      library={library}
      media={patientMedia}
      openPaste={step === "paste" || (draft.startedFrom === "paste" && !draft.originalPastedText)}
      extraction={{ ai: ai.available, reason: ai.reason ?? null, demo: isDemo() }}
      sampleEmail={isDemo() && patient.firstName === "Alex" && patient.isDemo ? ALEX_SAMPLE_EMAIL : null}
    />
  );
}
