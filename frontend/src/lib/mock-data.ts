import type {
  ActivityItem,
  DashboardData,
  PeriodSummary,
  TicketStatusCount,
  TopSite,
  WeeklyHoursPoint,
} from "@/types/dashboard";

// Mock data for the Home dashboard. `getDashboardData()` is the single seam:
// swap its body for real API calls (mapped onto DashboardData) and no
// component needs to change.

const mins = (h: number, m = 0) => h * 60 + m;

type PeriodInput = Omit<PeriodSummary, "workedMinutes" | "percentComplete">;

function period(p: PeriodInput): PeriodSummary {
  const workedMinutes = p.amsMinutes + p.nonAmsMinutes;
  return {
    ...p,
    workedMinutes,
    // A period with no goal reports 0% instead of Infinity/NaN.
    percentComplete: p.goalMinutes > 0 ? Math.round((workedMinutes / p.goalMinutes) * 100) : 0,
  };
}

const periods: PeriodSummary[] = [
  period({
    key: "today",
    label: "Today",
    dateRange: "Thu, Sep 24, 2026",
    goalMinutes: mins(8),
    amsMinutes: mins(4, 30),
    nonAmsMinutes: mins(1, 45),
  }),
  period({
    key: "yesterday",
    label: "Yesterday",
    dateRange: "Wed, Sep 23, 2026",
    goalMinutes: mins(8),
    amsMinutes: mins(4, 55),
    nonAmsMinutes: mins(2, 50),
  }),
  period({
    key: "currentWeek",
    label: "Current Week",
    dateRange: "Sep 21 – Sep 27",
    goalMinutes: mins(40),
    amsMinutes: mins(18, 20),
    nonAmsMinutes: mins(11, 10),
  }),
  period({
    key: "lastWeek",
    label: "Last Week",
    dateRange: "Sep 14 – Sep 20",
    goalMinutes: mins(40),
    amsMinutes: mins(25, 40),
    nonAmsMinutes: mins(15, 30),
  }),
  period({
    key: "currentMonth",
    label: "Current Month",
    dateRange: "Sep 1 – Sep 30",
    goalMinutes: mins(176),
    amsMinutes: mins(76, 15),
    nonAmsMinutes: mins(45, 25),
  }),
  period({
    key: "previousMonth",
    label: "Previous Month",
    dateRange: "Aug 1 – Aug 31",
    goalMinutes: mins(168),
    amsMinutes: mins(104, 10),
    nonAmsMinutes: mins(60, 20),
  }),
];

const ticketsByStatus: TicketStatusCount[] = [
  { status: "Open", count: 34 },
  { status: "In Progress", count: 21 },
  { status: "Resolved", count: 58 },
  { status: "Closed", count: 112 },
];

// Last 8 weeks; the final point is the current, still-running week.
const weeklyHours: WeeklyHoursPoint[] = [
  { week: "Aug 3", hours: 38.5 },
  { week: "Aug 10", hours: 41 },
  { week: "Aug 17", hours: 36.2 },
  { week: "Aug 24", hours: 43.5 },
  { week: "Aug 31", hours: 39.8 },
  { week: "Sep 7", hours: 40.6 },
  { week: "Sep 14", hours: 41.2 },
  { week: "Sep 21", hours: 29.5 },
];

const activity: ActivityItem[] = [
  {
    id: "a1",
    kind: "resolved",
    actor: "Layla Haddad",
    action: "marked ticket",
    ticketId: "#4021",
    outcome: "resolved",
    site: "Riyadh Central Lab",
    category: "Calibration",
    relativeTime: "12 min ago",
  },
  {
    id: "a2",
    kind: "comment",
    actor: "Omar Nasser",
    action: "commented on",
    ticketId: "#4018",
    site: "Dubai Medical City",
    category: "QC Failure",
    relativeTime: "38 min ago",
  },
  {
    id: "a3",
    kind: "created",
    actor: "Nadia Farouk",
    action: "opened ticket",
    ticketId: "#4024",
    site: "Cairo University Hospital",
    category: "Middleware",
    relativeTime: "1 hr ago",
  },
  {
    id: "a4",
    kind: "assigned",
    actor: "Karim Suleiman",
    action: "was assigned",
    ticketId: "#4017",
    site: "Amman Specialty Lab",
    category: "Firmware",
    relativeTime: "2 hr ago",
  },
  {
    id: "a5",
    kind: "updated",
    actor: "Layla Haddad",
    action: "moved ticket",
    ticketId: "#4012",
    outcome: "to In Progress",
    site: "Kuwait City Diagnostics",
    category: "Reagent Issue",
    relativeTime: "3 hr ago",
  },
  {
    id: "a6",
    kind: "resolved",
    actor: "Yusuf Rahman",
    action: "marked ticket",
    ticketId: "#4009",
    outcome: "resolved",
    site: "Doha Health Center",
    category: "LIS Connection",
    relativeTime: "5 hr ago",
  },
  {
    id: "a7",
    kind: "comment",
    actor: "Omar Nasser",
    action: "commented on",
    ticketId: "#4003",
    site: "Riyadh Central Lab",
    category: "Preventive Maint.",
    relativeTime: "Yesterday",
  },
];

const topSites: TopSite[] = [
  { site: "Riyadh Central Lab", country: "Saudi Arabia", tickets: 46 },
  { site: "Dubai Medical City", country: "UAE", tickets: 38 },
  { site: "Cairo University Hospital", country: "Egypt", tickets: 31 },
  { site: "Amman Specialty Lab", country: "Jordan", tickets: 24 },
  { site: "Kuwait City Diagnostics", country: "Kuwait", tickets: 19 },
  { site: "Doha Health Center", country: "Qatar", tickets: 14 },
];

export function getDashboardData(): DashboardData {
  return {
    weeklyGoalHours: 40,
    kpis: [
      {
        key: "ticketsThisMonth",
        label: "Tickets this month",
        value: 225,
        deltaPercent: 12.4,
        higherIsBetter: true,
        comparedTo: "vs last month",
      },
      {
        key: "avgResolution",
        label: "Avg. resolution time",
        value: 4.2,
        decimals: 1,
        suffix: "h",
        deltaPercent: -8.3,
        higherIsBetter: false,
        comparedTo: "vs last month",
      },
      {
        key: "closedToday",
        label: "Tickets closed today",
        value: 9,
        deltaPercent: 28.6,
        higherIsBetter: true,
        comparedTo: "vs yesterday",
      },
      {
        key: "activeSites",
        label: "Active sites",
        value: 14,
        deltaPercent: 16.7,
        higherIsBetter: true,
        comparedTo: "vs last month",
      },
    ],
    periods,
    ticketsByStatus,
    weeklyHours,
    activity,
    topSites,
  };
}
