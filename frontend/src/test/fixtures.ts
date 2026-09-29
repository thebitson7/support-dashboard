// Wire-shaped sample data shared by tests. Timestamps are UTC, as the API
// sends them; tests run in America/New_York (UTC-4 in September).

import type { ApiTicketDetail, ApiUserRef } from "@/lib/tickets-api";

export const alice: ApiUserRef = {
  id: 3,
  username: "alice",
  first_name: "Alice",
  last_name: "Tan",
};
export const bob: ApiUserRef = { id: 4, username: "bob", first_name: "", last_name: "" };

/** A closed ticket with every field filled and one activity. */
export function closedTicket(overrides: Partial<ApiTicketDetail> = {}): ApiTicketDetail {
  return {
    id: 17,
    status: "closed",
    pdf_attachment_name: null,
    received_at: "2026-09-24T13:00:00Z",
    cms_next_ticket_no: "CMS-1001",
    site: { id: 5, name: "Tan Tock Seng", ocn: "OCN-5" },
    customer: { id: 8, name: "Lab One" },
    assigned_to: alice,
    ticket_type: "hardware",
    incoming_channel: "phone",
    is_forwarded: false,
    forwarded_to: null,
    cms_added_by: bob,
    cms_added_on: "2026-09-24T13:05:00Z",
    issue_description: "Analyzer offline",
    possible_root_cause: "",
    notes: "Rebooted",
    total_duration_hours: 1.5,
    is_pre: false,
    resolution_verified_by: alice,
    resolution_verified_on: "2026-09-25T14:00:00Z",
    cms_closed_by: bob,
    cms_closed_on: "2026-09-25T14:30:00Z",
    service_closed_date: "2026-09-25T15:00:00Z",
    activities: [
      {
        id: 91,
        activity_type: "remote_support",
        start_at: "2026-09-24T14:00:00Z",
        end_at: "2026-09-24T15:30:00Z",
        duration_minutes: 90,
        work_done_code: 2,
        is_likely_cause: true,
        resolved_by: alice,
      },
    ],
    created_by: alice,
    created_at: "2026-09-24T13:10:00Z",
    updated_at: "2026-09-25T15:00:00Z",
    ...overrides,
  };
}
