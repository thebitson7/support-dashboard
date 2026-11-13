import type { AttentionResponse, AttentionTicket } from "@/types/attention";

const THRESHOLDS = {
  due_soon_hours: 24,
  overdue_hours: 48,
  critical_hours: 72,
  no_activity_grace_hours: 24,
};

export function attentionTicket(overrides: Partial<AttentionTicket> = {}): AttentionTicket {
  return {
    id: 1001,
    cms_next_ticket_no: "DEMO-ATT-1001",
    site_name: "Tan Tock Seng Hospital",
    site_ocn: "OCN05529-801-00",
    customer_name: "SingHealth",
    level: "overdue",
    age_hours: 51,
    basis: "last_activity",
    clock_started_at: "2026-11-10T09:00:00Z",
    involved: [
      { id: 2, name: "Syed Hussain", roles: ["creator", "assignee"] },
      { id: 3, name: "Naleefa Kareem", roles: ["resolver"] },
    ],
    your_roles: ["creator", "assignee"],
    ...overrides,
  };
}

/** A staff response; counts are derived from the results. */
export function staffAttention(results: AttentionTicket[]): AttentionResponse {
  const counts = { due_soon: 0, overdue: 0, critical: 0 };
  for (const t of results) counts[t.level] += 1;
  return {
    generated_at: "2026-11-12T12:00:00Z",
    thresholds: THRESHOLDS,
    scope: "mine",
    counts,
    total: results.length,
    truncated: false,
    results,
  };
}

export function adminAttention(): AttentionResponse {
  const results = [
    attentionTicket({
      id: 1003,
      cms_next_ticket_no: "DEMO-ATT-1003",
      level: "critical",
      age_hours: 77,
      involved: [{ id: 4, name: "Wahida Begum", roles: ["creator", "assignee", "resolver"] }],
      your_roles: [],
    }),
    attentionTicket({ your_roles: [] }),
    attentionTicket({
      id: 1004,
      cms_next_ticket_no: "DEMO-ATT-1004",
      level: "due_soon",
      age_hours: 60,
      basis: "received",
      involved: [{ id: 3, name: "Naleefa Kareem", roles: ["creator", "assignee"] }],
      your_roles: [],
    }),
  ];
  return {
    ...staffAttention(results),
    scope: "all",
    people: [
      {
        user: { id: 4, name: "Wahida Begum" },
        counts: { critical: 1, overdue: 0, due_soon: 0 },
        ticket_ids: [1003],
      },
      {
        user: { id: 3, name: "Naleefa Kareem" },
        counts: { critical: 0, overdue: 1, due_soon: 1 },
        ticket_ids: [1001, 1004],
      },
      {
        user: { id: 2, name: "Syed Hussain" },
        counts: { critical: 0, overdue: 1, due_soon: 0 },
        ticket_ids: [1001],
      },
    ],
  };
}
