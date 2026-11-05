"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToPatientAction, archiveExercise, copyExerciseAction } from "@/app/actions/library";
import { Badge, EmptyState, Notice } from "@/components/ui";

interface Item {
  id: string;
  name: string;
  description: string | null;
  bodyRegion: string | null;
  demo: string | null;
  canManage: boolean;
}

export function LibraryList({ lib, items, patients, preselectPatient }: { lib: "mine" | "shared"; items: Item[]; patients: { id: string; name: string }[]; preselectPatient: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [patientQ, setPatientQ] = useState(preselectPatient ? patients.find((p) => p.id === preselectPatient)?.name ?? "" : "");
  const [patientId, setPatientId] = useState<string | null>(preselectPatient);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const regions = useMemo(() => [...new Set(items.map((i) => i.bodyRegion).filter(Boolean))].sort() as string[], [items]);
  const shown = items.filter((i) => (!region || i.bodyRegion === region) && `${i.name} ${i.description ?? ""} ${i.bodyRegion ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const patientHits = patientQ.trim() && !patientId ? patients.filter((p) => p.name.toLowerCase().includes(patientQ.trim().toLowerCase())).slice(0, 8) : [];
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function add() {
    setErr(null);
    if (!patientId) return setErr("Choose a patient first.");
    start(async () => {
      const r = await addToPatientAction({ patientId, exerciseIds: [...sel] });
      if (r.error) setErr(r.error);
      else if (r.url) router.push(r.url);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="lib-search" className="sr-only">Search exercises</label>
        <input id="lib-search" className="input flex-1" placeholder="Search by name or body region" value={q} onChange={(e) => setQ(e.target.value)} />
        {regions.length > 1 && (
          <select aria-label="Body region" className="input w-auto" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={items.length ? "No exercises match" : lib === "mine" ? "Your library is empty" : "The shared library is empty"} body={lib === "mine" && !items.length ? "Add exercises you use often, or copy them from the shared library." : undefined} />
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-sand-200">
          {shown.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-3">
              <input type="checkbox" id={`sel-${e.id}`} checked={sel.has(e.id)} onChange={() => toggle(e.id)} className="mt-1 size-5 shrink-0 accent-pine-900" />
              <label htmlFor={`sel-${e.id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block font-semibold">{e.name}</span>
                {e.description && <span className="block text-sm text-muted">{e.description}</span>}
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {e.bodyRegion && <Badge tone="neutral">{e.bodyRegion}</Badge>}
                  {e.demo && <Badge tone="blue">Demo video</Badge>}
                </span>
              </label>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <form action={copyExerciseAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="to" value={lib === "mine" ? "shared" : "mine"} />
                  <button className="btn-ghost btn-sm">{lib === "mine" ? "Share with clinic" : "Copy to your library"}</button>
                </form>
                {e.canManage && (
                  <form action={archiveExercise}>
                    <input type="hidden" name="id" value={e.id} />
                    <button className="btn-ghost btn-sm text-muted">Remove</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={`sticky bottom-3 mt-3 rounded-2xl border bg-white p-3 shadow-sm ${sel.size ? "border-pine-900" : "border-sand-200"}`}>
        <p className="text-sm font-semibold">{sel.size ? `${sel.size} selected` : "Select exercises to add them to a patient's plan"}</p>
        {sel.size > 0 && (
          <div className="mt-2 space-y-2">
            <div className="relative">
              <label htmlFor="pt-pick" className="sr-only">Patient</label>
              <input
                id="pt-pick"
                className="input"
                placeholder="Which patient? Start typing a name"
                value={patientQ}
                autoComplete="off"
                onChange={(e) => {
                  setPatientQ(e.target.value);
                  setPatientId(null);
                }}
              />
              {patientHits.length > 0 && (
                <ul className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-64 overflow-auto rounded-xl border border-sand-200 bg-white py-1 shadow">
                  {patientHits.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex min-h-11 w-full items-center px-3 text-left hover:bg-sand-50" onClick={() => { setPatientId(p.id); setPatientQ(p.name); }}>
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {err && <Notice tone="error">{err}</Notice>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={!patientId || pending} onClick={add}>
                {pending ? "Adding…" : `Add ${sel.size} to ${patientId ? patientQ.split(",").reverse().join(" ").trim() : "patient"}'s plan`}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSel(new Set())}>Clear</button>
            </div>
            <p className="hint">Goes into the patient&apos;s open draft (or a new one from their current plan). You set dosage and review before anything is published.</p>
          </div>
        )}
      </div>
    </div>
  );
}
