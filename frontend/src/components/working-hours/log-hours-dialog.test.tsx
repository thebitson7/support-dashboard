import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkLogEntry } from "@/types/working-hours";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { LogHoursDialog } from "@/components/working-hours/log-hours-dialog";

// The real ApiError (the dialog branches on it); only the network calls are fakes.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const TODAY = "2026-09-24";
const END_BEFORE_START =
  "End time must be after the start time. For a shift that crosses midnight, log it as two entries, one on each date.";

function entry(overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: 12,
    user: 3,
    date: "2026-09-23",
    start_time: "09:00",
    end_time: "10:30",
    category: "non_ams",
    hours: 1.5,
    note: "",
    is_auto: false,
    ticket: null,
    ticket_reference: null,
    created_at: "2026-09-23T14:00:00Z",
    ...overrides,
  };
}

function setup(props: Partial<Parameters<typeof LogHoursDialog>[0]> = {}) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <LogHoursDialog
      open
      onOpenChange={onOpenChange}
      userId={null}
      today={TODAY}
      entry={null}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { user: userEvent.setup(), onSaved, onOpenChange };
}

/** The time picker's hour column (the first of its Hour / Minute / AM-PM groups). */
function hourColumn(picker: HTMLElement) {
  const [hours] = within(picker).getAllByRole("group");
  if (!hours) throw new Error("time picker has no hour column");
  return hours;
}

/** The message shown under a field (its aria-describedby error). */
const fieldError = (name: string) => document.getElementById(`nt-${name}-error`)?.textContent;

beforeEach(() => {
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPatch).mockReset();
});

describe("LogHoursDialog validation", () => {
  it("shows no errors before the user has done anything", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Log Hours" })).toBeInTheDocument();
    expect(fieldError("start_time")).toBeUndefined();
    expect(fieldError("end_time")).toBeUndefined();
  });

  it("blocks submitting an empty form and names what's missing", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Log Hours" }));

    expect(fieldError("start_time")).toBe("Choose a start time.");
    expect(fieldError("end_time")).toBe("Choose an end time.");
    expect(fieldError("date")).toBeUndefined();
    expect(apiPost).not.toHaveBeenCalled();
    // Focus goes to the first invalid field.
    expect(document.activeElement?.id).toBe("nt-start_time");
  });

  it("refuses a date after 'today' (in the viewer's zone)", async () => {
    const { user } = setup({
      entry: entry({ date: "2026-09-25" }),
    });
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(fieldError("date")).toBe("You can't log hours for a future date.");
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("allows today itself", async () => {
    vi.mocked(apiPatch).mockResolvedValue(entry());
    const { user } = setup({ entry: entry({ date: TODAY }) });
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(fieldError("date")).toBeUndefined();
    expect(apiPatch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["10:00", "09:00"],
    ["10:00", "10:00"],
    ["22:00", "02:00"],
  ])("flags end %s -> %s immediately, before any submit", (start_time, end_time) => {
    setup({ entry: entry({ start_time, end_time }) });
    expect(fieldError("end_time")).toBe(END_BEFORE_START);
    expect(
      screen.getByText("The duration is worked out from the start and end times."),
    ).toBeVisible();
  });

  it("previews the duration of a valid range", () => {
    setup({ entry: entry({ start_time: "08:45", end_time: "17:15" }) });
    expect(screen.getByText("8h 30m")).toBeInTheDocument();
    expect(fieldError("end_time")).toBeUndefined();
  });

  it("clears the order error as soon as the times are fixed with the picker", async () => {
    const { user } = setup({ entry: entry({ start_time: "10:00", end_time: "09:00" }) });
    expect(fieldError("end_time")).toBe(END_BEFORE_START);

    // End time: 11 AM (the minutes and AM stay as they were: 00, AM).
    await user.click(document.getElementById("nt-end_time")!);
    const picker = await screen.findByRole("dialog", { name: "Choose a time" });
    await user.click(within(hourColumn(picker)).getByRole("button", { name: "11" }));
    await user.click(within(picker).getByRole("button", { name: "Done" }));

    expect(fieldError("end_time")).toBeUndefined();
    expect(screen.getByText("1h 00m")).toBeInTheDocument();
  });
});

describe("LogHoursDialog saving", () => {
  it("sends a new entry as Non-AMS, without hours (the server computes them)", async () => {
    vi.mocked(apiPost).mockResolvedValue(entry());
    const { user, onSaved, onOpenChange } = setup({ userId: "7", defaultDate: "2026-09-22" });

    for (const [field, hour] of [
      ["nt-start_time", "9"],
      ["nt-end_time", "11"],
    ] as const) {
      await user.click(document.getElementById(field)!);
      const picker = await screen.findByRole("dialog", { name: "Choose a time" });
      await user.click(within(hourColumn(picker)).getByRole("button", { name: hour }));
      await user.click(
        within(within(picker).getByRole("group", { name: "Minute" })).getByRole("button", {
          name: "00",
        }),
      );
      await user.click(within(picker).getByRole("button", { name: "AM" }));
      await user.click(within(picker).getByRole("button", { name: "Done" }));
    }
    await user.type(screen.getByRole("textbox", { name: /Note/ }), "  LIS outage  ");
    await user.click(screen.getByRole("button", { name: "Log Hours" }));

    expect(apiPost).toHaveBeenCalledWith("/working-hours/entries/?user_id=7", {
      date: "2026-09-22",
      category: "non_ams",
      start_time: "09:00",
      end_time: "11:00",
      note: "LIS outage",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("doesn't send a category when editing, so an old AMS entry stays AMS", async () => {
    vi.mocked(apiPatch).mockResolvedValue(entry());
    const { user } = setup({ entry: entry({ category: "ams" }) });
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(apiPatch).toHaveBeenCalledWith("/working-hours/entries/12/", {
      date: "2026-09-23",
      start_time: "09:00",
      end_time: "10:30",
      note: "",
    });
  });

  it("shows the API's field errors on their fields, and the rest as a general alert", async () => {
    vi.mocked(apiPatch).mockRejectedValue(
      new ApiError(400, "The request couldn't be completed.", {
        data: {
          start_time: ["Overlaps another entry (9:00 AM – 10:00 AM)."],
          non_field_errors: ["Daily limit reached."],
        },
      }),
    );
    const { user, onSaved } = setup({ entry: entry() });
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(fieldError("start_time")).toBe("Overlaps another entry (9:00 AM – 10:00 AM).");
    expect(screen.getByRole("alert")).toHaveTextContent("Daily limit reached.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the form open with a retry hint when the server can't be reached", async () => {
    vi.mocked(apiPatch).mockRejectedValue(new ApiError(0, "offline"));
    const { user, onOpenChange } = setup({ entry: entry() });
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't reach the server. Your entries are kept; try again.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
