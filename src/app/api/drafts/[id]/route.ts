import { NextResponse } from "next/server";
import { draftForPt } from "@/server/draft-access";
import { saveDraft } from "@/server/plans";

/** Autosave. Requires the revision the client last saw (optimistic concurrency). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await draftForPt(id);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.revision !== "number") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const res = await saveDraft(ctx.db, ctx.user.id, id, body.revision, body.content, { correctionNote: typeof body.correctionNote === "string" ? body.correctionNote.slice(0, 1000) : undefined });
  if (res.ok) return NextResponse.json(res);
  return NextResponse.json(res, { status: res.reason === "conflict" ? 409 : res.reason === "invalid" ? 400 : 410 });
}
