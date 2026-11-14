// Confirmed overlaps stay visible on the Job Sheet: a flag on the entry (with
// the minutes in its accessible name and tooltip) and a line in the day
// summary, only when there is any overlapping time.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkLogEntry } from "@/types/working-hours";
import { DayEntries } from "@/components/job-sheets/day-entries";
import { DaySummary } from "@/components/job-sheets/day-summary";

function entry(overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: 1,
    user: 3,
    date: "2026-11-12",
    start_time: "09:00",
    end_time: "10:00",
    category: "non_ams",
    hours: 1,
    note: "",
    is_auto: false,
    ticket: null,
    ticket_reference: null,
    overlaps_with_other_time: false,
    overlap_minutes: 0,
    created_at: "2026-11-12T02:00:00Z",
    ...overrides,
  };
}

const OVERLAPPING = [
  entry({ id: 1, overlaps_with_other_time: true, overlap_minutes: 30 }),
  entry({
    id: 2,
    start_time: "09:30",
    end_time: "10:30",
    overlaps_with_other_time: true,
    overlap_minutes: 30,
  }),
  entry({ id: 3, start_time: "11:00", end_time: "12:00" }),
];

function renderEntries(entries: WorkLogEntry[]) {
  render(
    <DayEntries
      entries={entries}
      error={undefined}
      onRetry={vi.fn()}
      canLog
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

describe("Job Sheet overlap flag", () => {
  it("marks only the overlapping entries, in words, with the minutes", () => {
    renderEntries(OVERLAPPING);
    expect(screen.getAllByText("Overlaps other time")).toHaveLength(2);
    const flags = screen.getAllByRole("button", { name: /^Overlaps other time:/ });
    expect(flags).toHaveLength(2);
    expect(flags[0]).toHaveAccessibleName(
      "Overlaps other time: 30 min of this entry overlaps other work logged that day, and is counted twice in the hours.",
    );
  });

  it("shows no flag when nothing overlaps", () => {
    renderEntries([entry(), entry({ id: 2, start_time: "10:00", end_time: "11:00" })]);
    expect(screen.queryByText("Overlaps other time")).not.toBeInTheDocument();
  });
});

describe("Job Sheet day summary", () => {
  it("says how much overlapping time the total includes", () => {
    render(<DaySummary entries={OVERLAPPING} />);
    expect(screen.getByText("Includes 30 min of overlapping time")).toBeVisible();
    // The total itself is unchanged: 60 + 60 + 60 minutes, counted twice where they overlap.
    expect(screen.getAllByText("3h 00m")[0]).toBeVisible();
  });

  it("uses hours for longer overlaps", () => {
    render(
      <DaySummary
        entries={[
          entry({ start_time: "08:00", end_time: "10:00" }),
          entry({ id: 2, start_time: "08:45", end_time: "11:00" }),
        ]}
      />,
    );
    expect(screen.getByText("Includes 1 h 15 min of overlapping time")).toBeVisible();
  });

  it("has no line when there's no overlapping time", () => {
    render(
      <DaySummary entries={[entry(), entry({ id: 2, start_time: "10:00", end_time: "11:00" })]} />,
    );
    expect(screen.queryByText(/overlapping time/)).not.toBeInTheDocument();
  });
});
