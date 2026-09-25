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
