// Pure helpers for "Tickets waiting to be closed": level wording and order,
// age formatting, when the sign-in alert shows, its per-tab acknowledgement,
// and the AMS Tickets deep link that opens a ticket for closing.

import type { TabId } from "@/components/tickets/ticket-form/form-model";
import type {
  AttentionCounts,
  AttentionLevel,
  AttentionResponse,
  AttentionTicket,
} from "@/types/attention";

// --- Levels ---------------------------------------------------------------------

/** Most severe first: the order of chips, lists and counts. */
export const LEVELS: readonly AttentionLevel[] = ["critical", "overdue", "due_soon"];

export const LEVEL_LABEL: Record<AttentionLevel, string> = {
  critical: "Critical",
  overdue: "Overdue",
  due_soon: "Due soon",
};

/** Higher is more severe. */
export function levelSeverity(level: AttentionLevel): number {
  return LEVELS.length - LEVELS.indexOf(level);
}

/** Compare for sorting, most severe first. */
export function compareLevels(a: AttentionLevel, b: AttentionLevel): number {
  return levelSeverity(b) - levelSeverity(a);
}

/** What the sidebar badge and the sign-in alert count: overdue + critical (never due soon). */
export function urgentCount(counts: AttentionCounts | undefined): number {
  return counts ? counts.overdue + counts.critical : 0;
}

// --- Age ---------------------------------------------------------------------------

/**
 * Whole hours, rounded down: "23 h" below two days, then "2 d 3 h" (or
 * "3 d" on the hour). Negative or invalid ages read as "0 h".
 */
export function formatAge(hours: number): string {
  const whole = Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 0;
  if (whole < 48) return `${whole} h`;
  const days = Math.floor(whole / 24);
  const rest = whole % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** The same age for screen readers and tooltips: "51 hours". */
export function formatAgeLong(hours: number): string {
  const whole = Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 0;
  return `${whole} ${whole === 1 ? "hour" : "hours"}`;
}

// --- Ticket wording (alert and Home box) ---

/** 48 -> "2 days", 36 -> "36 hours": the target in the rule line, from the API's thresholds. */
export function formatTarget(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  return `${hours} hours`;
}

/** Everyone else named on the ticket ("Also on this ticket: …"). */
export function otherNames(ticket: AttentionTicket, viewerId: number | undefined): string[] {
  return ticket.involved.filter((p) => p.id !== viewerId).map((p) => p.name);
}

export function ageSince(ticket: AttentionTicket): string {
  return `${formatAge(ticket.age_hours)} since ${
    ticket.basis === "received" ? "received (no activity yet)" : "last activity"
  }`;
}

// --- The sign-in alert -----------------------------------------------------------------

/** Shown once data has loaded, only for overdue or critical tickets, and only until acknowledged. */
export function shouldShowDialog(
  data: Pick<AttentionResponse, "counts"> | undefined,
  acknowledged: boolean,
): boolean {
  return Boolean(data) && !acknowledged && urgentCount(data?.counts) > 0;
}

// Acknowledgement lives in sessionStorage: it survives a page refresh in the
// same tab, not a new tab, and is cleared on sign-in and sign-out so every new
// sign-in shows the alert again. Storage can be unavailable (privacy modes,
// blocked site data): then an in-memory flag still stops it reappearing
// while the page stays open.
export const ACK_STORAGE_KEY = "attention-alert-acknowledged";
let memoryAck = false;

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function isAcknowledged(): boolean {
  if (memoryAck) return true;
  try {
    return session()?.getItem(ACK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function acknowledge(): void {
  memoryAck = true;
  try {
    session()?.setItem(ACK_STORAGE_KEY, "1");
  } catch {
    // Storage unavailable: the in-memory flag covers this page load.
  }
}

/** On a successful sign-in and on sign-out (lib/auth.tsx). */
export function clearAcknowledgement(): void {
  memoryAck = false;
  try {
    session()?.removeItem(ACK_STORAGE_KEY);
  } catch {
    // Nothing stored that could be read either.
  }
}

// --- Deep link: /ams-tickets?edit=<id>&tab=<tab> ------------------------------------------

export const TICKETS_PATH = "/ams-tickets";
const DEEP_LINK_TABS: readonly TabId[] = ["ticket", "activities", "verification"];
/** A plain positive integer: no sign, no leading zero, no decimals or exponent. */
const POSITIVE_INT = /^[1-9]\d{0,15}$/;

export type TicketDeepLink = { ticketId: number; tab?: TabId };

/**
 * The ticket to open from the URL, or null. `edit` must be a plain positive
 * integer; `tab` is used only when it's one of the dialog's tabs (anything
 * else is ignored and the dialog opens on its usual first tab).
 */
export function parseTicketDeepLink(params: {
  get(name: string): string | null;
}): TicketDeepLink | null {
  const raw = params.get("edit");
  if (!raw || !POSITIVE_INT.test(raw)) return null;
  const ticketId = Number(raw);
  if (!Number.isSafeInteger(ticketId)) return null;
  const tab = params.get("tab");
  return DEEP_LINK_TABS.includes(tab as TabId) ? { ticketId, tab: tab as TabId } : { ticketId };
}

/** Opens the ticket's edit dialog on its Verification tab, where it is closed. */
export function closeTicketHref(ticketId: number): string {
  return `${TICKETS_PATH}?edit=${ticketId}&tab=verification`;
}
