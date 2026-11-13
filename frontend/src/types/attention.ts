// GET /api/tickets/attention/: open tickets waiting to be closed (see
// backend/tickets/attention.py for the rules).

export type AttentionLevel = "due_soon" | "overdue" | "critical";

export type AttentionRole = "creator" | "assignee" | "forwarded" | "cms_added" | "resolver";

export type AttentionCounts = Record<AttentionLevel, number>;

export type AttentionThresholds = {
  due_soon_hours: number;
  overdue_hours: number;
  critical_hours: number;
  no_activity_grace_hours: number;
};

export type AttentionInvolved = { id: number; name: string; roles: AttentionRole[] };

export type AttentionTicket = {
  id: number;
  cms_next_ticket_no: string;
  site_name: string;
  site_ocn: string;
  customer_name: string;
  level: AttentionLevel;
  /** Calendar hours since the clock started, one decimal. */
  age_hours: number;
  /** last_activity: since the latest activity ended; received: no activities yet. */
  basis: "last_activity" | "received";
  clock_started_at: string;
  involved: AttentionInvolved[];
  your_roles: AttentionRole[];
};

export type AttentionPerson = {
  user: { id: number; name: string };
  counts: AttentionCounts;
  ticket_ids: number[];
};

export type AttentionResponse = {
  generated_at: string;
  thresholds: AttentionThresholds;
  scope: "mine" | "all";
  counts: AttentionCounts;
  total: number;
  truncated: boolean;
  results: AttentionTicket[];
  /** Admins only; absent for staff. */
  people?: AttentionPerson[];
};
