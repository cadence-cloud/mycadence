import { shownName } from "@/server/names";
import Link from "next/link";
import { isNull, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { planTemplates, users } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { createTemplate } from "@/app/actions/library";
import { Card, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { formatDateTime } from "@/lib/time";

export default async function TemplatesPage() {
  await requirePageUser(["pt"]);
  const db = await getDb();
  const list = await db.select({ t: planTemplates, author: shownName }).from(planTemplates).innerJoin(users, eq(users.id, planTemplates.createdBy)).where(isNull(planTemplates.archivedAt)).orderBy(planTemplates.name);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Plan templates</h1>
        <p className="text-muted">Starting points for visit updates. Plans copy a template when you start from it, so editing a template never changes a patient&apos;s existing plan.</p>
      </div>
      <Card>
        <form action={createTemplate} className="flex flex-wrap gap-2">
          <label htmlFor="tn" className="sr-only">New template name</label>
          <input id="tn" name="name" className="input flex-1" placeholder="New template name" />
          <SubmitButton className="btn-primary">Create template</SubmitButton>
        </form>
      </Card>
      {list.length === 0 ? (
        <EmptyState title="No templates yet" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map(({ t, author }) => (
            <li key={t.id}>
              <Link href={`/pt/templates/${t.id}`} className="card block p-4 hover:border-pine-600">
                <p className="font-semibold">{t.name}</p>
                {t.description && <p className="text-sm text-muted">{t.description}</p>}
                <p className="mt-2 text-sm">{t.content.items.map((i) => i.name).join(" · ") || "No exercises yet"}</p>
                <p className="mt-2 text-xs text-muted">{author} · updated {formatDateTime(t.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
