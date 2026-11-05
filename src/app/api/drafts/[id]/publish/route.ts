import { NextResponse } from "next/server";
import { draftForPt } from "@/server/draft-access";
import { publishDraft } from "@/server/plans";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await draftForPt(id);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.expectedRevision !== "number") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (body.reviewedFlags !== true) return NextResponse.json({ ok: false, reason: "invalid", message: "Confirm you've reviewed the patient-facing preview." }, { status: 400 });
  const res = await publishDraft(ctx.db, ctx.user.id, id, { expectedRevision: body.expectedRevision, acknowledgeNewerVersion: body.acknowledgeNewerVersion === true });
  return NextResponse.json(res, { status: res.ok ? 200 : res.reason === "stale_base" || res.reason === "conflict" ? 409 : 400 });
}
