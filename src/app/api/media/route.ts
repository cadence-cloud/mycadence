import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { media, planDrafts, visits } from "@/db/schema";
import { requireApiUser } from "@/server/session";
import { canAccessPatient } from "@/server/authz";
import { classifyUpload } from "@/server/storage";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";

const body = z.object({
  patientId: z.string().nullable(),
  visitId: z.string().nullable().optional(),
  draftId: z.string().nullable().optional(),
  planItemKey: z.string().max(100).nullable().optional(),
  exerciseName: z.string().max(200).nullable().optional(),
  category: z.enum(["patient_footage", "general_demo", "document", "invoice"]),
  title: z.string().trim().min(1, "Add a descriptive title").max(200),
  explanation: z.string().max(2000).nullable().optional(),
  mimeType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
  capturedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** Step 1 of an upload: validate and reserve a pending record. Bytes follow via PUT. */
export async function POST(req: Request) {
  const user = await requireApiUser(["pt"]);
  if (!user) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid upload" }, { status: 400 });
  const b = parsed.data;
  const db = await getDb();

  if (b.category === "general_demo") {
    // Library demonstrations must not be tied to (or show) a patient.
    if (b.patientId) return NextResponse.json({ error: "General demonstrations can't be attached to a patient." }, { status: 400 });
  } else {
    if (!b.patientId || !(await canAccessPatient(db, user, b.patientId))) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    if (b.visitId) {
      const [v] = await db.select({ id: visits.id }).from(visits).where(and(eq(visits.id, b.visitId), eq(visits.patientId, b.patientId))).limit(1);
      if (!v) return NextResponse.json({ error: "Visit not found for this patient" }, { status: 400 });
    }
    if (b.draftId) {
      const [d] = await db.select({ id: planDrafts.id }).from(planDrafts).where(and(eq(planDrafts.id, b.draftId), eq(planDrafts.patientId, b.patientId))).limit(1);
      if (!d) return NextResponse.json({ error: "Draft not found for this patient" }, { status: 400 });
    }
  }
  const isDoc = b.category === "document" || b.category === "invoice";
  const cls = classifyUpload(b.mimeType, b.sizeBytes, isDoc ? "document" : "media");
  if (!cls.ok) return NextResponse.json({ error: cls.message }, { status: 415 });

  const id = newId();
  await db.insert(media).values({
    id,
    patientId: b.patientId,
    visitId: b.visitId ?? null,
    draftId: b.draftId ?? null,
    planItemKey: b.planItemKey ?? null,
    exerciseName: b.exerciseName ?? null,
    category: b.category,
    title: b.title,
    explanation: b.explanation ?? null,
    mimeType: b.mimeType,
    sizeBytes: b.sizeBytes,
    storageKey: `${b.patientId ?? "library"}/${id}`,
    status: "pending",
    capturedOn: b.capturedOn ?? null,
    uploadedBy: user.id,
  });
  await audit(db, { actorId: user.id, action: "media.reserve", entityType: "media", entityId: id, patientId: b.patientId, meta: { category: b.category, bytes: b.sizeBytes } });
  return NextResponse.json({ id, uploadUrl: `/api/media/${id}/content` });
}
