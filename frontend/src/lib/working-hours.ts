import type { PeriodSummary } from "@/types/dashboard";
import type { ApiPeriod } from "@/types/working-hours";

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

const toMinutes = (hours: number) => Math.round(hours * 60);

/** Maps the API's period onto the shape the Home period cards already render. */
export function toPeriodSummary(p: ApiPeriod): PeriodSummary {
  const amsMinutes = toMinutes(p.ams_hours);
  const nonAmsMinutes = toMinutes(p.non_ams_hours);
  return {
    key: p.key,
    label: p.label,
    dateRange: formatRange(p.start_date, p.end_date),
    workedMinutes: amsMinutes + nonAmsMinutes,
    goalMinutes: toMinutes(p.goal_hours),
    amsMinutes,
    nonAmsMinutes,
    percentComplete: p.percent_complete,
  };
}
