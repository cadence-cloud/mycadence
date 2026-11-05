import type { PlanChangeSummary, PlanContent, PlanItem } from "@/lib/plan-types";
import { WEEKDAYS } from "@/lib/plan-types";
import { formatDosage } from "@/lib/plan-logic";
import { Badge } from "./ui";

export function frequencyText(i: Pick<PlanItem, "frequency" | "scheduleDays">): string | null {
  if (i.scheduleDays?.length) {
    if (i.scheduleDays.length === 7) return "Every day";
    return WEEKDAYS.filter((w) => i.scheduleDays!.includes(w.key)).map((w) => w.label).join(", ");
  }
  return i.frequency?.trim() || null;
}

/** Groups consecutive items by circuit name, preserving order. */
export function groupByCircuit<T extends { circuit?: string | null }>(items: T[]): { circuit: string | null; items: T[] }[] {
  const out: { circuit: string | null; items: T[] }[] = [];
  for (const i of items) {
    const c = i.circuit?.trim() || null;
    const last = out[out.length - 1];
    if (last && last.circuit === c) last.items.push(i);
    else out.push({ circuit: c, items: [i] });
  }
  return out;
}

export function ExerciseCard({ item, mediaHref, action }: { item: PlanItem; mediaHref?: string | null; action?: React.ReactNode }) {
  const dosage = formatDosage(item.dosage);
  const freq = frequencyText(item);
  return (
    <article className="rounded-xl border border-sand-200 bg-white p-4">
      {item.circuit && <p className="eyebrow mb-0.5">{item.circuit}</p>}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-ink">{item.name}</h4>
        {item.isNew && <Badge tone="lime">New</Badge>}
      </div>
      <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[15px] sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Dosage</dt>
        <dd className={dosage ? "font-medium" : "italic text-muted"}>{dosage ?? "Not specified — ask your PT"}</dd>
        <dt className="text-muted">How often</dt>
        <dd className={freq ? "font-medium" : "italic text-muted"}>{freq ?? "Not specified — ask your PT"}</dd>
      </dl>
      {item.cues && <p className="mt-2 rounded-lg bg-pine-50 px-3 py-2 text-[15px] text-pine-950"><span className="font-semibold">Cue: </span>{item.cues}</p>}
      {item.description && <p className="mt-2 text-sm text-muted">{item.description}</p>}
      {mediaHref && (
        <a href={mediaHref} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-pine-800 underline">
          Watch your video
        </a>
      )}
      {action}
    </article>
  );
}

export function PlanItemsView({ items, mediaHref }: { items: PlanItem[]; mediaHref?: (i: PlanItem) => string | null }) {
  if (!items.length) return <p className="text-muted">No exercises in this plan.</p>;
  return (
    <div className="space-y-4">
      {groupByCircuit(items).map((g, gi) => (
        <div key={gi}>
          {g.circuit && <p className="eyebrow mb-2">{g.circuit}</p>}
          <div className="space-y-2">
            {g.items.map((i) => (
              <ExerciseCard key={i.key} item={i} mediaHref={mediaHref?.(i)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChangeSummary({ s }: { s: PlanChangeSummary | null }) {
  if (!s) return null;
  const parts = [
    ...s.added.map((n) => ({ t: "Added", n })),
    ...s.changed.map((c) => ({ t: "Changed", n: `${c.name} (${c.fields.join(", ")})` })),
    ...s.removed.map((n) => ({ t: "Removed", n })),
  ];
  if (!parts.length && !s.runningChanged) return <p className="text-sm text-muted">No exercise changes from the previous plan.</p>;
  return (
    <ul className="space-y-1 text-[15px]">
      {parts.map((p, i) => (
        <li key={i} className="flex gap-2">
          <Badge tone={p.t === "Added" ? "lime" : p.t === "Removed" ? "neutral" : "blue"}>{p.t}</Badge>
          <span>{p.n}</span>
        </li>
      ))}
      {s.runningChanged && (
        <li className="flex gap-2">
          <Badge tone="blue">Changed</Badge>
          <span>Running guidance</span>
        </li>
      )}
    </ul>
  );
}

/** Patient-facing full plan, used in the PT preview and patient views. */
export function PlanFull({ content, mediaHref }: { content: PlanContent; mediaHref?: (i: PlanItem) => string | null }) {
  return (
    <div className="space-y-5">
      {content.recap && (
        <section>
          <h3 className="eyebrow mb-1">Visit recap</h3>
          <p className="whitespace-pre-line text-[15px] leading-relaxed">{content.recap}</p>
        </section>
      )}
      <section>
        <h3 className="eyebrow mb-2">Exercises</h3>
        <PlanItemsView items={content.items} mediaHref={mediaHref} />
      </section>
      {content.runningGuidance && (
        <section>
          <h3 className="eyebrow mb-1">Running guidance</h3>
          <p className="whitespace-pre-line text-[15px] leading-relaxed">{content.runningGuidance}</p>
        </section>
      )}
      {content.nextMilestone && (
        <section>
          <h3 className="eyebrow mb-1">Next milestone</h3>
          <p className="text-[15px] font-medium">{content.nextMilestone}</p>
        </section>
      )}
      {content.reassessNext && (
        <section>
          <h3 className="eyebrow mb-1">At your next visit</h3>
          <p className="text-[15px]">{content.reassessNext}</p>
        </section>
      )}
    </div>
  );
}
