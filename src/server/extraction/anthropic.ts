/**
 * Optional AI extraction via the Anthropic Messages API.
 * Only reachable through getProvider(), which enforces the PHI gate.
 *
 * The model is asked to TRANSCRIBE, not prescribe. Afterwards we verify every
 * number and frequency against the pasted text and require conditional sentences
 * to survive verbatim; anything that fails is cleared and flagged.
 */
import type { PlanContent, PlanItem, ReviewFlag } from "@/lib/plan-types";
import { extractWithRules, normalizeName, type LibraryRef } from "@/lib/extract/rules";
import type { ExtractionResult } from "./index";

const SYSTEM = `You convert a physical therapist's patient email into JSON for the therapist to review.
Rules:
- Transcribe only. Do not add, infer, prescribe, or change any exercise, dosage, frequency, or progression.
- If a dosage or frequency is not written, use null. Never guess.
- Keep conditional instructions (e.g. "If feeling good, ...") word-for-word in runningGuidance.
- Do not diagnose, clear the patient for activity, or add advice.
Return only JSON: {"recap": string, "items": [{"name": string, "sets": number|null, "reps": number|null, "repsUnit": "reps"|"steps"|null, "durationSec": number|null, "holdSec": number|null, "perSide": boolean|null, "dosageNote": string|null, "frequency": string|null, "cues": string|null, "isNew": boolean}], "runningGuidance": string, "nextMilestone": string, "reassessNext": string, "links": [{"label": string, "url": string}]}`;

interface AiItem {
  name: string;
  sets: number | null;
  reps: number | null;
  repsUnit: "reps" | "steps" | null;
  durationSec: number | null;
  holdSec: number | null;
  perSide: boolean | null;
  dosageNote: string | null;
  frequency: string | null;
  cues: string | null;
  isNew: boolean;
}

export async function anthropicExtract(text: string, library: LibraryRef[]): Promise<ExtractionResult> {
  const model = process.env.AI_MODEL || "claude-sonnet-5-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: text }] }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`AI provider error ${res.status}`);
  const body = (await res.json()) as { content: { type: string; text?: string }[] };
  const raw = body.content.find((c) => c.type === "text")?.text ?? "";
  const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  return verify(text, json, library, model);
}

function verify(source: string, ai: { recap?: string; items?: AiItem[]; runningGuidance?: string; nextMilestone?: string; reassessNext?: string; links?: { label: string; url: string }[] }, library: LibraryRef[], model: string): ExtractionResult {
  const flags: ReviewFlag[] = [];
  const src = source.toLowerCase();
  const numbersInSource = new Set((source.match(/\d+(\.\d+)?/g) ?? []).map(Number));
  const lib = new Map(library.map((l) => [normalizeName(l.name), l]));
  const items: PlanItem[] = (ai.items ?? []).map((a, idx) => {
    const key = `item-ai-${Date.now().toString(36)}-${idx}`;
    const check = (n: number | null, scale = 1) => (n == null ? null : numbersInSource.has(n) || numbersInSource.has(n / scale) ? n : (flags.push({ id: `ai-num-${key}-${n}`, severity: "needs_input", field: "item", itemKey: key, message: `Removed a number (${n}) for “${a.name}” that does not appear in the pasted text.` }), null));
    const freq = a.frequency && src.includes(a.frequency.toLowerCase()) ? a.frequency : null;
    if (a.frequency && !freq) flags.push({ id: `ai-freq-${key}`, severity: "needs_input", field: "item", itemKey: key, message: `Removed a frequency for “${a.name}” that was not in the pasted text.` });
    const hit = lib.get(normalizeName(a.name));
    return {
      key,
      name: a.name,
      exerciseId: hit?.id ?? null,
      description: hit?.description ?? null,
      dosage: { sets: check(a.sets), reps: check(a.reps), repsUnit: a.repsUnit, durationSec: check(a.durationSec, 60), holdSec: check(a.holdSec, 60), perSide: a.perSide, note: a.dosageNote },
      frequency: freq,
      scheduleDays: null,
      cues: a.cues,
      isNew: !!a.isNew,
    };
  });
  const running = ai.runningGuidance ?? "";
  // Conditional sentences from the source must appear verbatim.
  const rules = extractWithRules(source, library);
  for (const f of rules.flags.filter((f) => f.id.startsWith("conditional") && f.source)) {
    if (!running.includes(f.source!)) {
      flags.push({ id: `ai-conditional-${f.id}`, severity: "needs_input", field: "running", message: "A conditional instruction from the email was reworded or dropped. Compare with the original before publishing.", source: f.source });
    } else flags.push(f);
  }
  const content: PlanContent = {
    recap: ai.recap ?? "",
    items,
    runningGuidance: running,
    nextMilestone: ai.nextMilestone ?? "",
    reassessNext: ai.reassessNext ?? "",
    links: [], // external links are not carried into plans
  };
  for (const i of items) {
    const d = i.dosage;
    if (d.sets == null && d.reps == null && d.durationSec == null && d.holdSec == null && !d.note) {
      flags.push({ id: `dosage-${i.key}`, severity: "needs_input", field: "item", itemKey: i.key, message: `Dosage not specified for “${i.name}”. It has been left blank, not filled in.` });
    }
  }
  return { content, flags, source: `ai:${model}` };
}
