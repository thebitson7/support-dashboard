// Wire shape of /api/audit/logs/ (admin role only).

export type AuditActionGroup = "Sign-in" | "Tickets" | "Work logs" | "Lookups" | "Users";

/** One of /api/audit/logs/actions/. */
export type AuditAction = { value: string; label: string; group: AuditActionGroup };

export type AuditEntry = {
  id: number;
  /** ISO date-time. */
  created_at: string;
  /** Null once that account no longer exists; actor_username is kept either way. */
  actor: number | null;
  actor_username: string;
  action: string;
  action_label: string;
  /** e.g. "ticket", "work_log", "site", "user"; "" when there's none. */
  target_type: string;
  target_id: string;
  target_label: string;
  description: string;
  metadata: Record<string, unknown>;
  ip_address: string;
};

export type AuditPage = {
  count: number;
  next: string | null;
  previous: string | null;
  results: AuditEntry[];
  /** The date range actually applied (defaults filled in). */
  start_date: string;
  end_date: string;
};
