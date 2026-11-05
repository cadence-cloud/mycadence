import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { media } from "@/db/schema";
import { requireApiUser } from "@/server/session";
import { canAccessPatient } from "@/server/authz";
import { storage } from "@/server/storage";
import { audit } from "@/server/audit";

/**
 * Authorized file access. No public or permanent URLs: every request needs a
 * valid session and passes the same patient-level authorization as the app.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireApiUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });
  const db = await getDb();
  const [m] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!m || m.deletedAt || m.status !== "ready") return new NextResponse("Not found", { status: 404 });
  if (m.patientId) {
    if (!(await canAccessPatient(db, user, m.patientId))) return new NextResponse("Not found", { status: 404 });
    if (user.role === "patient" && !m.visibleToPatient) return new NextResponse("Not found", { status: 404 });
  } else if (user.role === "admin") {
    return new NextResponse("Not found", { status: 404 });
  }
  const size = await storage().stat(m.storageKey);
  if (size == null) return new NextResponse("File missing", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": m.mimeType,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    // Generic filename: no patient or treatment details.
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="cadence-${m.category === "invoice" ? "invoice" : "file"}-${m.id.slice(0, 8)}${ext(m.mimeType)}"`,
  };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (m.patientId && !range) await audit(db, { actorId: user.id, action: "media.view", entityType: "media", entityId: m.id, patientId: m.patientId });
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = storage().read(m.storageKey, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new NextResponse(Readable.toWeb(storage().read(m.storageKey)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}

/** Cancel a pending upload (uploader) or remove a file (care team). Soft delete keeps the audit trail. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireApiUser(["pt"]);
  if (!user) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const db = await getDb();
  const [m] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const allowed = m.status !== "ready" ? m.uploadedBy === user.id : m.patientId ? await canAccessPatient(db, user, m.patientId) : m.uploadedBy === user.id;
  if (!allowed) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, id));
  await storage().remove(m.storageKey);
  await audit(db, { actorId: user.id, action: m.status === "ready" ? "media.delete" : "media.cancel", entityType: "media", entityId: id, patientId: m.patientId });
  return NextResponse.json({ ok: true });
}

function ext(mime: string) {
  return ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "application/pdf": ".pdf" } as Record<string, string>)[mime] ?? "";
}
