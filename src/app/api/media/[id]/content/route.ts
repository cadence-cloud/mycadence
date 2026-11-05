import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { media } from "@/db/schema";
import { requireApiUser } from "@/server/session";
import { storage } from "@/server/storage";
import { audit } from "@/server/audit";

/** Step 2: stream the bytes. Only the uploader, only while pending. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireApiUser(["pt"]);
  if (!user) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const db = await getDb();
  const [m] = await db.select().from(media).where(and(eq(media.id, id), eq(media.uploadedBy, user.id))).limit(1);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (m.deletedAt) return NextResponse.json({ error: "Upload was cancelled" }, { status: 410 });
  if (m.status === "ready") return NextResponse.json({ ok: true, id }); // idempotent retry
  if (!req.body) return NextResponse.json({ error: "No file received" }, { status: 400 });
  const ct = req.headers.get("content-type")?.split(";")[0];
  if (ct && ct !== m.mimeType && ct !== "application/octet-stream") return NextResponse.json({ error: "File type changed since the upload started" }, { status: 415 });
  try {
    await storage().write(m.storageKey, req.body, m.sizeBytes);
    await db.update(media).set({ status: "ready" }).where(eq(media.id, id));
    await audit(db, { actorId: user.id, action: "media.upload", entityType: "media", entityId: id, patientId: m.patientId });
    return NextResponse.json({ ok: true, id });
  } catch {
    // Marked failed (never shown to anyone). The same record can be retried with another PUT.
    await db.update(media).set({ status: "failed" }).where(eq(media.id, id));
    return NextResponse.json({ error: "Upload interrupted. Check your connection and retry." }, { status: 500 });
  }
}
