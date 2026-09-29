import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activitiesFromTicket,
  activitiesTotalHours,
  buildTicketFormData,
  formatMinutes,
  initialValues,
  mapServerErrors,
  minutesBetween,
  tabOfField,
  validateActivity,
  validateTicket,
  valuesFromTicket,
  type ActivityDraft,
  type TicketValues,
} from "@/components/tickets/ticket-form/form-model";
import { closedTicket } from "@/test/fixtures";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T13:00:00Z")); // 09:00 in New York
});

afterEach(() => {
  vi.useRealTimers();
});

const option = (value: string, label = value) => ({ value, label });

/** Every required field filled; verification empty (an open ticket). */
function validOpenTicket(overrides: Partial<TicketValues> = {}): TicketValues {
  return {
    ...initialValues(),
    cms_next_ticket_no: "CMS-1",
    site: option("5"),
    customer: option("8"),
    assigned_to: option("3"),
    ticket_type: "hardware",
    incoming_channel: "phone",
    issue_description: "Analyzer offline",
    notes: "Rebooted",
    ...overrides,
  };
}

const activity = (overrides: Partial<ActivityDraft> = {}): ActivityDraft => ({
  key: "a1",
  activity_type: "troubleshooting",
  start_at: "2026-09-24T09:00",
  end_at: "2026-09-24T10:30",
  work_done_code: "2",
  is_likely_cause: false,
  resolved_by: null,
  ...overrides,
});

describe("initial and loaded values", () => {
  it("a new ticket starts received and added 'now', everything else empty", () => {
    const values = initialValues();
    expect(values.received_at).toBe("2026-09-24T09:00");
    expect(values.cms_added_on).toBe("2026-09-24T09:00");
    expect(values.site).toBeNull();
    expect(values.resolution_verified_on).toBe("");
  });

  it("maps an existing ticket onto the form in local time", () => {
    const values = valuesFromTicket(closedTicket());
    expect(values.received_at).toBe("2026-09-24T09:00");
    expect(values.site).toEqual({ value: "5", label: "Tan Tock Seng", description: "OCN-5" });
    expect(values.assigned_to).toEqual({ value: "3", label: "Alice Tan", description: "@alice" });
    // A user without a name falls back to the username.
    expect(values.cms_added_by?.label).toBe("bob");
    expect(values.total_duration_hours).toBe("1.50");
    expect(values.service_closed_date).toBe("2026-09-25T11:00");
    // The stored PDF is shown separately: this field holds a new upload only.
    expect(values.pdf_attachment).toBeNull();
  });

  it("gives saved activities stable keys and local times", () => {
    expect(activitiesFromTicket(closedTicket())).toEqual([
      {
        key: "saved-91",
        activity_type: "remote_support",
        start_at: "2026-09-24T10:00",
        end_at: "2026-09-24T11:30",
        work_done_code: "2",
        is_likely_cause: true,
        resolved_by: { value: "3", label: "Alice Tan", description: "@alice" },
      },
    ]);
  });
});

describe("durations", () => {
  it("counts whole minutes between two local date-times", () => {
    expect(minutesBetween("2026-09-24T09:00", "2026-09-24T10:30")).toBe(90);
    expect(minutesBetween("2026-09-24T23:30", "2026-09-25T00:15")).toBe(45);
  });

  it("clamps a backwards range to 0 and is null for missing values", () => {
    expect(minutesBetween("2026-09-24T10:00", "2026-09-24T09:00")).toBe(0);
    expect(minutesBetween("", "2026-09-24T09:00")).toBeNull();
    expect(minutesBetween("2026-09-24T09:00", "")).toBeNull();
  });

  it("measures real elapsed time across a daylight-saving change", () => {
    // Clocks jump 02:00 -> 03:00 on 8 Mar 2026 in New York: 01:00 -> 04:00 is 2 h.
    expect(minutesBetween("2026-03-08T01:00", "2026-03-08T04:00")).toBe(120);
  });

  it("totals activities in hours to 2 decimals, skipping incomplete ones", () => {
    expect(
      activitiesTotalHours([
        activity({ start_at: "2026-09-24T09:00", end_at: "2026-09-24T09:20" }),
        activity({ start_at: "2026-09-24T10:00", end_at: "2026-09-24T10:00" }),
        activity({ start_at: "2026-09-24T11:00", end_at: "" }),
      ]),
    ).toBe(0.33);
    expect(activitiesTotalHours([])).toBe(0);
  });

  it("formats minutes as 'Xh MMm', or just minutes under an hour", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h 00m");
    expect(formatMinutes(125)).toBe("2h 05m");
  });
});

describe("tabOfField", () => {
  it("routes each field to the tab that shows it", () => {
    expect(tabOfField("cms_next_ticket_no")).toBe("ticket");
    expect(tabOfField("total_duration_hours")).toBe("ticket");
    expect(tabOfField("activities")).toBe("activities");
    expect(tabOfField("cms_closed_on")).toBe("verification");
    expect(tabOfField("service_closed_date")).toBe("verification");
    // Anything unknown (e.g. non_field_errors) stays on the first tab.
    expect(tabOfField("non_field_errors")).toBe("ticket");
  });
});

describe("validateTicket", () => {
  it("accepts a complete open ticket", () => {
    expect(validateTicket(validOpenTicket(), 0)).toEqual({});
  });

  it("requires every required field, treating whitespace as empty", () => {
    const errors = validateTicket({ ...initialValues(), notes: "   " }, 0);
    expect(Object.keys(errors).sort()).toEqual(
      [
        "assigned_to",
        "cms_next_ticket_no",
        "customer",
        "incoming_channel",
        "issue_description",
        "notes",
        "site",
        "ticket_type",
      ].sort(),
    );
    expect(errors.notes).toBe("This field is required.");
  });

  it("needs a recipient only when the ticket is forwarded", () => {
    expect(validateTicket(validOpenTicket({ is_forwarded: true }), 0).forwarded_to).toBe(
      "Choose who the ticket was forwarded to.",
    );
    expect(
      validateTicket(validOpenTicket({ is_forwarded: true, forwarded_to: option("4") }), 0),
    ).toEqual({});
  });

  it.each([
    ["-1", false],
    ["abc", false],
    ["10000", false],
    ["9999.99", true],
    ["0", true],
    ["", true],
    ["1.5", true],
  ])("manual total %j valid: %s (no activities)", (hours, valid) => {
    const errors = validateTicket(validOpenTicket({ total_duration_hours: hours }), 0);
    expect(errors.total_duration_hours === undefined).toBe(valid);
  });

  it("ignores the manual total once there are activities (the server computes it)", () => {
    expect(validateTicket(validOpenTicket({ total_duration_hours: "abc" }), 1)).toEqual({});
  });

  it("is all-or-nothing on verification: one field set means all are required", () => {
    const partial = validOpenTicket({ cms_closed_on: "2026-09-25T10:00" });
    expect(validateTicket(partial, 0)).toEqual({
      resolution_verified_by: "Required to close the ticket.",
      resolution_verified_on: "Required to close the ticket.",
      cms_closed_by: "Required to close the ticket.",
      service_closed_date: "Required to close the ticket.",
    });
  });

  it("accepts a fully verified (closed) ticket", () => {
    expect(validateTicket(valuesFromTicket(closedTicket()), 1)).toEqual({});
  });
});

describe("validateActivity", () => {
  const complete: Omit<ActivityDraft, "key"> = {
    activity_type: "troubleshooting",
    start_at: "2026-09-24T09:00",
    end_at: "2026-09-24T10:30",
    work_done_code: "2",
    is_likely_cause: false,
    resolved_by: null,
  };

  it("accepts a complete activity, including a zero-length one", () => {
    expect(validateActivity(complete)).toEqual({});
    expect(validateActivity({ ...complete, end_at: complete.start_at })).toEqual({});
  });

  it("names each missing field", () => {
    expect(
      validateActivity({
        ...complete,
        activity_type: "",
        start_at: "",
        end_at: "",
        work_done_code: "",
      }),
    ).toEqual({
      activity_type: "Choose an activity type.",
      start_at: "Enter a start date and time.",
      end_at: "Enter an end date and time.",
      work_done_code: "Choose a work done code.",
    });
  });

  it("refuses an end before the start, even across days", () => {
    expect(
      validateActivity({ ...complete, start_at: "2026-09-25T00:10", end_at: "2026-09-24T23:50" })
        .end_at,
    ).toBe("End must be after the start.");
  });
});

describe("buildTicketFormData", () => {
  const entries = (form: FormData) => Object.fromEntries(form.entries());

  it("sends required fields, converts date-times to UTC and trims text", () => {
    const form = buildTicketFormData(
      validOpenTicket({ cms_next_ticket_no: "  CMS-1  ", notes: " done " }),
      [],
    );
    const data = entries(form);
    expect(data.received_at).toBe("2026-09-24T13:00:00.000Z");
    expect(data.cms_next_ticket_no).toBe("CMS-1");
    expect(data.notes).toBe("done");
    expect(data.site).toBe("5");
    expect(data.is_forwarded).toBe("false");
    expect(data.activities).toBe("[]");
    expect(form.has("pdf_attachment")).toBe(false);
  });

  it("always sends optional fields, empty meaning 'clear it'", () => {
    const data = entries(buildTicketFormData(validOpenTicket(), []));
    for (const field of [
      "forwarded_to",
      "cms_added_by",
      "possible_root_cause",
      "resolution_verified_by",
      "resolution_verified_on",
      "cms_closed_by",
      "cms_closed_on",
      "service_closed_date",
    ]) {
      expect(data[field], field).toBe("");
    }
  });

  it("drops a stale recipient when the ticket is no longer forwarded", () => {
    const data = entries(
      buildTicketFormData(validOpenTicket({ is_forwarded: false, forwarded_to: option("4") }), []),
    );
    expect(data.forwarded_to).toBe("");
  });

  it("sends the manual total only while there are no activities", () => {
    const values = validOpenTicket({ total_duration_hours: " 2.5 " });
    expect(buildTicketFormData(values, []).get("total_duration_hours")).toBe("2.5");
    expect(buildTicketFormData(values, [activity()]).has("total_duration_hours")).toBe(false);
  });

  it("serialises activities with UTC times and numeric ids", () => {
    const form = buildTicketFormData(validOpenTicket(), [
      activity({ resolved_by: option("3"), is_likely_cause: true }),
    ]);
    expect(JSON.parse(form.get("activities") as string)).toEqual([
      {
        activity_type: "troubleshooting",
        start_at: "2026-09-24T13:00:00.000Z",
        end_at: "2026-09-24T14:30:00.000Z",
        work_done_code: 2,
        is_likely_cause: true,
        resolved_by: 3,
      },
    ]);
  });

  it("attaches a new PDF, or an empty part to remove the stored one", () => {
    const pdf = new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" });
    const withFile = buildTicketFormData(validOpenTicket({ pdf_attachment: pdf }), [], {
      removeExistingPdf: true,
    });
    expect((withFile.get("pdf_attachment") as File).name).toBe("report.pdf");

    const removing = buildTicketFormData(validOpenTicket(), [], { removeExistingPdf: true });
    expect(removing.get("pdf_attachment")).toBe("");
  });
});

describe("mapServerErrors", () => {
  const drafts = [activity({ key: "first" }), activity({ key: "second" })];

  it("puts known fields on their field and everything else in general", () => {
    expect(
      mapServerErrors(
        {
          cms_next_ticket_no: ["A ticket with this CMS number already exists."],
          non_field_errors: ["Something about the whole ticket."],
          site: "Invalid pk.",
        },
        drafts,
      ),
    ).toEqual({
      fields: {
        cms_next_ticket_no: "A ticket with this CMS number already exists.",
        site: "Invalid pk.",
      },
      activities: {},
      general: ["Something about the whole ticket."],
    });
  });

  it("maps nested activity errors keyed by index onto the right draft", () => {
    const result = mapServerErrors(
      { activities: { "1": { end_at: ["End must be after start."] } } },
      drafts,
    );
    expect(result.activities).toEqual({ second: { end_at: "End must be after start." } });
  });

  it("maps a DRF list of activity errors aligned with what was sent", () => {
    const result = mapServerErrors(
      { activities: [{}, { work_done_code: ["This code is inactive."] }] },
      drafts,
    );
    expect(result.activities).toEqual({ second: { work_done_code: "This code is inactive." } });
  });

  it("reports an activities-level message generally, and ignores out-of-range indexes", () => {
    expect(mapServerErrors({ activities: ["Too many activities."] }, drafts).general).toEqual([
      "Activities: Too many activities.",
    ]);
    expect(mapServerErrors({ activities: { "9": { end_at: ["x"] } } }, drafts).activities).toEqual(
      {},
    );
  });

  it("falls back to a general message for a body that isn't an object", () => {
    for (const body of [undefined, null, "oops", ["a"]]) {
      expect(mapServerErrors(body, drafts)).toEqual({
        fields: {},
        activities: {},
        general: ["The server rejected the ticket."],
      });
    }
  });
});
