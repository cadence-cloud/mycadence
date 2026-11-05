import { describe, it, expect } from "vitest";
import { extractWithRules, parseDosage } from "@/lib/extract/rules";
import { reviewChecks } from "@/lib/plan-logic";
import { ALEX_SAMPLE_EMAIL } from "@/lib/sample-content";

describe("rules extraction — Alex Morgan sample", () => {
  const r = extractWithRules(ALEX_SAMPLE_EMAIL);
  const byName = (n: string) => r.content.items.find((i) => i.name === n)!;

  it("finds all seven exercises in order", () => {
    expect(r.content.items.map((i) => i.name)).toEqual([
      "Toe yoga",
      "Arch domes",
      "Heel raises with toes out and in",
      "Single-leg heel raise with twist",
      "Relevé walks",
      "Rows",
      "Side-lying hip routine",
    ]);
  });

  it("structures only the dosage that was written", () => {
    expect(byName("Toe yoga").dosage).toEqual({ sets: 3, durationSec: 60 });
    expect(byName("Arch domes").dosage).toEqual({ sets: 5, holdSec: 20 });
    expect(byName("Arch domes").cues).toBe("In single-leg stand.");
    expect(byName("Heel raises with toes out and in").dosage).toEqual({ sets: 3, reps: 12 });
    expect(byName("Relevé walks").dosage).toEqual({ sets: 3, reps: 12, repsUnit: "steps", note: "each direction" });
    expect(byName("Rows").cues).toBe("Squeeze shoulder blades back and together.");
  });

  it("never invents the hip routine dosage, and flags it", () => {
    expect(byName("Side-lying hip routine").dosage).toEqual({});
    expect(r.flags.some((f) => f.severity === "needs_input" && f.message.includes("Side-lying hip routine"))).toBe(true);
  });

  it("never invents frequency; review flags it", () => {
    expect(r.content.items.every((i) => i.frequency == null && i.scheduleDays == null)).toBe(true);
    expect(reviewChecks(r.content).some((f) => f.id === "freq-missing")).toBe(true);
  });

  it("marks the two new additions", () => {
    expect(r.content.items.filter((i) => i.isNew).map((i) => i.name)).toEqual(["Heel raises with toes out and in", "Single-leg heel raise with twist"]);
  });

  it("keeps the conditional running progression verbatim and flags it", () => {
    expect(r.content.runningGuidance).toContain("If feeling good, increase to 30–35 minutes before the next visit.");
    expect(r.content.runningGuidance).toContain("continue every other day");
    expect(r.flags.some((f) => f.source === "If feeling good, increase to 30–35 minutes before the next visit.")).toBe(true);
  });

  it("puts the next-session discussion into reassess, not into running guidance", () => {
    expect(r.content.reassessNext).toBe("At the next session, discuss whether to add strides.");
    expect(r.content.runningGuidance).not.toContain("strides");
  });

  it("flags the strength circuits reference that has no link", () => {
    expect(r.flags.some((f) => f.id === "strength-link-missing")).toBe(true);
  });
});

describe("parseDosage", () => {
  it("handles per-side", () => {
    expect(parseDosage("2 × 30 seconds each side").dosage).toEqual({ sets: 2, durationSec: 30, perSide: true });
  });
  it("reports unstructured text", () => {
    expect(parseDosage("until fatigue").structured).toBe(false);
  });
});

it("extracts links and labels strength docs", () => {
  const r = extractWithRules("Your strength circuits: https://docs.google.com/document/d/abc123/edit\n\n- Clamshells — 2 x 15 each side, daily");
  expect(r.content.links).toEqual([{ label: "Strength circuits", url: "https://docs.google.com/document/d/abc123/edit" }]);
  expect(r.content.items[0]).toMatchObject({ name: "Clamshells", frequency: "daily", dosage: { sets: 2, reps: 15, perSide: true } });
});

import { diffPlans } from "@/lib/plan-logic";
it("diff ignores key order and null vs missing", () => {
  const base = { recap: "", runningGuidance: "a", nextMilestone: "", reassessNext: "", links: [], items: [{ key: "k", name: "Rows", dosage: { sets: 3, reps: 15 }, frequency: null }] };
  const next = { ...base, items: [{ key: "k", name: "Rows", dosage: { reps: 15, sets: 3, repsUnit: null, note: null }, scheduleDays: null }] };
  expect(diffPlans(base, next)).toEqual({ added: [], removed: [], changed: [], runningChanged: false });
});
