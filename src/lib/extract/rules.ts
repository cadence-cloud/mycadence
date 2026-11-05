/**
 * Deterministic "paste existing instructions" parser. No network, no AI.
 *
 * Principles:
 *  - Only structure what is literally present. Never default a dosage or frequency.
 *  - Keep anything we can't structure as verbatim text and flag it.
 *  - Conditional sentences ("If feeling good, …") are kept word-for-word and flagged
 *    so they can never become an unconditional scheduled progression.
 *  - Running-guidance frequency ("every other day") is never copied onto exercises.
 */
import type { Dosage, PlanContent, PlanItem, ReviewFlag } from "../plan-types";

export interface LibraryRef {
  id: string;
  name: string;
  description?: string | null;
}

export interface RulesResult {
  content: PlanContent;
  flags: ReviewFlag[];
}

const BULLET = /^\s*(?:[-*•‣◦·]|\d+[.)])\s+(.+)$/;
const NAME_SPLIT = /\s+[—–-]\s+|\s*[—–]\s*|:\s+/; // spaced hyphen, any em/en dash, or colon
const URL_RE = /https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"]/gi;
const NO_DOSAGE = /^(dosage\s+)?(not\s+specified|unspecified|tbd|to\s+be\s+determined|n\/a|as\s+(shown|discussed|instructed)(\s+in\s+(clinic|session))?)\.?$/i;
const FREQUENCY = /\b(daily|every\s+day|every\s+other\s+day|twice\s+(a|per)\s+(day|week)|once\s+(a|per)\s+(day|week)|\d+\s*(x|×|times)\s*(\/|a|per)?\s*(day|week|wk))\b/i;
const CONDITIONAL = /^(if|when|as\s+long\s+as|once|unless|provided)\b|\bif\s+(you\s+are\s+|you're\s+)?(feeling|it\s+feels|pain|symptoms)/i;
const NEXT_SESSION = /^(at|during|by)\s+(the\s+|your\s+|our\s+)?next\s+(session|visit|appointment)|^next\s+(session|visit|time)\b|we('ll| will)\s+(reassess|re-assess|check|discuss)/i;
const RUNNING = /\b(run|runs|running|jog|jogging|strides?|cross[- ]?train(ing)?|mileage|miles?|km|tempo|easy\s+pace|long\s+run|walk[- ]run|treadmill|bike|swim|elliptical|minutes)\b/i;
const NEW_ADDITION = /\b(new\s+(additions?|exercises?)|newly\s+added|are\s+new|is\s+new|i('ve| have)\s+added|adding)\b/i;
const MILESTONE = /\b(goal|milestone)\b.*\b(by|before|until|next)\b/i;

let counter = 0;
const key = () => `item-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(the|a|an|your)\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

function splitSentences(p: string): string[] {
  return p
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function unitToSeconds(n: number, unit: string): number {
  return /^min/i.test(unit) ? Math.round(n * 60) : Math.round(n);
}

/** Parse "3 × 12 steps each direction" style dosage. Returns leftover text separately. */
export function parseDosage(raw: string): { dosage: Dosage; cue: string | null; structured: boolean } {
  let text = raw.trim().replace(/\.$/, "");
  const dosage: Dosage = {};
  let cue: string | null = null;
  const m = text.match(/^(\d+)\s*(?:x|×|sets?\s+of)\s*(\d+(?:\.\d+)?)/i);
  if (!m) {
    // e.g. "30 seconds", "2 minutes", "10 reps"
    const single = text.match(/^(\d+(?:\.\d+)?)[\s-]*(minutes?|mins?|seconds?|secs?|reps?|steps?)\b(?:[\s-]*(holds?))?/i);
    if (!single) return { dosage: {}, cue: null, structured: false };
    const n = Number(single[1]);
    if (/^(rep|step)/i.test(single[2])) {
      dosage.reps = n;
      dosage.repsUnit = /^step/i.test(single[2]) ? "steps" : null;
    } else if (single[3]) dosage.holdSec = unitToSeconds(n, single[2]);
    else dosage.durationSec = unitToSeconds(n, single[2]);
    text = text.slice(single[0].length);
  } else {
    dosage.sets = Number(m[1]);
    const n = Number(m[2]);
    text = text.slice(m[0].length);
    const unit = text.match(/^[\s-]*(minutes?|mins?|seconds?|secs?|s\b)(?:[\s-]*(holds?))?/i);
    const reps = text.match(/^\s*(reps?|steps?)\b/i);
    if (unit) {
      if (unit[2]) dosage.holdSec = unitToSeconds(n, unit[1]);
      else dosage.durationSec = unitToSeconds(n, unit[1]);
      text = text.slice(unit[0].length);
    } else if (reps) {
      dosage.reps = n;
      dosage.repsUnit = /^step/i.test(reps[1]) ? "steps" : null;
      text = text.slice(reps[0].length);
    } else {
      dosage.reps = n;
    }
  }
  const rest = text.replace(/^[\s,;:.]+/, "").trim();
  if (rest) {
    const sideMatch = rest.match(/^(each|per)\s+(side|leg|foot|arm)\b[\s,;:.]*/i);
    if (sideMatch) {
      dosage.perSide = true;
      const after = rest.slice(sideMatch[0].length).trim();
      if (after) cue = after;
    } else if (/^(each|per)\s+\w+/i.test(rest)) {
      // "each direction" — dosage qualifier, kept verbatim
      const q = rest.match(/^(each|per)\s+\w+/i)![0];
      dosage.note = q;
      const after = rest.slice(q.length).replace(/^[\s,;:.]+/, "").trim();
      if (after) cue = after;
    } else {
      cue = rest;
    }
  }
  if (cue) cue = cue.charAt(0).toUpperCase() + cue.slice(1).replace(/\.$/, "") + ".";
  return { dosage, cue, structured: true };
}

export function extractWithRules(input: string, library: LibraryRef[] = []): RulesResult {
  const flags: ReviewFlag[] = [];
  const items: PlanItem[] = [];
  const recap: string[] = [];
  const running: string[] = [];
  const reassess: string[] = [];
  const milestone: string[] = [];
  const urls: string[] = [];
  const newSentences: string[] = [];
  const libByName = new Map(library.map((l) => [normalizeName(l.name), l]));

  const text = input.replace(/\r\n?/g, "\n");
  // External links (e.g. Google Docs) are not carried into plans: the plan itself
  // replaces them. They are flagged so the PT can move that content in.
  for (const line of text.split("\n")) for (const url of line.match(URL_RE) ?? []) if (!urls.includes(url)) urls.push(url);
  if (urls.length) {
    flags.push({ id: "external-links", severity: "check", field: "items", message: `The email contains ${urls.length === 1 ? "a link" : `${urls.length} links`}. Links aren't shown to patients; put that content (e.g. strength circuits) into the plan instead.`, source: urls.join("  ") });
  }

  // Group into paragraphs; bullets are handled line by line.
  const paragraphs: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) paragraphs.push(buf.join(" "));
    buf = [];
  };
  for (const line of text.split("\n")) {
    const b = line.match(BULLET);
    if (b) {
      flush();
      items.push(parseBullet(b[1].replace(URL_RE, "").trim(), line.trim(), flags, libByName));
    } else if (!line.trim()) flush();
    else buf.push(line.trim());
  }
  flush();

  for (const p of paragraphs) {
    const sentences = splitSentences(p.replace(URL_RE, "").replace(/\(\s*\)/g, ""));
    let inRunning = false;
    for (const s of sentences) {
      if (NEW_ADDITION.test(s) && items.length) {
        newSentences.push(s);
        continue;
      }
      if (NEXT_SESSION.test(s)) {
        reassess.push(s);
        continue;
      }
      if (MILESTONE.test(s) && !RUNNING.test(s)) {
        milestone.push(s);
        continue;
      }
      if (RUNNING.test(s) || (inRunning && (CONDITIONAL.test(s) || /\b(increase|decrease|work up|build|progress)\b/i.test(s)))) {
        inRunning = true;
        running.push(s);
        if (CONDITIONAL.test(s) || /\bif\b/i.test(s)) {
          flags.push({
            id: `conditional-${running.length}`,
            severity: "check",
            field: "running",
            message: "Conditional instruction kept exactly as written. Confirm it still reads as optional, not as a scheduled step.",
            source: s,
          });
        }
        continue;
      }
      if (/strength\s+circuit|google\s+doc/i.test(s)) {
        flags.push({ id: "strength-circuits-ref", severity: "needs_input", field: "items", message: "The email refers to strength circuits. Strength circuits live in the plan now: add those exercises here and group them under a circuit name.", source: s });
      }
      recap.push(s);
    }
  }

  // Mark items named in "new additions" sentences.
  for (const s of newSentences) {
    const ns = normalizeName(s);
    let matched = 0;
    for (const it of items) {
      if (ns.includes(normalizeName(it.name))) {
        it.isNew = true;
        matched++;
      }
    }
    if (!matched) flags.push({ id: `new-unmatched-${newSentences.indexOf(s)}`, severity: "check", field: "items", message: "Mentions new exercises but none matched the list. Mark new exercises manually.", source: s });
  }

  if (!items.length) flags.push({ id: "no-exercises", severity: "check", field: "items", message: "No bulleted exercise list was found. Add exercises manually or paste the list with one exercise per line." });
  if (recap.length) flags.push({ id: "recap-from-email", severity: "check", field: "recap", message: "The recap uses the email's opening text. Edit it to read as a visit summary." });
  if (!milestone.length) flags.push({ id: "milestone-not-found", severity: "check", field: "milestone", message: "The email has no explicit next milestone. Add one or leave it blank." });

  return {
    content: {
      recap: recap.join(" "),
      items,
      runningGuidance: running.join(" "),
      reassessNext: reassess.join(" "),
      nextMilestone: milestone.join(" "),
      links: [],
    },
    flags,
  };
}

function parseBullet(body: string, sourceLine: string, flags: ReviewFlag[], lib: Map<string, LibraryRef>): PlanItem {
  let name = body;
  let dosageText = "";
  const split = body.match(NAME_SPLIT);
  if (split && split.index! > 0) {
    name = body.slice(0, split.index).trim();
    dosageText = body.slice(split.index! + split[0].length).trim();
  } else {
    const d = body.match(/\s(\d+\s*(?:x|×)\s*\d+.*)$/i);
    if (d) {
      name = body.slice(0, d.index).trim();
      dosageText = d[1];
    }
  }
  name = name.replace(/[.:;,]+$/, "").trim();
  const item: PlanItem = { key: key(), name, dosage: {}, frequency: null, scheduleDays: null, cues: null, circuit: null, isNew: false };
  const libHit = lib.get(normalizeName(name));
  if (libHit) {
    item.exerciseId = libHit.id;
    item.description = libHit.description ?? null;
  }
  const freq = dosageText.match(FREQUENCY);
  if (freq) {
    item.frequency = freq[0];
    dosageText = (dosageText.slice(0, freq.index) + dosageText.slice(freq.index! + freq[0].length)).replace(/\s{2,}/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "");
  }
  if (!dosageText || NO_DOSAGE.test(dosageText)) {
    flags.push({ id: `dosage-${item.key}`, severity: "needs_input", field: "item", itemKey: item.key, message: `Dosage not specified for “${name}”. It has been left blank, not filled in.`, source: sourceLine });
    return item;
  }
  const parsed = parseDosage(dosageText);
  if (!parsed.structured) {
    item.dosage = { note: dosageText.replace(/\.$/, "") };
    flags.push({ id: `dosage-unstructured-${item.key}`, severity: "check", field: "item", itemKey: item.key, message: `Couldn't structure the dosage for “${name}”. Kept the original wording.`, source: sourceLine });
  } else {
    item.dosage = parsed.dosage;
    item.cues = parsed.cue;
  }
  return item;
}
