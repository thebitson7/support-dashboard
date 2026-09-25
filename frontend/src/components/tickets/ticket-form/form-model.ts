// The New Ticket form's data model: values, choices, validation, the request
// payload, and mapping server errors back onto fields. No React in here.

import { isoToLocal, localToIso, localToMs, nowLocal } from "@/lib/local-datetime";
import { siteOption, userOption, type ApiTicketDetail, type ApiUserRef } from "@/lib/tickets-api";
import type { ComboOption } from "@/components/common/search-combobox";

// --- Choices (mirror tickets/models.py) ----------------------------------------

export const TICKET_TYPES = [
  { value: "hardware", label: "Hardware" },
  { value: "software", label: "Software" },
  { value: "network", label: "Network" },
  { value: "configuration", label: "Configuration" },
  { value: "training", label: "Training / How-to" },
  { value: "other", label: "Other" },
];

export const INCOMING_CHANNELS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "portal", label: "Customer Portal" },
  { value: "remote_monitoring", label: "Remote Monitoring Alert" },
  { value: "walk_in", label: "Walk-in / On-site" },
];

export const ACTIVITY_TYPES = [
  { value: "troubleshooting", label: "Troubleshooting" },
  { value: "remote_support", label: "Remote Support" },
  { value: "onsite_visit", label: "On-site Visit" },
  { value: "escalation", label: "Escalation" },
  { value: "follow_up", label: "Follow-up" },
  { value: "training", label: "Training" },
];

export const labelOf = (choices: { value: string; label: string }[], value: string) =>
  choices.find((c) => c.value === value)?.label ?? value;

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

// --- Values --------------------------------------------------------------------
// Keys are the API's field names, so server errors map straight back.
// Date-times are local "YYYY-MM-DDTHH:mm" strings (see lib/local-datetime),
// converted to ISO only in the request payload.

export type TicketValues = {
  pdf_attachment: File | null;
  received_at: string;
  cms_next_ticket_no: string;
  site: ComboOption | null;
  customer: ComboOption | null;
  assigned_to: ComboOption | null;
  ticket_type: string;
  incoming_channel: string;
  is_forwarded: boolean;
  forwarded_to: ComboOption | null;
  cms_added_by: ComboOption | null;
  cms_added_on: string;
  issue_description: string;
  possible_root_cause: string;
  notes: string;
  /** Only used (and editable) while there are no activities. */
  total_duration_hours: string;
  is_pre: boolean;
  resolution_verified_by: ComboOption | null;
  resolution_verified_on: string;
  cms_closed_by: ComboOption | null;
  cms_closed_on: string;
  service_closed_date: string;
};

export type FieldKey = keyof TicketValues;

export type ActivityDraft = {
  /** Client-side identity for list rendering / editing. */
  key: string;
  activity_type: string;
  start_at: string;
  end_at: string;
  work_done_code: string;
  /** This activity identified the likely cause of the issue. */
  is_likely_cause: boolean;
  resolved_by: ComboOption | null;
};

export type ActivityField = Exclude<keyof ActivityDraft, "key">;

export function initialValues(): TicketValues {
  const now = nowLocal();
  return {
    pdf_attachment: null,
    received_at: now,
    cms_next_ticket_no: "",
    site: null,
    customer: null,
    assigned_to: null,
    ticket_type: "",
    incoming_channel: "",
    is_forwarded: false,
    forwarded_to: null,
    cms_added_by: null,
    cms_added_on: now,
    issue_description: "",
    possible_root_cause: "",
    notes: "",
    total_duration_hours: "",
    is_pre: false,
    resolution_verified_by: null,
    resolution_verified_on: "",
    cms_closed_by: null,
    cms_closed_on: "",
    service_closed_date: "",
  };
}

/** An existing ticket (edit mode) -> form values. */
export function valuesFromTicket(t: ApiTicketDetail): TicketValues {
  const user = (u: ApiUserRef | null) => (u ? userOption(u) : null);
  return {
    // The stored file is shown separately; this holds a *new* upload only.
    pdf_attachment: null,
    received_at: isoToLocal(t.received_at),
    cms_next_ticket_no: t.cms_next_ticket_no,
    site: siteOption(t.site),
    customer: { value: String(t.customer.id), label: t.customer.name },
    assigned_to: userOption(t.assigned_to),
    ticket_type: t.ticket_type,
    incoming_channel: t.incoming_channel,
    is_forwarded: t.is_forwarded,
    forwarded_to: user(t.forwarded_to),
    cms_added_by: user(t.cms_added_by),
    cms_added_on: isoToLocal(t.cms_added_on),
    issue_description: t.issue_description,
    possible_root_cause: t.possible_root_cause,
    notes: t.notes,
    total_duration_hours: t.total_duration_hours.toFixed(2),
    is_pre: t.is_pre,
    resolution_verified_by: user(t.resolution_verified_by),
    resolution_verified_on: isoToLocal(t.resolution_verified_on),
    cms_closed_by: user(t.cms_closed_by),
    cms_closed_on: isoToLocal(t.cms_closed_on),
    service_closed_date: isoToLocal(t.service_closed_date),
  };
}

export function activitiesFromTicket(t: ApiTicketDetail): ActivityDraft[] {
  return t.activities.map((a) => ({
    key: `saved-${a.id}`,
    activity_type: a.activity_type,
    start_at: isoToLocal(a.start_at),
    end_at: isoToLocal(a.end_at),
    work_done_code: String(a.work_done_code),
    is_likely_cause: a.is_likely_cause,
    resolved_by: a.resolved_by ? userOption(a.resolved_by) : null,
  }));
}

/** Whole minutes between two local date-times; null if either is missing/invalid. */
export function minutesBetween(start: string, end: string): number | null {
  const ms = localToMs(end) - localToMs(start);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : null;
}

export function activitiesTotalHours(activities: ActivityDraft[]): number {
  const minutes = activities.reduce(
    (sum, a) => sum + (minutesBetween(a.start_at, a.end_at) ?? 0),
    0,
  );
  return Math.round((minutes / 60) * 100) / 100;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// --- Tabs ----------------------------------------------------------------------

export type TabId = "ticket" | "activities" | "verification";

export const VERIFICATION_FIELDS = [
  "resolution_verified_by",
  "resolution_verified_on",
  "cms_closed_by",
  "cms_closed_on",
  "service_closed_date",
] as const satisfies readonly FieldKey[];

const VERIFICATION_SET = new Set<FieldKey>(VERIFICATION_FIELDS);

export function tabOfField(field: string): TabId {
  if (field === "activities") return "activities";
  return VERIFICATION_SET.has(field as FieldKey) ? "verification" : "ticket";
}

// --- Validation (mirrors the API's rules; the API still has the final say) -----

export const REQUIRED_TICKET_FIELDS = [
  "received_at",
  "cms_next_ticket_no",
  "site",
  "customer",
  "assigned_to",
  "ticket_type",
  "incoming_channel",
  "cms_added_on",
  "issue_description",
  "notes",
] as const satisfies readonly FieldKey[];

const isEmpty = (value: TicketValues[FieldKey]) =>
  value === null || (typeof value === "string" && value.trim() === "");

export type FieldErrors = Partial<Record<FieldKey, string>>;

export function validateTicket(values: TicketValues, activityCount: number): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of REQUIRED_TICKET_FIELDS) {
    if (isEmpty(values[field])) errors[field] = "This field is required.";
  }
  if (values.is_forwarded && !values.forwarded_to) {
    errors.forwarded_to = "Choose who the ticket was forwarded to.";
  }
  if (activityCount === 0 && values.total_duration_hours.trim()) {
    const hours = Number(values.total_duration_hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 9999.99) {
      errors.total_duration_hours = "Enter hours between 0 and 9999.99.";
    }
  }
  // All-or-nothing: an open ticket leaves verification empty; closing it
  // needs every field.
  if (VERIFICATION_FIELDS.some((f) => !isEmpty(values[f]))) {
    for (const field of VERIFICATION_FIELDS) {
      if (isEmpty(values[field])) errors[field] = "Required to close the ticket.";
    }
  }
  return errors;
}

export type ActivityErrors = Partial<Record<ActivityField, string>>;

export function validateActivity(a: Omit<ActivityDraft, "key">): ActivityErrors {
  const errors: ActivityErrors = {};
  if (!a.activity_type) errors.activity_type = "Choose an activity type.";
  if (!a.start_at) errors.start_at = "Enter a start date and time.";
  if (!a.end_at) errors.end_at = "Enter an end date and time.";
  if (!a.work_done_code) errors.work_done_code = "Choose a work done code.";
  if (a.start_at && a.end_at && localToMs(a.end_at) < localToMs(a.start_at)) {
    errors.end_at = "End must be after the start.";
  }
  return errors;
}

// --- Request payload -------------------------------------------------------------

/**
 * Multipart body for create (POST) and edit (PATCH): the PDF as a file part,
 * activities as a JSON string part (always the complete set).
 *
 * Required fields are sent when filled. Optional ones are always sent, empty
 * meaning "none", so an edit can clear them (e.g. reopen a ticket by
 * emptying verification, or drop a recipient).
 */
export function buildTicketFormData(
  values: TicketValues,
  activities: ActivityDraft[],
  options: { removeExistingPdf?: boolean } = {},
): FormData {
  const form = new FormData();
  const put = (key: string, value: string | null | undefined) => {
    if (value) form.append(key, value);
  };
  const putOrClear = (key: string, value: string | null | undefined) =>
    form.append(key, value ?? "");
  const iso = (local: string) => (local ? localToIso(local) : "");

  if (values.pdf_attachment) form.append("pdf_attachment", values.pdf_attachment);
  else if (options.removeExistingPdf) form.append("pdf_attachment", "");

  put("received_at", iso(values.received_at));
  put("cms_next_ticket_no", values.cms_next_ticket_no.trim());
  put("site", values.site?.value);
  put("customer", values.customer?.value);
  put("assigned_to", values.assigned_to?.value);
  put("ticket_type", values.ticket_type);
  put("incoming_channel", values.incoming_channel);
  form.append("is_forwarded", String(values.is_forwarded));
  putOrClear("forwarded_to", values.is_forwarded ? values.forwarded_to?.value : null);
  putOrClear("cms_added_by", values.cms_added_by?.value);
  put("cms_added_on", iso(values.cms_added_on));
  put("issue_description", values.issue_description.trim());
  putOrClear("possible_root_cause", values.possible_root_cause.trim());
  put("notes", values.notes.trim());
  // With activities the server computes the total itself.
  if (activities.length === 0) put("total_duration_hours", values.total_duration_hours.trim());
  form.append("is_pre", String(values.is_pre));
  putOrClear("resolution_verified_by", values.resolution_verified_by?.value);
  putOrClear("resolution_verified_on", iso(values.resolution_verified_on));
  putOrClear("cms_closed_by", values.cms_closed_by?.value);
  putOrClear("cms_closed_on", iso(values.cms_closed_on));
  putOrClear("service_closed_date", iso(values.service_closed_date));
  form.append(
    "activities",
    JSON.stringify(
      activities.map((a) => ({
        activity_type: a.activity_type,
        start_at: localToIso(a.start_at),
        end_at: localToIso(a.end_at),
        work_done_code: Number(a.work_done_code),
        is_likely_cause: a.is_likely_cause,
        resolved_by: a.resolved_by ? Number(a.resolved_by.value) : null,
      })),
    ),
  );
  return form;
}

// --- Server errors ------------------------------------------------------------

export type ServerErrors = {
  fields: FieldErrors;
  /** Keyed by the activity's client `key`. */
  activities: Record<string, ActivityErrors>;
  /** Anything that doesn't belong to a single field. */
  general: string[];
};

const FIELD_KEYS = new Set<string>(Object.keys(initialValues()));

const firstMessage = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
};

/**
 * DRF 400 body -> per-field messages. Nested activity errors arrive keyed by
 * index ({"1": {...}}) or as a list aligned with what was sent; both work.
 */
export function mapServerErrors(data: unknown, activities: ActivityDraft[]): ServerErrors {
  const result: ServerErrors = { fields: {}, activities: {}, general: [] };
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    result.general.push("The server rejected the ticket.");
    return result;
  }

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === "activities") {
      const message = firstMessage(value);
      if (message) {
        result.general.push(`Activities: ${message}`);
        continue;
      }
      const entries = Array.isArray(value) ? value.entries() : Object.entries(value ?? {});
      for (const [index, itemErrors] of entries) {
        const activity = activities[Number(index)];
        if (!activity || !itemErrors || typeof itemErrors !== "object") continue;
        const mapped: ActivityErrors = {};
        for (const [field, messages] of Object.entries(itemErrors as Record<string, unknown>)) {
          const text = firstMessage(messages);
          if (text) mapped[field as ActivityField] = text;
        }
        if (Object.keys(mapped).length) result.activities[activity.key] = mapped;
      }
      continue;
    }
    const message = firstMessage(value);
    if (!message) continue;
    if (FIELD_KEYS.has(key)) result.fields[key as FieldKey] = message;
    else result.general.push(message);
  }
  return result;
}
