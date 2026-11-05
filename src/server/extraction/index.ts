/**
 * Server-side extraction provider interface for "Paste existing instructions".
 *
 *  - "rules" (default): deterministic parser, no network, works without any key.
 *  - "anthropic": optional AI extraction. Gated: only allowed in the demo environment
 *    (fictional data) unless AI_PHI_APPROVED=true is set after a documented vendor
 *    and data-handling review. Output is post-validated so the model cannot add
 *    dosages, frequencies, or drop conditional wording without it being flagged.
 *
 * Whatever the provider, the result is only ever a DRAFT that a PT must review.
 */
import type { PlanContent, ReviewFlag } from "@/lib/plan-types";
import { extractWithRules, type LibraryRef } from "@/lib/extract/rules";
import { reviewChecks } from "@/lib/plan-logic";
import { isDemo } from "@/lib/env";
import { anthropicExtract } from "./anthropic";

export interface ExtractionResult {
  content: PlanContent;
  flags: ReviewFlag[];
  /** "rules" | "ai:<model>" — shown to the PT on the review screen. */
  source: string;
  notice?: string;
}

export interface ExtractionProvider {
  name: string;
  extract(text: string, library: LibraryRef[]): Promise<ExtractionResult>;
}

const rulesProvider: ExtractionProvider = {
  name: "rules",
  async extract(text, library) {
    const r = extractWithRules(text, library);
    return { ...r, source: "rules" };
  },
};

export function aiAvailability(): { available: boolean; reason?: string } {
  if ((process.env.EXTRACTION_PROVIDER ?? "rules") !== "anthropic") return { available: false, reason: "AI extraction is not enabled (EXTRACTION_PROVIDER=rules)." };
  if (!process.env.ANTHROPIC_API_KEY) return { available: false, reason: "No AI key configured." };
  if (!isDemo() && process.env.AI_PHI_APPROVED !== "true") return { available: false, reason: "AI extraction is disabled for real patient data until the provider and data handling are approved." };
  return { available: true };
}

export function getProvider(): ExtractionProvider {
  if (!aiAvailability().available) return rulesProvider;
  return {
    name: "anthropic",
    async extract(text, library) {
      try {
        return await anthropicExtract(text, library);
      } catch {
        // Never block the PT: fall back to the deterministic parser.
        const r = await rulesProvider.extract(text, library);
        return { ...r, notice: "AI extraction failed, so the rule-based parser was used instead." };
      }
    },
  };
}

export function mergeFlags(content: PlanContent, extracted: ReviewFlag[]): ReviewFlag[] {
  const out = new Map<string, ReviewFlag>();
  for (const f of reviewChecks(content)) out.set(f.id, f);
  for (const f of extracted) out.set(f.id, f); // extractor flags carry source text
  return [...out.values()];
}
