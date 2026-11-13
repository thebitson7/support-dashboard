import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACK_STORAGE_KEY,
  LEVELS,
  LEVEL_LABEL,
  acknowledge,
  clearAcknowledgement,
  closeTicketHref,
  compareLevels,
  formatAge,
  isAcknowledged,
  parseTicketDeepLink,
  shouldShowDialog,
  urgentCount,
} from "@/lib/attention";
import type { AttentionLevel } from "@/types/attention";

const counts = (critical: number, overdue: number, due_soon: number) => ({
  critical,
  overdue,
  due_soon,
});

describe("formatAge", () => {
  it.each([
    [0, "0 h"],
    [0.9, "0 h"],
    [23, "23 h"],
    [23.99, "23 h"],
    [47.9, "47 h"],
    [48, "2 d"],
    [51, "2 d 3 h"],
    [51.4, "2 d 3 h"],
    [77, "3 d 5 h"],
    [-4, "0 h"],
    [Number.NaN, "0 h"],
  ])("%s hours -> %s", (hours, text) => {
    expect(formatAge(hours)).toBe(text);
  });
});

describe("levels", () => {
  it("orders most severe first", () => {
    expect(LEVELS).toEqual(["critical", "overdue", "due_soon"]);
    const shuffled: AttentionLevel[] = ["due_soon", "critical", "overdue", "due_soon"];
    expect([...shuffled].sort(compareLevels)).toEqual([
      "critical",
      "overdue",
      "due_soon",
      "due_soon",
    ]);
  });

  it("has a word for every level", () => {
    expect(LEVEL_LABEL).toEqual({ critical: "Critical", overdue: "Overdue", due_soon: "Due soon" });
  });

  it("counts overdue + critical only", () => {
    expect(urgentCount(counts(1, 2, 7))).toBe(3);
    expect(urgentCount(counts(0, 0, 7))).toBe(0);
    expect(urgentCount(undefined)).toBe(0);
  });
});

describe("shouldShowDialog", () => {
  it("shows for overdue or critical, not for due soon only", () => {
    expect(shouldShowDialog({ counts: counts(0, 1, 0) }, false)).toBe(true);
    expect(shouldShowDialog({ counts: counts(1, 0, 0) }, false)).toBe(true);
    expect(shouldShowDialog({ counts: counts(0, 0, 4) }, false)).toBe(false);
  });

  it("never before data has loaded, nor once acknowledged", () => {
    expect(shouldShowDialog(undefined, false)).toBe(false);
    expect(shouldShowDialog({ counts: counts(3, 3, 0) }, true)).toBe(false);
  });
});

describe("acknowledgement", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearAcknowledgement();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearAcknowledgement();
  });

  it("is remembered for the tab session (sessionStorage), so a refresh doesn't re-show", () => {
    expect(isAcknowledged()).toBe(false);
    acknowledge();
    expect(sessionStorage.getItem(ACK_STORAGE_KEY)).toBe("1");
    expect(isAcknowledged()).toBe(true);
  });

  it("survives a reload: a stored flag alone counts", () => {
    sessionStorage.setItem(ACK_STORAGE_KEY, "1");
    expect(isAcknowledged()).toBe(true);
  });

  it("is cleared by a new sign-in (or sign-out), so the alert shows again", () => {
    acknowledge();
    clearAcknowledgement();
    expect(isAcknowledged()).toBe(false);
    expect(sessionStorage.getItem(ACK_STORAGE_KEY)).toBeNull();
  });

  it("tolerates broken storage: no throw, and the in-memory flag still holds", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(isAcknowledged()).toBe(false);
    expect(() => acknowledge()).not.toThrow();
    expect(isAcknowledged()).toBe(true);
    expect(() => clearAcknowledgement()).not.toThrow();
    expect(isAcknowledged()).toBe(false);
  });
});

describe("parseTicketDeepLink", () => {
  const parse = (query: string) => parseTicketDeepLink(new URLSearchParams(query));

  it("reads a plain positive integer and a known tab", () => {
    expect(parse("edit=17&tab=verification")).toEqual({ ticketId: 17, tab: "verification" });
    expect(parse("edit=17&tab=activities")).toEqual({ ticketId: 17, tab: "activities" });
    expect(parse("edit=17")).toEqual({ ticketId: 17 });
  });

  it.each([
    "",
    "edit=",
    "edit=0",
    "edit=-3",
    "edit=1.5",
    "edit=1e3",
    "edit=abc",
    "edit=%2017",
    "edit=017",
    "edit=+5",
    "edit=99999999999999999",
    "tab=verification",
  ])("rejects %j", (query) => {
    expect(parse(query)).toBeNull();
  });

  it("ignores unknown tabs (opens on the default tab)", () => {
    expect(parse("edit=5&tab=admin")).toEqual({ ticketId: 5 });
    expect(parse("edit=5&tab=Verification")).toEqual({ ticketId: 5 });
  });

  it("builds the Close ticket link", () => {
    expect(closeTicketHref(42)).toBe("/ams-tickets?edit=42&tab=verification");
    expect(parse(closeTicketHref(42).split("?")[1] ?? "")).toEqual({
      ticketId: 42,
      tab: "verification",
    });
  });
});
