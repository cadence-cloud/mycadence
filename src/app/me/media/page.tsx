import { getDb } from "@/db";
import { requirePageUser } from "@/server/session";
import { patientIdForUser } from "@/server/authz";
import { getMedia } from "@/server/patient-data";
import { EmptyState } from "@/components/ui";
import { MediaTile } from "@/components/media-tile";

export default async function MyMedia() {
  const user = await requirePageUser(["patient"]);
  const db = await getDb();
  const pid = (await patientIdForUser(db, user.id))!;
  const rows = await getMedia(db, pid, "patient");
  const footage = rows.filter((r) => r.category === "patient_footage");
  const docs = rows.filter((r) => r.category !== "patient_footage");
  const byEx = new Map<string, typeof footage>();
  for (const f of footage) if (f.exerciseName) byEx.set(f.exerciseName, [...(byEx.get(f.exerciseName) ?? []), f]);
  const compare = [...byEx.entries()].filter(([, l]) => l.length >= 2);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Photos & videos</h1>
        <p className="text-sm text-muted">Private to you and your care team.</p>
      </div>
      {compare.map(([ex, list]) => {
        const s = [...list].sort((a, b) => (a.capturedOn ?? "").localeCompare(b.capturedOn ?? ""));
        return (
          <section key={ex}>
            <h2 className="mb-2 text-lg font-semibold">{ex}: then and now</h2>
            <div className="grid grid-cols-2 gap-3">
              <MediaTile m={s[0]} />
              <MediaTile m={s[s.length - 1]} />
            </div>
          </section>
        );
      })}
      <section>
        <h2 className="mb-2 text-lg font-semibold">From your sessions</h2>
        {footage.length === 0 ? <EmptyState title="Nothing here yet" body="Photos and videos your PT takes during sessions will appear here." /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {footage.map((m) => <div key={m.id} id={`m-${m.id}`} className="scroll-mt-4"><MediaTile m={m} /></div>)}
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Documents & invoices</h2>
        {docs.length === 0 ? <EmptyState title="No documents yet" /> : <div className="grid gap-3 sm:grid-cols-2">{docs.map((m) => <MediaTile key={m.id} m={m} />)}</div>}
      </section>
    </div>
  );
}
