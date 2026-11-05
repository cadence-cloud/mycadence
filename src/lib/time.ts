/** Cadence operates in America/New_York. All calendar dates are clinic-local. */
export const CLINIC_TZ = "America/New_York";

/** YYYY-MM-DD for an instant, in the given time zone. */
export function localDate(d: Date = new Date(), tz = CLINIC_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Add days to a YYYY-MM-DD calendar date (pure calendar math, no TZ drift). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Weekday key ("mon".."sun") for a YYYY-MM-DD calendar date. */
export function weekdayOf(ymd: string): "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" {
  const [y, m, d] = ymd.split("-").map(Number);
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function formatDate(ymd: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateTime(d: Date | string | null | undefined, tz = CLINIC_TZ): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(dt);
}

export function relativeDay(ymd: string, today = localDate()): string {
  if (ymd === today) return "Today";
  if (ymd === addDays(today, -1)) return "Yesterday";
  return formatDate(ymd, { weekday: "short", month: "short", day: "numeric" });
}

/** The instant for a clinic-local date + "HH:MM" (handles EST/EDT). */
export function clinicDateTime(ymd: string, hhmm: string, tz = CLINIC_TZ): Date {
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  const shown = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const g = (t: string) => Number(shown.find((p) => p.type === t)!.value);
  const shownUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return new Date(guess.getTime() + (guess.getTime() - shownUtc));
}

export function formatTime(d: Date, tz = CLINIC_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}
