import { NextResponse } from "next/server";
import { z } from "zod";
import { planTemplates } from "@/db/schema";
import { draftForPt } from "@/server/draft-access";
import { toTemplateContent } from "@/lib/plan-logic";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";

/** Save the draft's exercises as a shared template. Patient media is always stripped. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await draftForPt(id);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), keepCues: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "Give the template a name." }, { status: 400 });
  if (!ctx.draft.content.items.length) return NextResponse.json({ error: "Add exercises first." }, { status: 400 });
  const tid = newId();
  const content = toTemplateContent(ctx.draft.content, { keepCues: b.data.keepCues });
  content.items = content.items.map((i) => ({ ...i, key: newId() }));
  await ctx.db.insert(planTemplates).values({ id: tid, name: b.data.name, description: b.data.description ?? null, content, createdBy: ctx.user.id });
  await audit(ctx.db, { actorId: ctx.user.id, action: "template.create_from_draft", entityType: "plan_template", entityId: tid });
  return NextResponse.json({ ok: true, id: tid });
}
