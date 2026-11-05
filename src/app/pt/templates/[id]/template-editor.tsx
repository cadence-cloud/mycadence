"use client";
import { useState, useTransition } from "react";
import type { Dosage, PlanContent, PlanItem } from "@/lib/plan-types";
import { saveTemplate } from "@/app/actions/library";
import { AddExercise, ItemRow } from "@/app/pt/patients/[id]/update/[draftId]/editor";
import { Notice } from "@/components/ui";

export function TemplateEditor(p: { id: string; name: string; description: string; content: PlanContent; library: { id: string; name: string; description: string | null; bodyRegion: string | null }[] }) {
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description);
  const [items, setItems] = useState<PlanItem[]>(p.content.items);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const mut = (f: (l: PlanItem[]) => PlanItem[]) => {
    setItems(f);
    setDirty(true);
    setMsg(null);
  };
  const setItem = (k: string, patch: Partial<PlanItem>) => mut((l) => l.map((i) => (i.key === k ? { ...i, ...patch } : i)));
  const setDosage = (k: string, patch: Partial<Dosage>) => mut((l) => l.map((i) => (i.key === k ? { ...i, dosage: { ...i.dosage, ...patch } } : i)));

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div>
          <label className="label" htmlFor="t-name">Template name</label>
          <input id="t-name" className="input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        </div>
        <div>
          <label className="label" htmlFor="t-desc">Description</label>
          <input id="t-desc" className="input" value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} />
        </div>
      </div>
      <ol className="space-y-2">
        {items.map((it, idx) => (
          <ItemRow
            key={it.key}
            item={it}
            index={idx}
            count={items.length}
            open={open === it.key}
            onToggle={() => setOpen(open === it.key ? null : it.key)}
            onMove={(i, d) => mut((l) => { const c = [...l]; const j = i + d; if (j < 0 || j >= c.length) return l; [c[i], c[j]] = [c[j], c[i]]; return c; })}
            onRemove={(i) => mut((l) => l.filter((_, j) => j !== i))}
            setItem={setItem}
            setDosage={setDosage}
            videos={[]}
            flagged={false}
          />
        ))}
      </ol>
      <AddExercise library={p.library} onAdd={(i) => { const key = crypto.randomUUID(); mut((l) => [...l, { key, dosage: {}, frequency: null, scheduleDays: null, cues: null, circuit: null, patientMediaId: null, isNew: false, ...i }]); setOpen(key); }} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="sticky bottom-4 flex justify-end">
        <button
          className="btn-primary shadow-lg"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const r = await saveTemplate({ id: p.id, name, description, content: { ...p.content, items } });
              if (r.error) setMsg({ tone: "error", text: r.error });
              else {
                setDirty(false);
                setMsg({ tone: "success", text: "Template saved. Existing patient plans are unchanged." });
              }
            })
          }
        >
          {pending ? "Saving…" : dirty ? "Save template" : "Saved"}
        </button>
      </div>
    </div>
  );
}
