// Presentation helpers for the Audit Log: action tones, timestamps, day
// grouping and the details panel's metadata. Display only; the CSV export
// keeps the server's full wording.

import type { AuditEntry } from "@/types/audit";
import { formatDateDisplay, isoToLocal } from "@/lib/local-datetime";

/**
 * What kind of change an action is, so badges read by meaning rather than by
 * area: creates in one tone, edits in another, removals in a third, sign-ins
 * neutral. Ticket close / reopen reuse the ticket Status colours.
 */
export type Tone = "neutral" | "positive" | "change" | "negative" | "closed" | "open";

const TONES: Record<string, Tone> = {
  login: "neutral",
  logout: "neutral",
  login_failed: "negative",
  ticket_created: "positive",
  ticket_updated: "change",
  ticket_closed: "closed",
  ticket_reopened: "open",
  ticket_activity_added: "positive",
  ticket_activity_removed: "negative",
  work_log_created: "positive",
  work_log_updated: "change",
  work_log_deleted: "negative",
  lookup_created: "positive",
  lookup_updated: "change",
  lookup_deleted: "negative",
  user_created: "positive",
  user_updated: "change",
  user_deactivated: "negative",
  user_reactivated: "positive",
  user_role_changed: "change",
  user_password_reset: "change",
};

/** Theme tokens only (light and dark are defined in globals.css). */
export const TONE_TOKEN: Record<Tone, string> = {
  neutral: "var(--muted-foreground)",
  positive: "var(--chart-success)",
  change: "var(--chart-info)",
  negative: "var(--destructive)",
  closed: "var(--status-closed)",
  open: "var(--status-open)",
};

export const toneOf = (action: string): Tone => TONES[action] ?? "neutral";

const TIME_FMT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const FULL_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

const sameYear = (d: Date) => d.getFullYear() === new Date().getFullYear();
/** "27 Sep" this year, "27 Sep 2025" otherwise, via the app's shared formatter. */
const shortDay = (iso: string) =>
  formatDateDisplay(isoToLocal(iso).slice(0, 10), { withYear: !sameYear(new Date(iso)) });

/** "5:40 PM" (inside a day group). */
export const formatTime = (iso: string) => TIME_FMT.format(new Date(iso));

/** "27 Sep, 5:40 PM" (when the rows aren't grouped by day). */
export function formatStamp(iso: string) {
  return `${shortDay(iso)}, ${TIME_FMT.format(new Date(iso))}`;
}

/** "Sunday 27 September 2026, 5:40:12 pm GMT+8", for tooltips and the details panel. */
export const formatFull = (iso: string) => FULL_FMT.format(new Date(iso));

/** The browser-local calendar day, e.g. "2026-09-27", used to group rows. */
export function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** "Today", "Yesterday", or "Wed 23 Sep" (with the year when it isn't this year). */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return `${WEEKDAY_FMT.format(d)} ${shortDay(iso)}`;
}

/**
 * The description without its leading actor name: the Who column already
 * shows the person, so the row reads "Aisha Rahman | reactivated Nurul's
 * account" instead of repeating the name. Entries that don't start with the
 * name (e.g. "Failed sign-in attempt for …") are left as they are.
 */
export function eventText(entry: AuditEntry, actorName: string | null) {
  const prefix = actorName ? `${actorName} ` : null;
  return prefix && entry.description.startsWith(prefix)
    ? entry.description.slice(prefix.length)
    : entry.description;
}

const humanize = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Metadata as label / value lines for the details panel ("Role: staff → admin"). */
export function metadataLines(entry: AuditEntry): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(entry.metadata ?? {})) {
    if (key === "changes" && value && typeof value === "object") {
      for (const [field, change] of Object.entries(value as Record<string, unknown>)) {
        const c = change as { from?: unknown; to?: unknown } | null;
        lines.push({
          label: humanize(field),
          value:
            c && typeof c === "object" && "to" in c
              ? `${show(c.from)} → ${show(c.to)}`
              : show(change),
        });
      }
    } else if (key === "from" || key === "to") {
      if (key === "from") {
        lines.push({
          label: "Change",
          value: `${show(entry.metadata.from)} → ${show(entry.metadata.to)}`,
        });
      }
    } else if (key === "before" && value && typeof value === "object") {
      const before = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${humanize(k).toLowerCase()} ${show(v)}`)
        .join(", ");
      lines.push({ label: "Before", value: before });
    } else if (Array.isArray(value)) {
      lines.push({
        label: humanize(key),
        value: value.map((v) => humanize(String(v)).toLowerCase()).join(", "),
      });
    } else {
      lines.push({ label: humanize(key), value: show(value) });
    }
  }
  return lines;
}
