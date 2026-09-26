// Wire shapes of the /api/working-hours/ endpoints (snake_case, hours as numbers).

import type { AuthUser } from "@/lib/auth";
import type { PeriodKey } from "@/types/dashboard";

export type StaffUser = AuthUser;

export type ApiPeriod = {
  key: PeriodKey;
  label: string;
  /** ISO dates, both inclusive. */
  start_date: string;
  end_date: string;
  /** Exact minutes, summed from the entries' times: display these. */
  total_minutes: number;
  ams_minutes: number;
  non_ams_minutes: number;
  goal_minutes: number;
  /** The same figures in hours (2 decimals), for reading. */
  total_hours: number;
  goal_hours: number;
  ams_hours: number;
  non_ams_hours: number;
  percent_complete: number;
};

export type WorkCategory = "ams" | "non_ams";

/** One logged block of hours (/api/working-hours/entries/). */
export type WorkLogEntry = {
  id: number;
  /** Owner's user id. */
  user: number;
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:mm" on `date`; the end is always after the start (no midnight crossing). */
  start_time: string;
  end_time: string;
  category: WorkCategory;
  /** Computed by the server from the times (2 decimal places). */
  hours: number;
  note: string;
  /**
   * Mirrored from a ticket activity (always AMS): read-only here, it changes
   * only by editing the activity on its ticket. False = logged by hand.
   */
  is_auto: boolean;
  /** Auto entries: the ticket's id and "Ticket #… — Troubleshooting". */
  ticket: number | null;
  ticket_reference: string | null;
  created_at: string;
};

export type WorkingHoursSummary = {
  user: StaffUser;
  /** IANA zone the period boundaries were computed in: the viewer's (requester's) own. */
  timezone: string;
  periods: ApiPeriod[];
};
