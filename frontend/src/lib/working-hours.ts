import type { PeriodSummary } from "@/types/dashboard";
import type { ApiPeriod, WorkCategory, WorkLogEntry } from "@/types/working-hours";
import { formatTimeDisplay, timeToMinutes } from "@/lib/local-datetime";

/**
 * Minutes from start to end, or null unless both are times and the end is
 * after the start (the API refuses anything else, midnight crossings included).
 */
export function spanMinutes(start: string, end: string): number | null {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  return a !== null && b !== null && b > a ? b - a : null;
}

/** "9:00 AM – 10:45 AM" */
export const formatTimeRange = (entry: Pick<WorkLogEntry, "start_time" | "end_time">) =>
  `${formatTimeDisplay(entry.start_time)} – ${formatTimeDisplay(entry.end_time)}`;

/** An entry's exact length from its times (its `hours` is rounded to 0.01 h). */
export const entryMinutes = (entry: Pick<WorkLogEntry, "start_time" | "end_time">) =>
  spanMinutes(entry.start_time, entry.end_time) ?? 0;

/** Mirrors WorkLogEntry.Category in working_hours/models.py. */
export const WORK_CATEGORIES: { value: WorkCategory; label: string }[] = [
  { value: "ams", label: "AMS" },
  { value: "non_ams", label: "Non-AMS" },
];

/** Same two colours as the period cards' AMS / Non-AMS split. */
export const CATEGORY_COLOR: Record<WorkCategory, string> = {
  ams: "var(--primary)",
  non_ams: "var(--chart-info)",
};

/** A user's "?user_id=" for the working-hours endpoints; "" means "myself". */
export const userQuery = (userId: string | null) =>
  userId ? `?user_id=${encodeURIComponent(userId)}` : "";

/** "2026-09-24" -> a local Date (no UTC shift, unlike `new Date(iso)`). */
function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const shortFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "Thu, Sep 24, 2026" for one day, "Sep 21 – Sep 27" for a range (as on Home). */
function formatRange(start: string, end: string): string {
  if (start === end) return dayFormat.format(parseDay(start));
  return `${shortFormat.format(parseDay(start))} – ${shortFormat.format(parseDay(end))}`;
}

/**
 * Maps the API's period onto the shape the Home period cards already render.
 * Uses the API's exact minutes (never hours x 60: rounded hours drift).
 */
export function toPeriodSummary(p: ApiPeriod): PeriodSummary {
  return {
    key: p.key,
    label: p.label,
    dateRange: formatRange(p.start_date, p.end_date),
    workedMinutes: p.total_minutes,
    goalMinutes: p.goal_minutes,
    amsMinutes: p.ams_minutes,
    nonAmsMinutes: p.non_ams_minutes,
    percentComplete: p.percent_complete,
  };
}
