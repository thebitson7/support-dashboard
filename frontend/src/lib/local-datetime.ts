// "Local date-time" strings: "YYYY-MM-DDTHH:mm" in the browser's own time
// zone, exactly the format <input type="datetime-local"> used. The ticket
// form stores every date-time this way and converts to ISO/UTC only when
// sending to the API. Parsing is done by hand (never `Date.parse`) so there
// is no UTC-vs-local ambiguity and no off-by-one day.

export type LocalParts = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
};

const pad = (n: number) => String(n).padStart(2, "0");

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseLocal(value: string): LocalParts | null {
  const m = PATTERN.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

export function formatLocal(p: LocalParts): string {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function partsOfDate(date: Date): LocalParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/** Now, to the minute. */
export const nowLocal = (): string => formatLocal(partsOfDate(new Date()));

/** An API timestamp (ISO, any offset) -> the same instant as a local date-time string. */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatLocal(partsOfDate(date));
}

/** A local date-time string -> ISO/UTC for the API. */
export function localToIso(value: string): string {
  const p = parseLocal(value);
  if (!p) throw new Error(`Not a local date-time: ${value}`);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute).toISOString();
}

/** Epoch ms of a local date-time string (NaN if invalid). */
export function localToMs(value: string): number {
  const p = parseLocal(value);
  return p ? new Date(p.year, p.month - 1, p.day, p.hour, p.minute).getTime() : NaN;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// --- Date-only values ("YYYY-MM-DD", e.g. a holiday) -------------------------------

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-12-25" -> parts at midnight; null if not a real calendar date. */
export function parseLocalDate(value: string): LocalParts | null {
  const m = DATE_PATTERN.exec(value);
  return m ? parseLocal(`${m[1]}-${m[2]}-${m[3]}T00:00`) : null;
}

export function formatLocalDate(p: Pick<LocalParts, "year" | "month" | "day">): string {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export const todayLocalDate = (): string => formatLocalDate(partsOfDate(new Date()));

/** Today's "YYYY-MM-DD" in an IANA zone (a user's profile zone, not the browser's). */
export function todayInZone(timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return todayLocalDate(); // unknown zone: fall back to the browser's
  }
}

/** "2026-03-01" + -1 -> "2026-02-28" (calendar arithmetic, no time zone involved). */
export function addDaysToDate(value: string, days: number): string {
  const p = parseLocalDate(value);
  if (!p) return value;
  const d = new Date(p.year, p.month - 1, p.day + days);
  return formatLocalDate({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

const LONG_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "2026-03-04" -> "Wednesday 4 March 2026". */
export function formatDateLong(value: string): string {
  const p = parseLocalDate(value);
  return p ? LONG_DATE_FMT.format(new Date(p.year, p.month - 1, p.day)) : "";
}

/** "25 Dec 2026", or "25 Dec" with `withYear: false` (e.g. a yearly holiday). */
export function formatDateDisplay(value: string, { withYear = true } = {}): string {
  const p = parseLocalDate(value);
  if (!p) return "";
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}${withYear ? ` ${p.year}` : ""}`;
}

// --- Time-only values ("HH:mm", e.g. a work-log entry's start) ---------------------

const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** "09:45" -> parts (on a placeholder date); null if not a real time of day. */
export function parseLocalTime(value: string): LocalParts | null {
  const m = TIME_PATTERN.exec(value);
  return m ? parseLocal(`2000-01-01T${m[1]}:${m[2]}`) : null;
}

export function formatLocalTime(p: Pick<LocalParts, "hour" | "minute">): string {
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export const nowLocalTime = (): string => formatLocalTime(partsOfDate(new Date()));

/** "09:45" -> 585 (minutes since midnight); null if not a time. */
export function timeToMinutes(value: string): number | null {
  const p = parseLocalTime(value);
  return p ? p.hour * 60 + p.minute : null;
}

/** "14:05" -> "2:05 PM" (fixed format, independent of the browser locale). */
export function formatTimeDisplay(value: string): string {
  const p = parseLocalTime(value);
  if (!p) return "";
  const { hour12, pm } = to12h(p.hour);
  return `${hour12}:${pad(p.minute)} ${pm ? "PM" : "AM"}`;
}

/** 0–23 -> { hour12: 1–12, pm } */
export function to12h(hour: number): { hour12: number; pm: boolean } {
  return { hour12: hour % 12 === 0 ? 12 : hour % 12, pm: hour >= 12 };
}

/** 1–12 + AM/PM -> 0–23 */
export function from12h(hour12: number, pm: boolean): number {
  return (hour12 % 12) + (pm ? 12 : 0);
}

/** "24 Sep 2026, 2:30 PM" (fixed format, independent of the browser locale). */
export function formatLocalDisplay(value: string): string {
  const p = parseLocal(value);
  if (!p) return "";
  const { hour12, pm } = to12h(p.hour);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}, ${hour12}:${pad(p.minute)} ${pm ? "PM" : "AM"}`;
}
