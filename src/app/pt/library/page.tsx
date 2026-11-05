import { and, isNull, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { exercises, media } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { addExercise, archiveExercise } from "@/app/actions/library";
import { Badge, Card, EmptyState, SectionHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { MediaUploader } from "@/components/media-uploader";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePageUser(["pt"]);
  const { q = "" } = await searchParams;
  const db = await getDb();
  const [all, demos] = await Promise.all([
    db.select().from(exercises).where(isNull(exercises.archivedAt)).orderBy(exercises.name),
    db.select({ id: media.id, title: media.title }).from(media).where(and(eq(media.category, "general_demo"), isNull(media.patientId), eq(media.status, "ready"), isNull(media.deletedAt))),
  ]);
  const needle = q.trim().toLowerCase();
  const list = needle ? all.filter((e) => `${e.name} ${e.bodyRegion ?? ""} ${e.description ?? ""}`.toLowerCase().includes(needle)) : all;
  const demoTitle = new Map(demos.map((d) => [d.id, d.title]));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Exercise library</h1>
        <p className="text-muted">Shared across the clinic. Dosage is set per patient, never here. Patient footage never appears in the library.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <form role="search" className="mb-3">
            <label htmlFor="lq" className="sr-only">Search exercises</label>
            <input id="lq" name="q" defaultValue={q} className="input" placeholder="Search by name or body region" />
          </form>
          {list.length === 0 ? (
            <EmptyState title="No exercises match" />
          ) : (
            <ul className="divide-y divide-sand-200">
              {list.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{e.name} {e.isCustom && <Badge tone="neutral">Custom</Badge>}</p>
                    {e.description && <p className="text-sm text-muted">{e.description}</p>}
                    <p className="text-xs text-muted">{e.bodyRegion}{e.demoMediaId ? ` · Demo: ${demoTitle.get(e.demoMediaId) ?? "attached"}` : ""}</p>
                  </div>
                  <form action={archiveExercise}>
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton className="btn-ghost btn-sm" pendingText="…">Archive</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-5">
          <Card>
            <SectionHeader title="Add an exercise" />
            <ActionForm action={addExercise} okText="Added to the library.">
              <div>
                <label className="label" htmlFor="ex-name">Name</label>
                <input id="ex-name" name="name" className="input" required maxLength={200} />
              </div>
              <div>
                <label className="label" htmlFor="ex-desc">Description (optional)</label>
                <textarea id="ex-desc" name="description" className="input min-h-20" maxLength={2000} />
              </div>
              <div>
                <label className="label" htmlFor="ex-region">Body region (optional)</label>
                <input id="ex-region" name="bodyRegion" className="input" maxLength={60} />
              </div>
              {demos.length > 0 && (
                <div>
                  <label className="label" htmlFor="ex-demo">General demonstration (optional)</label>
                  <select id="ex-demo" name="demoMediaId" className="input">
                    <option value="">None</option>
                    {demos.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
              )}
              <SubmitButton>Add exercise</SubmitButton>
            </ActionForm>
          </Card>
          <Card>
            <SectionHeader title="Upload a general demonstration" />
            <p className="mb-3 text-sm text-muted">For footage with no identifiable patient (e.g. a staff member demonstrating). Patient footage belongs in the patient&apos;s record.</p>
            <MediaUploader patientId={null} defaultCategory="general_demo" allowCategories={["general_demo"]} compact />
          </Card>
        </div>
      </div>
    </div>
  );
}
