// Overlapping work time (see backend working_hours/overlaps.py).
//
// Saving a ticket activity or a manual entry whose time overlaps other time
// the same person logged is refused with a 409 whose JSON body lists the
// overlaps; resending the same request with `confirm_overlaps: true` saves it.
// This module recognises that 409 (never trusting its shape blindly), words
// each overlap for people, and does the same-form arithmetic the ticket form
// uses to warn before saving.

import { ApiError } from "@/lib/api";

export type OverlapKind = "manual_entry" | "ticket_activity" | "same_request";

/** One item of a 409 overlap body. Times are "HH:MM" in that person's own zone. */
export type Overlap = {
  kind: OverlapKind;
  person: { id: number; name: string };
  /** "YYYY-MM-DD". */
  date: string;
  /** The time being saved. */
  start: string;
  end: string;
  /** The time it overlaps. */
  conflicting_start: string;
  conflicting_end: string;
  /** Where the two meet. */
  overlap_start: string;
  overlap_end: string;
  overlap_minutes: number;
  /** "Ticket #CMS1002 (Troubleshooting)", "Manual entry (note)" or "Activity 2". */
  label: string;
  /** Ticket saves: 1-based position of the activity being saved. */
  activity: number | null;
  /** same_request: 1-based position of the other activity. */
  conflicting_activity: number | null;
  conflicting_ticket: number | null;
};

export const OVERLAP_CODE = "overlap_confirmation_required";

const KINDS = new Set<string>(["manual_entry", "ticket_activity", "same_request"]);
const HHMM = /^\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A short plain-text label (no markup, no wall of text), or null. */
function plainText(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const text = v.trim();
  return text && text.length <= max && !/<[a-z!/]/i.test(text) ? text : null;
}

const positiveOrNull = (v: unknown): number | null | undefined =>
  v === null ? null : Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined;

function parseOverlap(raw: unknown): Overlap | null {
  if (!isRecord(raw) || !isRecord(raw.person)) return null;
  const { kind, date, overlap_minutes } = raw;
  const times = [
    "start",
    "end",
    "conflicting_start",
    "conflicting_end",
    "overlap_start",
    "overlap_end",
  ] as const;
  const label = plainText(raw.label);
  const name = plainText(raw.person.name, 150);
  const activity = positiveOrNull(raw.activity);
  const conflictingActivity = positiveOrNull(raw.conflicting_activity);
  const conflictingTicket = positiveOrNull(raw.conflicting_ticket);
  if (
    typeof kind !== "string" ||
    !KINDS.has(kind) ||
    typeof date !== "string" ||
    !DAY.test(date) ||
    !Number.isInteger(overlap_minutes) ||
    (overlap_minutes as number) <= 0 ||
    !Number.isInteger(raw.person.id) ||
    !label ||
    !name ||
    times.some((t) => typeof raw[t] !== "string" || !HHMM.test(raw[t] as string)) ||
    activity === undefined ||
    conflictingActivity === undefined ||
    conflictingTicket === undefined
  ) {
    return null;
  }
  return {
    kind: kind as OverlapKind,
    person: { id: raw.person.id as number, name },
    date,
    start: raw.start as string,
    end: raw.end as string,
    conflicting_start: raw.conflicting_start as string,
    conflicting_end: raw.conflicting_end as string,
    overlap_start: raw.overlap_start as string,
    overlap_end: raw.overlap_end as string,
    overlap_minutes: overlap_minutes as number,
    label,
    activity,
    conflicting_activity: conflictingActivity,
    conflicting_ticket: conflictingTicket,
  };
}

/**
 * The overlaps of an "overlap confirmation required" 409, or null for any
 * other error, including a 409 whose body isn't exactly that shape (the
 * caller then shows its generic message; nothing from a malformed body is
 * ever displayed).
 */
export function overlapsFromError(error: unknown): Overlap[] | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !isRecord(error.data)) return null;
  const { code, overlaps } = error.data;
  if (code !== OVERLAP_CODE || !Array.isArray(overlaps) || overlaps.length === 0) return null;
  const parsed = overlaps.map(parseOverlap);
  return parsed.every((o): o is Overlap => o !== null) ? parsed : null;
}

/** 45 -> "45 min", 60 -> "1 h", 75 -> "1 h 15 min". */
export function formatOverlapDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * One overlap in plain words:
 * "Overlaps 45 min with Ticket #CMS1002 (Troubleshooting), 10:00-10:45" or
 * "Overlaps 30 min with another activity in this ticket (activity 2)".
 */
export function describeOverlap(o: Overlap): string {
  const amount = formatOverlapDuration(o.overlap_minutes);
  if (o.kind === "same_request") {
    const which = o.conflicting_activity ? ` (activity ${o.conflicting_activity})` : "";
    return `Overlaps ${amount} with another activity in this ticket${which}`;
  }
  return `Overlaps ${amount} with ${o.label}, ${o.overlap_start}-${o.overlap_end}`;
}

// --- Same-form check (the ticket form's early warning) ----------------------------

/** The bits of an activity draft the check needs: local date-times and who resolved it. */
export type TimedItem = {
  key: string;
  startMs: number;
  endMs: number;
  /** The resolver's id; null = nobody, never compared. */
  personId: string | null;
};

const MINUTE = 60_000;

/**
 * For each item, the 1-based positions of the other items with the same
 * person whose times overlap it (touching end to start doesn't count).
 * Compared to the minute, like the server; items under a minute or with
 * invalid times are skipped. Advisory only: the server, which also knows the
 * person's other tickets and entries, has the final say on save.
 */
export function sameFormOverlaps(items: TimedItem[]): Record<string, number[]> {
  const usable = items
    .map((item, index) => ({
      ...item,
      position: index + 1,
      start: Math.floor(item.startMs / MINUTE),
      end: Math.floor(item.endMs / MINUTE),
    }))
    .filter(
      (i) => i.personId && Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start,
    );
  const result: Record<string, number[]> = {};
  for (const a of usable) {
    const others = usable
      .filter(
        (b) =>
          b.key !== a.key &&
          b.personId === a.personId &&
          Math.max(a.start, b.start) < Math.min(a.end, b.end),
      )
      .map((b) => b.position);
    if (others.length) result[a.key] = others;
  }
  return result;
}

/** "Overlaps with activity 2", "Overlaps with activities 1 and 3", "… 1, 2 and 4". */
export function sameFormWarning(positions: number[]): string {
  if (positions.length === 1) return `Overlaps with activity ${positions[0]}`;
  const head = positions.slice(0, -1).join(", ");
  return `Overlaps with activities ${head} and ${positions[positions.length - 1]}`;
}

// --- After saving: the time counted twice -------------------------------------------

type DayRange = { start_time: string; end_time: string };

const toMinutes = (hhmm: string) => {
  const [h = NaN, m = NaN] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Minutes counted more than once when a day's entries are summed (as every
 * total does): their summed lengths minus the time they cover. Same rule as
 * the server's double_counted_minutes. 09:00-10:00 + 09:30-10:30 -> 30.
 */
export function doubleCountedMinutes(entries: DayRange[]): number {
  const spans = entries
    .map((e) => [toMinutes(e.start_time), toMinutes(e.end_time)] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const summed = spans.reduce((sum, [s, e]) => sum + (e - s), 0);
  let covered = 0;
  let current: [number, number] | null = null;
  for (const [s, e] of spans) {
    if (!current || s > current[1]) {
      if (current) covered += current[1] - current[0];
      current = [s, e];
    } else {
      current[1] = Math.max(current[1], e);
    }
  }
  if (current) covered += current[1] - current[0];
  return summed - covered;
}
