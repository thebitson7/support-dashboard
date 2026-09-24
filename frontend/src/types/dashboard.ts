// Shapes for the Home dashboard. The mock layer (src/lib/mock-data.ts)
// returns these today; a real API response should be mapped onto the same
// types so the components never change.

export type Accent = "primary" | "info" | "violet" | "success" | "navy";

export type PeriodKey =
  "today" | "yesterday" | "currentWeek" | "lastWeek" | "currentMonth" | "previousMonth";

export type PeriodSummary = {
  key: PeriodKey;
  label: string;
  dateRange: string;
  /** All durations are whole minutes; amsMinutes + nonAmsMinutes === workedMinutes. */
  workedMinutes: number;
  goalMinutes: number;
  amsMinutes: number;
  nonAmsMinutes: number;
  /** Can exceed 100 when the goal is beaten. */
  percentComplete: number;
};

export type KpiKey = "ticketsThisMonth" | "avgResolution" | "closedToday" | "activeSites";

export type Kpi = {
  key: KpiKey;
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  /** Signed % change vs the previous period. */
  deltaPercent: number;
  /** false for metrics where a decrease is the good direction (e.g. resolution time). */
  higherIsBetter: boolean;
  comparedTo: string;
};

export type TicketStatus = "Open" | "In Progress" | "Resolved" | "Closed";

export type TicketStatusCount = {
  status: TicketStatus;
  count: number;
};

export type WeeklyHoursPoint = {
  /** Week-start label, e.g. "Aug 3". */
  week: string;
  hours: number;
};

export type ActivityKind = "created" | "resolved" | "updated" | "comment" | "assigned";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  actor: string;
  /** Sentence fragment after the actor, e.g. "marked ticket". */
  action: string;
  ticketId: string;
  /** Trailing fragment, e.g. "resolved". */
  outcome?: string;
  site: string;
  category: string;
  /** Pre-formatted relative time ("12 min ago"). */
  relativeTime: string;
};

export type TopSite = {
  site: string;
  country: string;
  tickets: number;
};

export type DashboardData = {
  weeklyGoalHours: number;
  kpis: Kpi[];
  periods: PeriodSummary[];
  ticketsByStatus: TicketStatusCount[];
  weeklyHours: WeeklyHoursPoint[];
  activity: ActivityItem[];
  topSites: TopSite[];
};
