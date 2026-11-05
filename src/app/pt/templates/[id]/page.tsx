import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { exercises, planTemplates } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { archiveTemplate } from "@/app/actions/library";
import { BackLink } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { TemplateEditor } from "./template-editor";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser(["pt"]);
  const { id } = await params;
  const db = await getDb();
  const [t] = await db.select().from(planTemplates).where(and(eq(planTemplates.id, id), isNull(planTemplates.archivedAt))).limit(1);
  if (!t) notFound();
  const library = await db.select({ id: exercises.id, name: exercises.name, description: exercises.description, bodyRegion: exercises.bodyRegion }).from(exercises).where(isNull(exercises.archivedAt)).orderBy(exercises.name);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink href="/pt/templates">Templates</BackLink>
      <TemplateEditor id={t.id} name={t.name} description={t.description ?? ""} content={t.content} library={library} />
      <form action={archiveTemplate} className="text-center">
        <input type="hidden" name="id" value={t.id} />
        <SubmitButton className="btn-ghost btn-sm text-red-800" pendingText="Archiving…">Archive template</SubmitButton>
      </form>
    </div>
  );
}
