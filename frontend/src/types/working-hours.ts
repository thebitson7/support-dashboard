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
  total_hours: number;
  goal_hours: number;
  ams_hours: number;
  non_ams_hours: number;
  percent_complete: number;
};

export type WorkingHoursSummary = {
  user: StaffUser;
  /** IANA zone the period boundaries were computed in: the viewer's (requester's) own. */
  timezone: string;
  periods: ApiPeriod[];
};
