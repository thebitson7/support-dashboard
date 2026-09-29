import { describe, expect, it } from "vitest";

import type { ApiPeriod } from "@/types/working-hours";
import {
  entryMinutes,
  formatTimeRange,
  spanMinutes,
  toPeriodSummary,
  userQuery,
} from "@/lib/working-hours";

describe("spanMinutes", () => {
  it("counts the minutes from start to end", () => {
    expect(spanMinutes("09:00", "10:45")).toBe(105);
    expect(spanMinutes("00:00", "23:59")).toBe(1439);
    expect(spanMinutes("12:59", "13:00")).toBe(1);
  });

  it("is null when the end isn't after the start (the API's rule)", () => {
    expect(spanMinutes("10:00", "10:00")).toBeNull();
    expect(spanMinutes("10:00", "09:59")).toBeNull();
    // A shift crossing midnight is two entries, never one.
    expect(spanMinutes("22:00", "02:00")).toBeNull();
  });

  it("is null when either time is missing or malformed", () => {
    expect(spanMinutes("", "10:00")).toBeNull();
    expect(spanMinutes("09:00", "")).toBeNull();
    expect(spanMinutes("9:00", "10:00")).toBeNull();
    expect(spanMinutes("09:00", "24:00")).toBeNull();
  });
});

describe("entry helpers", () => {
  it("entryMinutes uses the exact times, and 0 for an impossible entry", () => {
    expect(entryMinutes({ start_time: "08:30", end_time: "17:15" })).toBe(525);
    expect(entryMinutes({ start_time: "17:15", end_time: "08:30" })).toBe(0);
  });

  it("formatTimeRange uses the 12-hour display format", () => {
    expect(formatTimeRange({ start_time: "09:00", end_time: "13:45" })).toBe("9:00 AM – 1:45 PM");
  });

  it("userQuery is empty for 'myself' and encodes an id otherwise", () => {
    expect(userQuery(null)).toBe("");
    expect(userQuery("")).toBe("");
    expect(userQuery("42")).toBe("?user_id=42");
    expect(userQuery("a&b=c")).toBe("?user_id=a%26b%3Dc");
  });
});

describe("toPeriodSummary", () => {
  const period: ApiPeriod = {
    key: "currentWeek",
    label: "This Week",
    start_date: "2026-09-21",
    end_date: "2026-09-27",
    total_minutes: 1234,
    ams_minutes: 1000,
    non_ams_minutes: 234,
    goal_minutes: 2400,
    // Deliberately inconsistent with the minutes: the summary must not use them.
    total_hours: 99,
    goal_hours: 99,
    ams_hours: 99,
    non_ams_hours: 99,
    percent_complete: 51.4,
  };

  it("uses the API's exact minutes, never hours × 60", () => {
    expect(toPeriodSummary(period)).toEqual({
      key: "currentWeek",
      label: "This Week",
      dateRange: "21 Sep – 27 Sep",
      workedMinutes: 1234,
      goalMinutes: 2400,
      amsMinutes: 1000,
      nonAmsMinutes: 234,
      percentComplete: 51.4,
    });
  });

  it("names the weekday for a single-day period, on the right local day", () => {
    const today = {
      ...period,
      key: "today" as const,
      start_date: "2026-09-24",
      end_date: "2026-09-24",
    };
    expect(toPeriodSummary(today).dateRange).toBe("Thu 24 Sep 2026");
  });

  it("formats a range crossing a year boundary", () => {
    const range = { ...period, start_date: "2026-12-28", end_date: "2027-01-03" };
    expect(toPeriodSummary(range).dateRange).toBe("28 Dec – 3 Jan");
  });
});
