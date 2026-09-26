// Everything the tickets UI needs from /api/tickets (and the shared user
// search), mapped onto the frontend's own shapes so components never see
// wire formats.

import type { AmsTicket, TicketStatus } from "@/types/tickets";
import { apiGet } from "@/lib/api";
import { displayName, type AuthUser } from "@/lib/auth";
import type { ComboOption } from "@/components/common/search-combobox";

// --- Wire shapes ---------------------------------------------------------------

export type ApiTicketRow = {
  id: number;
  site_name: string;
  site_ocn: string;
  cms_next_ticket_no: string;
  received_at: string;
  status: "open" | "closed";
  is_pre: boolean;
  cms_closed_by: string | null;
  created_by: string;
  total_duration_hours: number;
  cms_closed_on: string | null;
  service_closed_date: string | null;
};

export type TicketListResponse = {
  /** Rows matching the current search/filters. */
  count: number;
  /** All tickets, ignoring search/filters ("no tickets yet" vs "no matches"). */
  total: number;
  results: ApiTicketRow[];
};

export type ApiSite = { id: number; name: string; ocn: string };
export type ApiUserRef = { id: number; username: string; first_name: string; last_name: string };
export type ApiCustomer = { id: number; name: string };
export type ApiWorkDoneCode = {
  id: number;
  code: string;
  description: string;
  /** Inactive codes label existing activities but can't be newly chosen. */
  is_active: boolean;
};

export type ApiTicketActivity = {
  id: number;
  activity_type: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  work_done_code: number;
  is_likely_cause: boolean;
  resolved_by: ApiUserRef | null;
};

/** GET /tickets/<id>/: everything the edit form needs, references expanded. */
export type ApiTicketDetail = {
  id: number;
  status: "open" | "closed";
  pdf_attachment_name: string | null;
  received_at: string;
  cms_next_ticket_no: string;
  site: ApiSite;
  customer: ApiCustomer;
  assigned_to: ApiUserRef;
  ticket_type: string;
  incoming_channel: string;
  is_forwarded: boolean;
  forwarded_to: ApiUserRef | null;
  cms_added_by: ApiUserRef | null;
  cms_added_on: string;
  issue_description: string;
  possible_root_cause: string;
  notes: string;
  total_duration_hours: number;
  is_pre: boolean;
  resolution_verified_by: ApiUserRef | null;
  resolution_verified_on: string | null;
  cms_closed_by: ApiUserRef | null;
  cms_closed_on: string | null;
  service_closed_date: string | null;
  activities: ApiTicketActivity[];
  created_by: ApiUserRef;
  created_at: string;
  updated_at: string;
};

// --- List ---------------------------------------------------------------------

const toMs = (iso: string | null) => (iso ? Date.parse(iso) : null);

export function toAmsTicket(row: ApiTicketRow): AmsTicket {
  return {
    id: String(row.id),
    siteName: row.site_name,
    siteOcn: row.site_ocn,
    cmsTicketNo: row.cms_next_ticket_no,
    receivedAt: Date.parse(row.received_at),
    status: (row.status === "closed" ? "Closed" : "Open") satisfies TicketStatus,
    pre: row.is_pre,
    closedBy: row.cms_closed_by,
    createdBy: row.created_by,
    durationHours: row.total_duration_hours,
    cmsClosedOn: toMs(row.cms_closed_on),
    serviceClosedDate: toMs(row.service_closed_date),
  };
}

/** Table column id -> the API's `ordering` key. */
const ORDERING_KEY: Record<string, string> = {
  siteName: "site_name",
  siteOcn: "site_ocn",
  cmsTicketNo: "cms_next_ticket_no",
  receivedAt: "received_at",
  status: "status",
  closedBy: "cms_closed_by",
  createdBy: "created_by",
  durationHours: "total_duration_hours",
  cmsClosedOn: "cms_closed_on",
  serviceClosedDate: "service_closed_date",
};

export type TicketListQuery = {
  pageIndex: number;
  pageSize: number;
  sort?: { id: string; desc: boolean };
  search: string;
  status?: TicketStatus;
  siteId?: string;
  /** Epoch ms, inclusive; ±Infinity for an open end. */
  receivedRange?: [number, number];
};

export function ticketListPath(q: TicketListQuery): string {
  const params = new URLSearchParams({
    page: String(q.pageIndex + 1),
    page_size: String(q.pageSize),
  });
  const orderingKey = q.sort && ORDERING_KEY[q.sort.id];
  if (orderingKey) params.set("ordering", `${q.sort?.desc ? "-" : ""}${orderingKey}`);
  if (q.search.trim()) params.set("search", q.search.trim());
  if (q.status) params.set("status", q.status.toLowerCase());
  if (q.siteId) params.set("site", q.siteId);
  const [from, to] = q.receivedRange ?? [-Infinity, Infinity];
  if (Number.isFinite(from)) params.set("received_after", new Date(from).toISOString());
  if (Number.isFinite(to)) params.set("received_before", new Date(to).toISOString());
  return `/tickets/?${params}`;
}

// --- Typeahead loaders (for SearchCombobox) -------------------------------------

const withQuery = (path: string, query: string) =>
  query ? `${path}?${new URLSearchParams({ q: query })}` : path;

export async function searchSites(query: string, signal: AbortSignal): Promise<ComboOption[]> {
  const sites = await apiGet<ApiSite[]>(withQuery("/tickets/sites/", query), { signal });
  return sites.map(siteOption);
}

export function siteOption(site: ApiSite): ComboOption {
  return { value: String(site.id), label: site.name, description: site.ocn };
}

export async function searchCustomers(query: string, signal: AbortSignal): Promise<ComboOption[]> {
  const customers = await apiGet<ApiCustomer[]>(withQuery("/tickets/customers/", query), {
    signal,
  });
  return customers.map(customerOption);
}

export function customerOption(customer: ApiCustomer): ComboOption {
  return { value: String(customer.id), label: customer.name };
}

export function userOption(user: ApiUserRef | AuthUser): ComboOption {
  return { value: String(user.id), label: displayName(user), description: `@${user.username}` };
}

export async function searchUsers(query: string, signal: AbortSignal): Promise<ComboOption[]> {
  const users = await apiGet<ApiUserRef[]>(withQuery("/accounts/users/", query), { signal });
  return users.map(userOption);
}
