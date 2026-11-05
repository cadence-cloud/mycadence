import { NextResponse } from "next/server";
import { draftForPt } from "@/server/draft-access";
import { discardDraft } from "@/server/plans";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const { id, draftId } = await params;
  const ctx = await draftForPt(draftId);
  if (!ctx || ctx.draft.patientId !== id) return new NextResponse("Not found", { status: 404 });
  await discardDraft(ctx.db, ctx.user.id, draftId);
  return NextResponse.redirect(new URL(`/pt/patients/${id}`, req.url), 303);
}
