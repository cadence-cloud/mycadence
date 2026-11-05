"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Dosage, PlanContent, PlanItem, ReviewFlag, Weekday } from "@/lib/plan-types";
import { WEEKDAYS } from "@/lib/plan-types";
import { diffPlans, formatDosage, reviewChecks } from "@/lib/plan-logic";
import { formatDate } from "@/lib/time";
import { ChangeSummary, PlanFull, frequencyText } from "@/components/plan-view";
import { MediaUploader } from "@/components/media-uploader";
import { Badge, Notice } from "@/components/ui";

type SaveState = { kind: "idle" | "saving" | "saved" | "unsaved" | "offline" | "conflict" | "error"; at?: string; message?: string };

interface Props {
  patient: { id: string; firstName: string; lastName: string };
  draft: {
    id: string;
    kind: "visit_update" | "correction";
    revision: number;
    content: PlanContent;
    flags: ReviewFlag[];
    originalPastedText: string | null;
    extractionSource: string | null;
    correctionNote: string | null;
    updatedAt: string;
    lastEditedByName: string | null;
    startedFrom: string | null;
  };
  visit: { id: string; visitDate: string; ptName: string } | null;
  base: { versionNumber: number; content: PlanContent } | null;
  newerVersionNumber: number | null;
  library: { id: string; name: string; description: string | null; bodyRegion: string | null }[];
  media: { id: string; title: string; mimeType: string; planItemKey: string | null; draftId: string | null; visitId: string | null; category: string }[];
  openPaste: boolean;
  extraction: { ai: boolean; reason: string | null; demo: boolean };
  sampleEmail: string | null;
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);

export function VisitUpdateEditor(p: Props) {
  const router = useRouter();
  const [content, setContent] = useState<PlanContent>(p.draft.content);
  const [serverFlags, setServerFlags] = useState<ReviewFlag[]>(p.draft.flags);
  const [correctionNote, setCorrectionNote] = useState(p.draft.correctionNote ?? "");
  const [save, setSave] = useState<SaveState>({ kind: "saved", at: p.draft.updatedAt });
  const [original, setOriginal] = useState(p.draft.originalPastedText);
  const [source, setSource] = useState(p.draft.extractionSource);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ item: PlanItem; index: number } | null>(null);
  const [mediaList, setMediaList] = useState(p.media);

  const revision = useRef(p.draft.revision);
  const latest = useRef({ content, correctionNote });
  latest.current = { content, correctionNote };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const queued = useRef(false);
  const first = useRef(true);
  const blocked = useRef(false); // conflict: stop autosaving until reload
  const lastSaved = useRef(JSON.stringify([p.draft.content, p.draft.correctionNote ?? ""]));

  const flush = useCallback(async (): Promise<boolean> => {
    if (blocked.current) return false;
    if (inFlight.current) {
      queued.current = true;
      return inFlight.current;
    }
    if (timer.current) clearTimeout(timer.current);
    const run = (async () => {
      setSave({ kind: "saving" });
      const sent = latest.current;
      try {
        const res = await fetch(`/api/drafts/${p.draft.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: revision.current, content: sent.content, correctionNote: p.draft.kind === "correction" ? sent.correctionNote : undefined }),
        });
        const j = await res.json();
        if (res.status === 409) {
          blocked.current = true;
          setSave({ kind: "conflict", message: `Someone${j.lastEditedBy ? "" : ""} saved this draft in another window. Reload to see the latest before continuing.` });
          return false;
        }
        if (!res.ok) {
          setSave({ kind: "error", message: j.message ?? j.error ?? "Couldn't save." });
          return false;
        }
        revision.current = j.revision;
        lastSaved.current = JSON.stringify([sent.content, sent.correctionNote]);
        setServerFlags(j.flags);
        setSave({ kind: "saved", at: j.updatedAt });
        return true;
      } catch {
        setSave({ kind: "offline", message: "You're offline. Changes are kept on this screen and will save when you reconnect." });
        timer.current = setTimeout(() => void flush(), 5000);
        return false;
      }
    })();
    inFlight.current = run;
    const ok = await run;
    inFlight.current = null;
    if (queued.current && !blocked.current) {
      queued.current = false;
      return flush();
    }
    return ok;
  }, [p.draft.id, p.draft.kind]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (blocked.current) return;
    if (JSON.stringify([content, correctionNote]) === lastSaved.current) return;
    setSave({ kind: "unsaved" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  }, [content, correctionNote, flush]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (save.kind === "unsaved" || save.kind === "saving" || save.kind === "offline") e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [save.kind]);

  const set = <K extends keyof PlanContent>(k: K, v: PlanContent[K]) => setContent((c) => ({ ...c, [k]: v }));
  const setItem = (key: string, patch: Partial<PlanItem>) => setContent((c) => ({ ...c, items: c.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const setDosage = (key: string, patch: Partial<Dosage>) => setContent((c) => ({ ...c, items: c.items.map((i) => (i.key === key ? { ...i, dosage: { ...i.dosage, ...patch } } : i)) }));
  const move = (idx: number, dir: -1 | 1) =>
    setContent((c) => {
      const items = [...c.items];
      const j = idx + dir;
      if (j < 0 || j >= items.length) return c;
      [items[idx], items[j]] = [items[j], items[idx]];
      return { ...c, items };
    });
  const remove = (idx: number) => {
    setRemoved({ item: content.items[idx], index: idx });
    setContent((c) => ({ ...c, items: c.items.filter((_, i) => i !== idx) }));
  };
  const undoRemove = () => {
    if (!removed) return;
    setContent((c) => {
      const items = [...c.items];
      items.splice(removed.index, 0, removed.item);
      return { ...c, items };
    });
    setRemoved(null);
  };
  const addItem = (item: Partial<PlanItem> & { name: string }) => {
    const key = newKey();
    setContent((c) => ({ ...c, items: [...c.items, { key, dosage: {}, frequency: null, scheduleDays: null, cues: null, circuit: null, patientMediaId: null, isNew: true, ...item }] }));
    setExpanded(key);
  };

  // Live review flags: deterministic checks + extractor flags that still apply.
  const flags = useMemo(() => {
    const local = reviewChecks(content);
    const extra = serverFlags.filter((f) => {
      if (local.some((l) => l.id === f.id)) return false;
      if (!f.source) return false;
      if (f.itemKey) {
        const it = content.items.find((i) => i.key === f.itemKey);
        if (!it) return false;
        if (f.id.startsWith("dosage") && formatDosage(it.dosage)) return false;
      }
      if (f.id === "strength-link-missing" && content.links.length) return false;
      if (f.id === "milestone-not-found" && content.nextMilestone.trim()) return false;
      if (f.id.startsWith("conditional") && f.source && !content.runningGuidance.includes(f.source)) return true;
      return true;
    });
    return [...local, ...extra];
  }, [content, serverFlags]);
  const needsInput = flags.filter((f) => f.severity === "needs_input");
  const changes = useMemo(() => diffPlans(p.base?.content ?? null, content), [p.base, content]);
  const patientVideos = mediaList.filter((m) => m.category === "patient_footage");

  return (
    <div className="pb-28">
      {/* Sticky header with save status */}
      <div className="sticky top-0 sm:top-16 z-10 -mx-4 mb-4 border-b border-sand-200 bg-paper/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/pt/patients/${p.patient.id}`} className="text-sm font-semibold text-pine-800 hover:underline">
              ← {p.patient.firstName} {p.patient.lastName}
            </Link>
            <p className="truncate text-sm text-muted">
              {p.draft.kind === "correction" ? `Correction of version ${p.base?.versionNumber}` : "Visit update"}
              {p.visit && ` · ${formatDate(p.visit.visitDate, { weekday: "short", month: "short", day: "numeric" })} with ${p.visit.ptName}`}
            </p>
          </div>
          <SaveIndicator s={save} />
        </div>
        <nav aria-label="Update sections" className="mt-1 -mx-1 flex gap-1 overflow-x-auto text-sm">
          {[
            ["paste", "Paste"],
            ["exercises", "Exercises"],
            ["recap", "Recap"],
            ["running", "Running"],
            ["media", "Media"],
            ["milestone", "Milestone"],
            ["review", "Review"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="flex min-h-9 shrink-0 items-center rounded-lg px-2.5 font-medium text-muted hover:bg-sand-100 hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
      </div>

      {save.kind === "conflict" && (
        <div className="mb-4">
          <Notice tone="error" title="This draft changed elsewhere">
            {save.message}{" "}
            <button className="font-semibold underline" onClick={() => window.location.reload()}>Reload draft</button>
          </Notice>
        </div>
      )}
      {p.newerVersionNumber && (
        <div className="mb-4">
          <Notice tone="warn" title={`Version ${p.newerVersionNumber} was published after you started this draft`}>
            This draft was based on {p.base ? `version ${p.base.versionNumber}` : "no plan"}. Review the current plan in history before publishing so you don&apos;t undo someone else&apos;s changes.
          </Notice>
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-6">
        <PastePanel
          draftId={p.draft.id}
          open={p.openPaste}
          revision={revision}
          beforeExtract={flush}
          hasContent={content.items.length > 0 || !!content.recap || !!content.runningGuidance}
          original={original}
          source={source}
          extraction={p.extraction}
          sampleEmail={p.sampleEmail}
          onExtracted={(r) => {
            setContent(r.content);
            setServerFlags(r.flags);
            lastSaved.current = JSON.stringify([r.content, correctionNote]);
            setOriginal(r.original);
            setSource(r.source);
            setSave({ kind: "saved", at: new Date().toISOString() });
          }}
          suppressNextSave={() => {
            first.current = true;
          }}
        />

        {p.draft.kind === "correction" && (
          <section className="card p-4">
            <label className="label" htmlFor="corr-note">What are you correcting? (required, shown to the patient)</label>
            <textarea id="corr-note" className="input min-h-20" value={correctionNote} onChange={(e) => setCorrectionNote(e.target.value)} maxLength={1000} placeholder="e.g. Rows should be 3 × 12, not 3 × 15." />
          </section>
        )}

        {/* Exercises */}
        <section id="exercises" className="scroll-mt-40">
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-lg font-semibold">Exercises <span className="text-muted">({content.items.length})</span></h2>
          </div>
          {removed && (
            <div className="mb-2">
              <Notice tone="info">
                Removed “{removed.item.name}”. <button className="font-semibold underline" onClick={undoRemove}>Undo</button>
              </Notice>
            </div>
          )}
          <ol className="space-y-2">
            {content.items.map((it, idx) => (
              <ItemRow
                key={it.key}
                item={it}
                index={idx}
                count={content.items.length}
                open={expanded === it.key}
                onToggle={() => setExpanded(expanded === it.key ? null : it.key)}
                onMove={move}
                onRemove={remove}
                setItem={setItem}
                setDosage={setDosage}
                videos={patientVideos}
                flagged={flags.some((f) => f.itemKey === it.key && f.severity === "needs_input")}
              />
            ))}
          </ol>
          {content.items.length === 0 && <p className="rounded-xl border border-dashed border-sand-300 p-4 text-center text-muted">No exercises yet. Add from the library or create a custom exercise.</p>}
          <AddExercise library={p.library} onAdd={addItem} />
        </section>

        {/* Recap */}
        <section id="recap" className="scroll-mt-40 card p-4">
          <label htmlFor="recap-t" className="text-lg font-semibold">Visit recap</label>
          <p className="hint mb-2">A few sentences for {p.patient.firstName}: what you worked on and why.</p>
          <textarea id="recap-t" className="input min-h-28" value={content.recap} onChange={(e) => set("recap", e.target.value)} maxLength={5000} />
        </section>

        {/* Running */}
        <section id="running" className="scroll-mt-40 card p-4">
          <label htmlFor="run-t" className="text-lg font-semibold">Running guidance</label>
          <p className="hint mb-2">Write conditions exactly as you mean them (“If it feels good, you can…”). Nothing here changes automatically.</p>
          {p.base?.content.runningGuidance && p.base.content.runningGuidance !== content.runningGuidance && (
            <details className="mb-2 text-sm">
              <summary className="cursor-pointer font-semibold text-pine-800">Previous guidance (v{p.base.versionNumber})</summary>
              <p className="mt-1 rounded-lg bg-sand-50 p-2 text-muted">{p.base.content.runningGuidance}</p>
            </details>
          )}
          <textarea id="run-t" className="input min-h-28" value={content.runningGuidance} onChange={(e) => set("runningGuidance", e.target.value)} maxLength={5000} />
          <div className="mt-4">
            <p className="label">Strength plan links</p>
            <LinksEditor links={content.links} onChange={(l) => set("links", l)} />
          </div>
        </section>

        {/* Media */}
        <section id="media" className="scroll-mt-40 card p-4">
          <h2 className="text-lg font-semibold">Photos, videos & documents</h2>
          <p className="hint mb-3">Uploads go straight to {p.patient.firstName}{p.visit ? ` · ${formatDate(p.visit.visitDate, { month: "short", day: "numeric" })} visit` : ""}. Patient footage is never added to templates or the library.</p>
          {mediaList.length > 0 && (
            <ul className="mb-3 space-y-1 text-[15px]">
              {mediaList.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={m.category === "invoice" ? "neutral" : "green"}>{m.category === "invoice" ? "Invoice" : m.category === "document" ? "Document" : m.mimeType.startsWith("video") ? "Video" : "Photo"}</Badge>
                  <a href={`/api/media/${m.id}`} target="_blank" rel="noopener" className="font-medium text-pine-800 underline">{m.title}</a>
                  {m.planItemKey && content.items.find((i) => i.key === m.planItemKey) && <span className="text-sm text-muted">· {content.items.find((i) => i.key === m.planItemKey)!.name}</span>}
                </li>
              ))}
            </ul>
          )}
          <MediaUploader
            patientId={p.patient.id}
            visitId={p.visit?.id ?? null}
            draftId={p.draft.id}
            exercises={content.items.map((i) => ({ key: i.key, name: i.name }))}
            onUploaded={(m) => {
              setMediaList((l) => [...l, { id: m.id, title: m.title, mimeType: m.mimeType, planItemKey: m.planItemKey, draftId: p.draft.id, visitId: p.visit?.id ?? null, category: m.category }]);
              if (m.planItemKey && m.category === "patient_footage") setItem(m.planItemKey, { patientMediaId: m.id });
            }}
          />
        </section>

        {/* Milestone */}
        <section id="milestone" className="scroll-mt-40 card space-y-3 p-4">
          <div>
            <label htmlFor="ms" className="text-lg font-semibold">Next milestone</label>
            <p className="hint mb-2">Something concrete {p.patient.firstName} is working toward. Avoid predicted dates.</p>
            <input id="ms" className="input" value={content.nextMilestone} onChange={(e) => set("nextMilestone", e.target.value)} maxLength={500} />
          </div>
          <div>
            <label htmlFor="re" className="label">What we&apos;ll reassess at the next visit</label>
            <input id="re" className="input" value={content.reassessNext} onChange={(e) => set("reassessNext", e.target.value)} maxLength={1000} />
          </div>
        </section>

        {/* Review */}
        <ReviewPanel
          patient={p.patient}
          draftId={p.draft.id}
          kind={p.draft.kind}
          content={content}
          flags={flags}
          needsInputCount={needsInput.length}
          changes={changes}
          baseVersion={p.base?.versionNumber ?? null}
          original={original}
          flush={flush}
          revision={revision}
          blocked={save.kind === "conflict"}
          correctionNote={correctionNote}
          onPublished={(n) => router.push(`/pt/patients/${p.patient.id}?published=${n}`)}
        />
        <DiscardDraft patientId={p.patient.id} draftId={p.draft.id} />
      </div>

      {/* Mobile sticky action */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-sand-200 bg-white/95 px-4 py-3 backdrop-blur sm:hidden">
        <a href="#review" className="btn-primary w-full">
          Review & publish{needsInput.length ? ` · ${needsInput.length} to check` : ""}
        </a>
      </div>
    </div>
  );
}

function SaveIndicator({ s }: { s: SaveState }) {
  const text =
    s.kind === "saving" ? "Saving…" : s.kind === "unsaved" ? "Unsaved changes" : s.kind === "saved" ? `Draft saved ${s.at ? new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}` : s.kind === "offline" ? "Offline — will retry" : s.kind === "conflict" ? "Not saved — conflict" : s.kind === "error" ? `Not saved: ${s.message}` : "";
  const tone = s.kind === "saved" ? "text-pine-800" : s.kind === "conflict" || s.kind === "error" ? "text-red-800" : s.kind === "offline" ? "text-amber-800" : "text-muted";
  return (
    <p role="status" aria-live="polite" className={`flex items-center gap-1.5 text-sm font-medium ${tone}`}>
      <span aria-hidden className={`size-2 rounded-full ${s.kind === "saved" ? "bg-lime-600" : s.kind === "conflict" || s.kind === "error" ? "bg-red-600" : "bg-amber-500"}`} />
      {text}
    </p>
  );
}

export function ItemRow({
  item,
  index,
  count,
  open,
  onToggle,
  onMove,
  onRemove,
  setItem,
  setDosage,
  videos,
  flagged,
}: {
  item: PlanItem;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onMove: (i: number, d: -1 | 1) => void;
  onRemove: (i: number) => void;
  setItem: (k: string, p: Partial<PlanItem>) => void;
  setDosage: (k: string, p: Partial<Dosage>) => void;
  videos: { id: string; title: string }[];
  flagged: boolean;
}) {
  const d = item.dosage;
  const dosage = formatDosage(d);
  const freq = frequencyText(item);
  const fid = (s: string) => `${item.key}-${s}`;
  return (
    <li className={`rounded-xl border bg-white ${flagged ? "border-amber-300" : "border-sand-200"}`}>
      <div className="flex items-start gap-2 p-3">
        <div className="flex flex-col">
          <button type="button" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => onMove(index, -1)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-sand-100 disabled:opacity-30">▲</button>
          <button type="button" aria-label={`Move ${item.name} down`} disabled={index === count - 1} onClick={() => onMove(index, 1)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-sand-100 disabled:opacity-30">▼</button>
        </div>
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{item.name || <em className="text-red-800">Unnamed exercise</em>}</span>
            {item.isNew && <Badge tone="lime">New</Badge>}
            {item.circuit && <Badge tone="neutral">{item.circuit}</Badge>}
            {item.patientMediaId && <Badge tone="green">Video</Badge>}
          </span>
          <span className={`block text-sm ${dosage ? "text-ink" : "text-amber-800"}`}>{dosage ?? "Dosage not specified"}</span>
          <span className={`block text-sm ${freq ? "text-muted" : "text-amber-800"}`}>{freq ?? "Frequency not specified"}</span>
          {item.cues && <span className="block truncate text-sm text-muted">Cue: {item.cues}</span>}
        </button>
        <button type="button" onClick={onToggle} className="btn-ghost btn-sm">{open ? "Done" : "Edit"}</button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-sand-200 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={fid("name")}>Name</label>
              <input id={fid("name")} className="input" value={item.name} onChange={(e) => setItem(item.key, { name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor={fid("circuit")}>Circuit / group (optional)</label>
              <input id={fid("circuit")} className="input" value={item.circuit ?? ""} placeholder="e.g. Circuit A" onChange={(e) => setItem(item.key, { circuit: e.target.value || null })} />
            </div>
          </div>
          <fieldset>
            <legend className="label">Dosage — fill only what applies</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Num label="Sets" id={fid("sets")} value={d.sets} onChange={(v) => setDosage(item.key, { sets: v })} />
              <div>
                <Num label={d.repsUnit === "steps" ? "Steps" : "Reps"} id={fid("reps")} value={d.reps} onChange={(v) => setDosage(item.key, { reps: v })} />
                <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={d.repsUnit === "steps"} onChange={(e) => setDosage(item.key, { repsUnit: e.target.checked ? "steps" : null })} /> count steps
                </label>
              </div>
              <Secs label="Duration" id={fid("dur")} value={d.durationSec} onChange={(v) => setDosage(item.key, { durationSec: v })} />
              <Secs label="Hold" id={fid("hold")} value={d.holdSec} onChange={(v) => setDosage(item.key, { holdSec: v })} />
              <Secs label="Rest" id={fid("rest")} value={d.restSec} onChange={(v) => setDosage(item.key, { restSec: v })} />
              <div className="col-span-2 sm:col-span-1">
                <label className="label" htmlFor={fid("res")}>Resistance</label>
                <input id={fid("res")} className="input" value={d.resistance ?? ""} placeholder="e.g. Red band" onChange={(e) => setDosage(item.key, { resistance: e.target.value || null })} />
              </div>
              <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm sm:col-span-1 sm:mt-6">
                <input type="checkbox" className="size-5 accent-pine-800" checked={!!d.perSide} onChange={(e) => setDosage(item.key, { perSide: e.target.checked || null })} /> Each side
              </label>
              <div className="col-span-2 sm:col-span-4">
                <label className="label" htmlFor={fid("note")}>Dosage note (optional)</label>
                <input id={fid("note")} className="input" value={d.note ?? ""} placeholder="e.g. each direction" onChange={(e) => setDosage(item.key, { note: e.target.value || null })} />
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">How often</legend>
            <input aria-label="Frequency" className="input" value={item.frequency ?? ""} placeholder="e.g. daily, 3x/week — leave blank if not decided" onChange={(e) => setItem(item.key, { frequency: e.target.value || null })} />
            <p className="hint">Or pick days. Picking days shows the patient a “Today’s plan”.</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w) => {
                const on = item.scheduleDays?.includes(w.key) ?? false;
                return (
                  <button
                    type="button"
                    key={w.key}
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? (item.scheduleDays ?? []).filter((x) => x !== w.key) : [...(item.scheduleDays ?? []), w.key];
                      setItem(item.key, { scheduleDays: next.length ? (WEEKDAYS.map((x) => x.key).filter((k) => next.includes(k)) as Weekday[]) : null });
                    }}
                    className={`min-h-10 min-w-12 rounded-lg border px-2 text-sm font-semibold ${on ? "border-pine-800 bg-pine-900 text-white" : "border-sand-300 bg-white"}`}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor={fid("cues")}>Technique cues for this patient</label>
            <textarea id={fid("cues")} className="input min-h-16" value={item.cues ?? ""} onChange={(e) => setItem(item.key, { cues: e.target.value || null })} />
          </div>
          {videos.length > 0 && (
            <div>
              <label className="label" htmlFor={fid("vid")}>Patient-specific video or photo</label>
              <select id={fid("vid")} className="input" value={item.patientMediaId ?? ""} onChange={(e) => setItem(item.key, { patientMediaId: e.target.value || null })}>
                <option value="">None</option>
                {videos.map((v) => (
                  <option key={v.id} value={v.id}>{v.title}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 accent-pine-800" checked={!!item.isNew} onChange={(e) => setItem(item.key, { isNew: e.target.checked })} /> Mark as new for the patient
            </label>
            <button type="button" className="btn-danger btn-sm" onClick={() => onRemove(index)}>Remove exercise</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Num({ label, id, value, onChange }: { label: string; id: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" inputMode="numeric" value={value ?? ""} onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, "");
        onChange(v === "" ? null : Math.min(100000, Number(v)));
      }} />
    </div>
  );
}

function Secs({ label, id, value, onChange }: { label: string; id: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const [unit, setUnit] = useState<"s" | "min">(value != null && value >= 60 && value % 60 === 0 ? "min" : "s");
  const shown = value == null ? "" : unit === "min" ? String(value / 60) : String(value);
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex">
        <input id={id} className="input rounded-r-none" inputMode="decimal" value={shown} onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          onChange(v === "" ? null : Math.round(Number(v) * (unit === "min" ? 60 : 1)));
        }} />
        <select aria-label={`${label} unit`} className="rounded-r-xl border border-l-0 border-sand-300 bg-sand-50 px-1 text-sm" value={unit} onChange={(e) => setUnit(e.target.value as "s" | "min")}>
          <option value="s">sec</option>
          <option value="min">min</option>
        </select>
      </div>
    </div>
  );
}

export function AddExercise({ library, onAdd }: { library: Props["library"]; onAdd: (i: Partial<PlanItem> & { name: string }) => void }) {
  const [q, setQ] = useState("");
  const results = q.trim() ? library.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()) || (l.bodyRegion ?? "").toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  return (
    <div className="mt-3 rounded-xl border border-sand-200 bg-sand-50 p-3">
      <label htmlFor="lib-q" className="label">Add exercise</label>
      <input id="lib-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library, or type a new name" autoComplete="off" />
      {q.trim() && (
        <ul className="mt-2 space-y-1">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-lg bg-white px-3 text-left hover:bg-pine-50" onClick={() => { onAdd({ name: r.name, exerciseId: r.id, description: r.description }); setQ(""); }}>
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted">{r.bodyRegion}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="flex min-h-11 w-full items-center rounded-lg px-3 text-left font-semibold text-pine-800 hover:bg-pine-50" onClick={() => { onAdd({ name: q.trim(), exerciseId: null }); setQ(""); }}>
              + Add “{q.trim()}” as a custom exercise for this patient
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function LinksEditor({ links, onChange }: { links: PlanContent["links"]; onChange: (l: PlanContent["links"]) => void }) {
  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input aria-label="Link label" className="input" value={l.label} placeholder="Label" onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <input aria-label="Link URL" className="input" value={l.url} placeholder="https://docs.google.com/…" inputMode="url" onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))} />
          <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(links.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn-secondary btn-sm" onClick={() => onChange([...links, { label: "Strength circuits", url: "" }])}>+ Add link</button>
      <p className="hint">Adding a link does not change who can open the document. Check its sharing settings in Google Docs.</p>
    </div>
  );
}

function PastePanel(props: {
  draftId: string;
  open: boolean;
  revision: React.MutableRefObject<number>;
  beforeExtract: () => Promise<boolean>;
  hasContent: boolean;
  original: string | null;
  source: string | null;
  extraction: Props["extraction"];
  sampleEmail: string | null;
  onExtracted: (r: { content: PlanContent; flags: ReviewFlag[]; original: string; source: string }) => void;
  suppressNextSave: () => void;
}) {
  const [show, setShow] = useState(props.open);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run() {
    setErr(null);
    if (!text.trim()) return setErr("Paste the email text first.");
    if (props.hasContent && !confirm("Replace the current draft content with what's extracted from this text?")) return;
    setBusy(true);
    await props.beforeExtract();
    try {
      const res = await fetch(`/api/drafts/${props.draftId}/extract`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, revision: props.revision.current }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Extraction failed");
      props.revision.current = j.revision;
      props.suppressNextSave();
      props.onExtracted({ content: j.content, flags: j.flags, original: text, source: j.source });
      setNotice(j.notice);
      setShow(false);
      setText("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="paste" className="scroll-mt-40 card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Paste existing instructions</h2>
        {!show && <button type="button" className="btn-secondary btn-sm" onClick={() => setShow(true)}>{props.original ? "Paste again" : "Paste an email"}</button>}
      </div>
      {props.original && !show && (
        <p className="mt-1 text-sm text-muted">
          Draft created from pasted text using {props.source === "rules" ? "the rule-based parser (no AI)" : props.source?.startsWith("ai:") ? `AI extraction (${props.source.slice(3)})` : props.source}. The original is shown beside the preview in Review.
        </p>
      )}
      {notice && <div className="mt-2"><Notice tone="warn">{notice}</Notice></div>}
      {show && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted">
            We&apos;ll pull out exercises, dosages, cues, running guidance, links and next steps into an editable draft. Missing or unclear details are flagged, never filled in. Nothing is sent to the patient until you publish.
          </p>
          <p className="text-xs text-muted">
            Method: {props.extraction.ai ? "AI extraction (server-side), checked against your text" : "rule-based parser — no AI, works offline"}.
            {!props.extraction.ai && props.extraction.reason ? ` ${props.extraction.reason}` : ""}
          </p>
          <label htmlFor="paste-t" className="sr-only">Pasted email text</label>
          <textarea id="paste-t" className="input min-h-56 font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the body of your email here" />
          {err && <p role="alert" className="text-sm font-medium text-red-800">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={run}>{busy ? "Extracting…" : "Create draft from text"}</button>
            {props.sampleEmail && (
              <button type="button" className="btn-secondary" onClick={() => setText(props.sampleEmail!)}>Insert sample email (demo)</button>
            )}
            <button type="button" className="btn-ghost" onClick={() => setShow(false)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ReviewPanel(p: {
  patient: Props["patient"];
  draftId: string;
  kind: "visit_update" | "correction";
  content: PlanContent;
  flags: ReviewFlag[];
  needsInputCount: number;
  changes: ReturnType<typeof diffPlans>;
  baseVersion: number | null;
  original: string | null;
  flush: () => Promise<boolean>;
  revision: React.MutableRefObject<number>;
  blocked: boolean;
  correctionNote: string;
  onPublished: (n: number) => void;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stale, setStale] = useState<number | null>(null);
  const [tplOpen, setTplOpen] = useState(false);

  async function publish(ack = false) {
    setErr(null);
    setBusy(true);
    try {
      const saved = await p.flush();
      if (!saved) throw new Error("Couldn't save the latest changes. Check the save status above.");
      const res = await fetch(`/api/drafts/${p.draftId}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: p.revision.current, acknowledgeNewerVersion: ack, reviewedFlags: reviewed }) });
      const j = await res.json();
      if (j.ok) return p.onPublished(j.versionNumber);
      if (j.reason === "stale_base") return setStale(j.currentVersionNumber);
      throw new Error(j.message ?? j.error ?? "Couldn't publish.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="review" className="scroll-mt-40 space-y-4">
      <h2 className="text-lg font-semibold">Review & publish</h2>
      {p.flags.length > 0 ? (
        <div className="card p-4">
          <p className="font-semibold">Check before publishing</p>
          <ul className="mt-2 space-y-2">
            {p.flags.map((f) => (
              <li key={f.id} className="flex gap-2 text-[15px]">
                <span className="mt-0.5">{f.severity === "needs_input" ? <Badge tone="amber">Missing</Badge> : <Badge tone="neutral">Check</Badge>}</span>
                <span>
                  {f.message}
                  {f.source && <span className="mt-0.5 block rounded-md bg-sand-50 px-2 py-1 font-mono text-xs text-muted">“{f.source}”</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Notice tone="success">No missing information found.</Notice>
      )}

      <div className="card p-4">
        <p className="eyebrow mb-1">What changed{p.baseVersion ? ` since version ${p.baseVersion}` : ""}</p>
        <ChangeSummary s={p.changes} />
      </div>

      <div className={p.original ? "grid gap-4 lg:grid-cols-2" : ""}>
        {p.original && (
          <div className="card p-4">
            <p className="eyebrow mb-2">Original pasted text</p>
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-muted">{p.original}</pre>
          </div>
        )}
        <div className="card border-pine-200 p-4">
          <p className="eyebrow mb-3">What {p.patient.firstName} will see</p>
          {p.kind === "correction" && p.correctionNote && <div className="mb-3"><Notice tone="info" title="Correction">{p.correctionNote}</Notice></div>}
          <PlanFull content={p.content} />
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <label className="flex items-start gap-3 text-[15px]">
          <input type="checkbox" className="mt-0.5 size-5 accent-pine-800" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          <span>
            I&apos;ve reviewed the patient-facing preview{p.needsInputCount ? ` and the ${p.needsInputCount} missing item${p.needsInputCount > 1 ? "s" : ""}. Anything left blank will show as “ask your PT”.` : "."}
          </span>
        </label>
        {stale != null && (
          <Notice tone="warn" title={`Version ${stale} was published while you were editing`}>
            Publishing will make this the new current plan and replace version {stale}. Version {stale} stays in history.
            <div className="mt-2 flex gap-2">
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => publish(true)}>Publish anyway</button>
              <button className="btn-ghost btn-sm" onClick={() => setStale(null)}>Cancel</button>
            </div>
          </Notice>
        )}
        {err && <Notice tone="error">{err}</Notice>}
        <button className="btn-primary w-full" disabled={!reviewed || busy || p.blocked} onClick={() => publish(false)}>
          {busy ? "Publishing…" : p.kind === "correction" ? "Publish correction" : `Publish to ${p.patient.firstName}`}
        </button>
        <p className="text-center text-xs text-muted">Publishing creates a new plan version. Earlier versions stay in history.</p>
      </div>

      <div className="card p-4">
        <button type="button" className="text-sm font-semibold text-pine-800" onClick={() => setTplOpen(!tplOpen)} aria-expanded={tplOpen}>
          {tplOpen ? "−" : "+"} Save these exercises as a reusable template
        </button>
        {tplOpen && <SaveTemplate draftId={p.draftId} flush={p.flush} />}
      </div>
    </section>
  );
}

function SaveTemplate({ draftId, flush }: { draftId: string; flush: () => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [keepCues, setKeepCues] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-3 space-y-2">
      <input className="input" aria-label="Template name" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-pine-800" checked={keepCues} onChange={(e) => setKeepCues(e.target.checked)} /> Include technique cues
      </label>
      <p className="hint">Patient videos, recap, running guidance and milestones are never included.</p>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={async () => {
          await flush();
          const r = await fetch(`/api/drafts/${draftId}/template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, keepCues }) });
          const j = await r.json();
          setMsg(r.ok ? "Template saved." : j.error);
        }}
      >
        Save template
      </button>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}

function DiscardDraft({ patientId, draftId }: { patientId: string; draftId: string }) {
  return (
    <form action={`/pt/patients/${patientId}/update/${draftId}/discard`} method="post" onSubmit={(e) => { if (!confirm("Discard this draft? Nothing has been sent to the patient.")) e.preventDefault(); }} className="text-center">
      <button className="btn-ghost btn-sm text-red-800">Discard draft</button>
    </form>
  );
}
