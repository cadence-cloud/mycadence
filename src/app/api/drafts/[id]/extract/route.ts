import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { exercises, planDrafts, planVersions } from "@/db/schema";
import { normalizeName } from "@/lib/extract/rules";
import type { PlanItem } from "@/lib/plan-types";
import { draftForPt } from "@/server/draft-access";
import { getProvider, mergeFlags } from "@/server/extraction";
import { audit } from "@/server/audit";

/**
 * Turn pasted email text into an editable draft. The original text is stored
 * for side-by-side review; nothing is published.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await draftForPt(id);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { db, user, draft } = ctx;
  if (draft.status !== "draft") return NextResponse.json({ error: "This update is no longer a draft." }, { status: 410 });
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Paste the email text first." }, { status: 400 });
  if (text.length > 20000) return NextResponse.json({ error: "That's longer than we can process (20,000 characters)." }, { status: 400 });
  if (body.revision !== draft.revision) return NextResponse.json({ error: "This draft changed elsewhere. Reload and try again." }, { status: 409 });

  const library = await db.select({ id: exercises.id, name: exercises.name, description: exercises.description }).from(exercises).where(isNull(exercises.archivedAt));
  const provider = getProvider();
  const result = await provider.extract(text, library);
  // Match extracted exercises to the plan this draft is based on, so unchanged
  // exercises keep their identity (and patient video) and "What changed" is accurate.
  const base = draft.basePlanVersionId ? (await db.select().from(planVersions).where(eq(planVersions.id, draft.basePlanVersionId)).limit(1))[0] : null;
  const keyMap = matchToBase(result.content.items, base?.content.items ?? []);
  const items = result.content.items.map((i) => {
    const b = keyMap.get(i.key);
    return b ? { ...i, key: b.key, patientMediaId: b.patientMediaId ?? null } : i;
  });
  let remapped = result.flags.map((f) => {
    const b = f.itemKey ? keyMap.get(f.itemKey) : undefined;
    return b ? { ...f, itemKey: b.key, id: f.id.replace(f.itemKey!, b.key) } : f;
  });
  // "See your strength circuits": the circuit already lives in the current plan,
  // so keep those published exercises (unchanged) rather than dropping them.
  const ref = remapped.find((f) => f.id === "strength-circuits-ref");
  const baseCircuit = (base?.content.items ?? []).filter((b) => b.circuit && !items.some((i) => i.key === b.key));
  if (ref && baseCircuit.length) {
    items.push(...baseCircuit.map((b) => ({ ...b, isNew: false })));
    remapped = remapped.map((f) =>
      f.id === "strength-circuits-ref"
        ? { ...f, severity: "check" as const, message: `The email refers to strength circuits, so the ${baseCircuit.length} circuit exercise${baseCircuit.length > 1 ? "s" : ""} from version ${base!.versionNumber} (${[...new Set(baseCircuit.map((b) => b.circuit))].join(", ")}) were kept unchanged. Edit or remove them if that's not right.` }
        : f,
    );
  }
  const content = { ...result.content, items };
  const flags = mergeFlags(content, remapped);
  const [updated] = await db
    .update(planDrafts)
    .set({ content, reviewFlags: flags, originalPastedText: text, extractionSource: result.source, startedFrom: "paste", revision: sql`${planDrafts.revision} + 1`, lastEditedBy: user.id, updatedAt: new Date() })
    .where(and(eq(planDrafts.id, id), eq(planDrafts.revision, draft.revision)))
    .returning();
  if (!updated) return NextResponse.json({ error: "This draft changed elsewhere. Reload and try again." }, { status: 409 });
  // Audit records the provider and counts only — never the pasted text.
  await audit(db, { actorId: user.id, action: "draft.extract", entityType: "plan_draft", entityId: id, patientId: draft.patientId, meta: { provider: result.source, items: content.items.length, flags: flags.length } });
  return NextResponse.json({ content, flags, revision: updated.revision, source: result.source, notice: result.notice ?? null });
}

function matchToBase(extracted: PlanItem[], base: PlanItem[]) {
  const map = new Map<string, PlanItem>();
  const used = new Set<string>();
  for (const e of extracted) {
    const hit = base.find((b) => !used.has(b.key) && ((e.exerciseId && b.exerciseId === e.exerciseId) || normalizeName(b.name) === normalizeName(e.name)));
    if (hit) {
      used.add(hit.key);
      map.set(e.key, hit);
    }
  }
  return map;
}
