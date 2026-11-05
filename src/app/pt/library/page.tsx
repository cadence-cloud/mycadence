import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { careAssignments, media, patients } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { canManage, visibleExercises } from "@/server/library";
import { addExercise } from "@/app/actions/library";
import { Card, SectionHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { MediaUploader } from "@/components/media-uploader";
import { LibraryList } from "./library-list";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ lib?: string; patient?: string }> }) {
  const user = await requirePageUser(["pt"]);
  const sp = await searchParams;
  const lib = sp.lib === "shared" ? "shared" : "mine";
  const db = await getDb();
  const [all, demos, myPatients] = await Promise.all([
    visibleExercises(db, user.id),
    db.select({ id: media.id, title: media.title }).from(media).where(and(eq(media.category, "general_demo"), isNull(media.patientId), eq(media.status, "ready"), isNull(media.deletedAt))),
    db
      .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
      .from(patients)
      .innerJoin(careAssignments, and(eq(careAssignments.patientId, patients.id), eq(careAssignments.staffUserId, user.id), isNull(careAssignments.endedAt)))
      .where(isNull(patients.archivedAt))
      .orderBy(patients.lastName, patients.firstName),
  ]);
  const mine = all.filter((e) => e.ownerId === user.id);
  const shared = all.filter((e) => e.ownerId === null);
  const list = lib === "mine" ? mine : shared;
  const demoTitle = new Map(demos.map((d) => [d.id, d.title]));
  const preselect = sp.patient && myPatients.some((p) => p.id === sp.patient) ? sp.patient : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Exercise library</h1>
        <p className="text-muted">Select exercises and add them to a patient&apos;s plan in one step. Dosage is set per patient in the plan.</p>
      </div>
      <nav aria-label="Libraries" className="flex gap-1 border-b border-sand-200">
        {(
          [
            ["mine", `Your library (${mine.length})`],
            ["shared", `Shared library (${shared.length})`],
          ] as const
        ).map(([k, l]) => (
          <Link key={k} href={`/pt/library?lib=${k}${preselect ? `&patient=${preselect}` : ""}`} aria-current={lib === k ? "page" : undefined} className={`flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold ${lib === k ? "border-pine-900 text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {l}
          </Link>
        ))}
      </nav>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <p className="mb-3 text-sm text-muted">
            {lib === "mine" ? "Only you can see your library. Share an exercise to make it available to the whole clinic." : "Everyone at the clinic sees the shared library. Copy an exercise to your library to keep your own version."}
          </p>
          <LibraryList
            lib={lib}
            items={list.map((e) => ({ id: e.id, name: e.name, description: e.description, bodyRegion: e.bodyRegion, demo: e.demoMediaId ? demoTitle.get(e.demoMediaId) ?? "attached" : null, canManage: canManage(e, user.id) }))}
            patients={myPatients.map((p) => ({ id: p.id, name: `${p.lastName}, ${p.firstName}` }))}
            preselectPatient={preselect}
          />
        </Card>
        <div className="space-y-5">
          <Card>
            <SectionHeader title="Add an exercise" />
            <ActionForm action={addExercise} okText="Added.">
              <fieldset>
                <legend className="label">Save to</legend>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["mine", "Your library"],
                      ["shared", "Shared library"],
                    ] as const
                  ).map(([v, l]) => (
                    <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-sand-300 px-3 text-sm has-[:checked]:border-pine-900 has-[:checked]:bg-pine-50 has-[:checked]:font-semibold">
                      <input type="radio" name="where" value={v} defaultChecked={v === lib} className="size-4 accent-pine-900" /> {l}
                    </label>
                  ))}
                </div>
              </fieldset>
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
                <input id="ex-region" name="bodyRegion" className="input" maxLength={60} placeholder="e.g. Foot, Hip, Core" />
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
            <p className="mb-3 text-sm text-muted">For footage with no identifiable patient. Patient footage belongs in the patient&apos;s record and never goes into a library.</p>
            <MediaUploader patientId={null} defaultCategory="general_demo" allowCategories={["general_demo"]} compact />
          </Card>
        </div>
      </div>
    </div>
  );
}

