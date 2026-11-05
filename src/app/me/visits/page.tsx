import { getDb } from "@/db";
import { requirePageUser } from "@/server/session";
import { patientIdForUser } from "@/server/authz";
import { getMedia, getVersions, getVisits } from "@/server/patient-data";
import { Badge, Card, EmptyState } from "@/components/ui";
import { ChangeSummary, PlanFull } from "@/components/plan-view";
import { MediaTile } from "@/components/media-tile";
import { formatDate } from "@/lib/time";

export default async function MyVisits() {
  const user = await requirePageUser(["patient"]);
  const db = await getDb();
  const pid = (await patientIdForUser(db, user.id))!;
  const [visits, versions, media] = await Promise.all([getVisits(db, pid), getVersions(db, pid), getMedia(db, pid, "patient")]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">My visits</h1>
      {visits.length === 0 && <EmptyState title="No visits yet" body="After each visit, your PT's update will appear here." />}
      {visits.map((v) => {
        const vv = versions.filter((x) => x.visitId === v.id);
        const docs = media.filter((m) => m.visitId === v.id && (m.category === "invoice" || m.category === "document"));
        const footage = media.filter((m) => m.visitId === v.id && m.category === "patient_footage");
        const latest = vv[0];
        return (
          <Card key={v.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{formatDate(v.visitDate, { weekday: "long", month: "long", day: "numeric" })}</h2>
                <p className="text-sm text-muted">With {v.ptName}</p>
              </div>
              {vv.length > 0 && <Badge tone="green">Plan updated</Badge>}
            </div>
            {latest ? (
              <>
                {latest.correctionNote && <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-sm"><span className="font-semibold">Corrected: </span>{latest.correctionNote}</p>}
                {latest.content.recap && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{latest.content.recap}</p>}
                {latest.changeSummary && (
                  <div className="mt-3">
                    <p className="mb-1 text-sm font-semibold">What changed</p>
                    <ChangeSummary s={latest.changeSummary} />
                  </div>
                )}
                <details className="mt-3">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-pine-800">See the full plan from this visit</summary>
                  <div className="mt-2"><PlanFull content={latest.content} /></div>
                </details>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">No written update for this visit.</p>
            )}
            {footage.length > 0 && <p className="mt-2 text-sm text-muted">{footage.length} photo{footage.length > 1 ? "s" : ""}/video{footage.length > 1 ? "s" : ""} in Photos & videos.</p>}
            {docs.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {docs.map((d) => <MediaTile key={d.id} m={d} />)}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
