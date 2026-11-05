import type { Db } from "@/db/client";
import { clinicSettings } from "@/db/schema";

export const SETTING_DEFAULTS = {
  responseExpectation: "Your care team usually replies within 1 business day (Mon–Fri, 8am–6pm ET).",
  urgentGuidance: "Messages are not monitored around the clock. For a medical emergency, call 911. For new or worsening symptoms that can’t wait, contact your physician or an urgent care center.",
  clinicName: "Cadence Physical Therapy",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSettings(db: Db): Promise<Record<SettingKey, string>> {
  const rows = await db.select().from(clinicSettings);
  const out = { ...SETTING_DEFAULTS } as Record<SettingKey, string>;
  for (const r of rows) if (r.key in out) out[r.key as SettingKey] = r.value;
  return out;
}
