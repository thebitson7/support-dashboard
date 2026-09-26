// Wire shapes of /api/reports/ (snake_case, hours as numbers).

import type { StaffUser, WorkLogEntry } from "@/types/working-hours";

export type ReportTotals = {
  /**
   * Exact minutes, summed from the entries' times: add and display these.
   * The *_hours fields are the same values in hours (2 decimals), for reading.
   */
  total_minutes: number;
  ams_minutes: number;
  non_ams_minutes: number;
  total_hours: number;
  ams_hours: number;
  non_ams_hours: number;
  entry_count: number;
};

/** One person's totals over the report's range. */
export type ReportMember = ReportTotals & {
  user: StaffUser;
  /** False only when a deactivated user is looked up by id. */
  is_active: boolean;
};

type ReportRange = {
  /** Inclusive "YYYY-MM-DD" bounds, as applied (defaults filled in). */
  start_date: string;
  end_date: string;
  /** The requesting admin's zone, which the default range was cut in. */
  timezone: string;
};

/** GET /reports/team-activity/ : everyone. */
export type TeamActivityReport = ReportRange & {
  members: ReportMember[];
  totals: ReportTotals & { member_count: number };
};

/** GET /reports/team-activity/?user_id= : one person, with their entries. */
export type MemberActivityReport = ReportRange & {
  member: ReportMember;
  /** Date, then start-time order; the Job Sheet's entry shape. */
  entries: WorkLogEntry[];
};
