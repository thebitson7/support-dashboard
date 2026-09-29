// Runs in America/New_York (see vitest.config.mts): a negative UTC offset with
// daylight saving, where UTC-vs-local mix-ups show up as off-by-one days.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addDaysToDate,
  daysInMonth,
  formatDateDisplay,
  formatDateLong,
  formatLocal,
  formatLocalDisplay,
  formatTimeDisplay,
  from12h,
  isoToLocal,
  localToIso,
  localToMs,
  nowLocal,
  parseLocal,
  parseLocalDate,
  parseLocalTime,
  timeToMinutes,
  to12h,
  todayInZone,
  todayLocalDate,
} from "@/lib/local-datetime";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseLocal", () => {
  it("parses a well-formed local date-time", () => {
    expect(parseLocal("2026-09-24T14:05")).toEqual({
      year: 2026,
      month: 9,
      day: 24,
      hour: 14,
      minute: 5,
    });
  });

  it.each([
    ["", "empty"],
    ["2026-09-24", "date only"],
    ["2026-09-24T14:05:00", "with seconds"],
    ["2026-09-24 14:05", "space separator"],
    ["2026-9-24T14:05", "unpadded month"],
    ["2026-13-01T00:00", "month 13"],
    ["2026-00-10T00:00", "month 0"],
    ["2026-04-31T00:00", "31 April"],
    ["2026-02-29T00:00", "29 Feb in a common year"],
    ["2026-01-00T00:00", "day 0"],
    ["2026-01-01T24:00", "hour 24"],
    ["2026-01-01T12:60", "minute 60"],
  ])("rejects %j (%s)", (value) => {
    expect(parseLocal(value)).toBeNull();
  });

  it("accepts 29 Feb in a leap year, including the 400-year rule", () => {
    expect(parseLocal("2028-02-29T00:00")).not.toBeNull();
    expect(parseLocal("2000-02-29T00:00")).not.toBeNull();
    expect(parseLocal("2100-02-29T00:00")).toBeNull();
  });

  it("round-trips through formatLocal", () => {
    for (const value of ["2026-01-01T00:00", "2026-12-31T23:59", "2028-02-29T09:07"]) {
      expect(formatLocal(parseLocal(value)!)).toBe(value);
    }
  });
});

describe("daysInMonth", () => {
  it("knows every month's length, leap years included", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});

describe("API timestamps <-> local date-times", () => {
  it("shows an API instant in local time (EDT, UTC-4)", () => {
    expect(isoToLocal("2026-09-24T13:00:00Z")).toBe("2026-09-24T09:00");
    expect(isoToLocal("2026-09-24T21:00:00+08:00")).toBe("2026-09-24T09:00");
  });

  it("moves to the previous local day when UTC is already past midnight", () => {
    expect(isoToLocal("2026-09-25T02:30:00Z")).toBe("2026-09-24T22:30");
  });

  it("returns an empty string for missing or unparseable values", () => {
    expect(isoToLocal(null)).toBe("");
    expect(isoToLocal(undefined)).toBe("");
    expect(isoToLocal("")).toBe("");
    expect(isoToLocal("not a date")).toBe("");
  });

  it("sends local time to the API as UTC, following daylight saving", () => {
    expect(localToIso("2026-09-24T09:00")).toBe("2026-09-24T13:00:00.000Z"); // EDT
    expect(localToIso("2026-01-15T09:00")).toBe("2026-01-15T14:00:00.000Z"); // EST
    expect(localToIso("2026-09-24T22:30")).toBe("2026-09-25T02:30:00.000Z");
  });

  it("round-trips local -> ISO -> local", () => {
    for (const value of ["2026-03-07T23:59", "2026-11-01T00:30", "2026-12-31T23:59"]) {
      expect(isoToLocal(localToIso(value))).toBe(value);
    }
  });

  it("refuses to send an invalid local value rather than inventing a date", () => {
    expect(() => localToIso("2026-02-30T10:00")).toThrow(/Not a local date-time/);
    expect(() => localToIso("")).toThrow();
  });

  it("localToMs gives NaN (never a wrong number) for invalid input", () => {
    expect(localToMs("garbage")).toBeNaN();
    expect(localToMs("2026-09-24T10:00") - localToMs("2026-09-24T09:15")).toBe(45 * 60_000);
  });
});

describe("date-only values", () => {
  it("parses a calendar date at midnight and rejects impossible ones", () => {
    expect(parseLocalDate("2026-12-25")).toMatchObject({ year: 2026, month: 12, day: 25, hour: 0 });
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-12-25T00:00")).toBeNull();
  });

  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDate("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToDate("2026-09-24", 0)).toBe("2026-09-24");
  });

  it("adds whole calendar days across a daylight-saving change", () => {
    // US clocks go forward on 8 Mar 2026 and back on 1 Nov 2026.
    expect(addDaysToDate("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysToDate("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDaysToDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToDate("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("leaves an invalid date untouched", () => {
    expect(addDaysToDate("not-a-date", 3)).toBe("not-a-date");
  });

  it("formats in day-month order, independent of the browser locale", () => {
    expect(formatDateDisplay("2026-12-25")).toBe("25 Dec 2026");
    expect(formatDateDisplay("2026-01-05", { withYear: false })).toBe("5 Jan");
    expect(formatDateDisplay("2026-13-01")).toBe("");
    // Intl's en-GB pattern: the comma after the weekday varies by ICU version.
    expect(formatDateLong("2026-03-04")).toMatch(/^Wednesday,? 4 March 2026$/);
    expect(formatDateLong("")).toBe("");
  });
});

describe("time-only values", () => {
  it("parses HH:mm and rejects anything else", () => {
    expect(parseLocalTime("09:45")).toMatchObject({ hour: 9, minute: 45 });
    for (const bad of ["9:45", "24:00", "12:60", "09:45:00", "", "0945"]) {
      expect(parseLocalTime(bad)).toBeNull();
    }
  });

  it("converts to minutes since midnight", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:45")).toBe(585);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("24:00")).toBeNull();
  });

  it("displays 12-hour clock times with the midnight / noon edge cases right", () => {
    expect(formatTimeDisplay("00:05")).toBe("12:05 AM");
    expect(formatTimeDisplay("11:59")).toBe("11:59 AM");
    expect(formatTimeDisplay("12:00")).toBe("12:00 PM");
    expect(formatTimeDisplay("14:05")).toBe("2:05 PM");
    expect(formatTimeDisplay("23:59")).toBe("11:59 PM");
    expect(formatTimeDisplay("nope")).toBe("");
  });

  it("to12h and from12h are inverses for every hour of the day", () => {
    for (let hour = 0; hour < 24; hour++) {
      const { hour12, pm } = to12h(hour);
      expect(hour12).toBeGreaterThanOrEqual(1);
      expect(hour12).toBeLessThanOrEqual(12);
      expect(from12h(hour12, pm)).toBe(hour);
    }
  });

  it("formats a full local date-time for display", () => {
    expect(formatLocalDisplay("2026-09-24T14:30")).toBe("24 Sep 2026, 2:30 PM");
    expect(formatLocalDisplay("2026-09-24T00:00")).toBe("24 Sep 2026, 12:00 AM");
    expect(formatLocalDisplay("bad")).toBe("");
  });
});

describe("today / now", () => {
  it("uses the browser's local clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T02:15:00Z")); // 28 Sep, 22:15 in New York
    expect(nowLocal()).toBe("2026-09-28T22:15");
    expect(todayLocalDate()).toBe("2026-09-28");
  });

  it("todayInZone answers for the given zone, not the browser's", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T02:15:00Z"));
    expect(todayInZone("Asia/Singapore")).toBe("2026-09-29");
    expect(todayInZone("America/New_York")).toBe("2026-09-28");
    expect(todayInZone("UTC")).toBe("2026-09-29");
  });

  it("todayInZone falls back to the browser's day for an unknown zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T02:15:00Z"));
    expect(todayInZone("Not/AZone")).toBe("2026-09-28");
  });
});
