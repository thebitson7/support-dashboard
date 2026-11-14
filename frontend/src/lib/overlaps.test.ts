// @vitest-environment node
// The overlap 409: recognising it safely, wording it, and the same-form and
// after-saving arithmetic (mirrors backend working_hours/overlaps.py).

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Overlap } from "@/lib/overlaps";

type ApiModule = typeof import("@/lib/api");
type OverlapsModule = typeof import("@/lib/overlaps");

let api: ApiModule;
let overlaps: OverlapsModule;
let fetchMock: Mock<typeof fetch>;

beforeEach(async () => {
  // Fresh copies, as in api.test.ts, so ApiError is the same class in both.
  vi.resetModules();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  api = await import("@/lib/api");
  overlaps = await import("@/lib/overlaps");
});

const ITEM: Overlap = {
  kind: "ticket_activity",
  person: { id: 7, name: "Syed Hussain" },
  date: "2026-11-12",
  start: "09:30",
  end: "10:45",
  conflicting_start: "10:00",
  conflicting_end: "11:00",
  overlap_start: "10:00",
  overlap_end: "10:45",
  overlap_minutes: 45,
  label: "Ticket #CMS1002 (Troubleshooting)",
  activity: 1,
  conflicting_activity: null,
  conflicting_ticket: 4,
};

const body409 = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  code: "overlap_confirmation_required",
  detail: "This time overlaps other work logged by the same person.",
  overlaps: items,
  ...extra,
});

async function failWith(response: Response) {
  fetchMock.mockResolvedValue(response);
  return api.apiPost("/working-hours/entries/", {}).then(
    () => {
      throw new Error("expected a failure");
    },
    (e: unknown) => e,
  );
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("overlapsFromError", () => {
  it("returns the typed overlaps of a well-formed 409", async () => {
    const error = await failWith(json(body409([ITEM]), 409));
    expect(error).toBeInstanceOf(api.ApiError);
    expect(overlaps.overlapsFromError(error)).toEqual([ITEM]);
    // The message is the API's own short sentence, never the raw body.
    expect((error as Error).message).toBe(
      "This time overlaps other work logged by the same person.",
    );
  });

  it.each([
    ["another code", body409([ITEM], { code: "auto_entry" })],
    ["no overlaps", body409([])],
    ["minutes as text", body409([{ ...ITEM, overlap_minutes: "45" }])],
    ["a bad time", body409([{ ...ITEM, overlap_start: "10am" }])],
    ["markup in a label", body409([{ ...ITEM, label: "<img src=x onerror=alert(1)>" }])],
    ["an unknown kind", body409([{ ...ITEM, kind: "other" }])],
    ["one bad item among good ones", body409([ITEM, { ...ITEM, person: null }])],
    ["not an object", ["overlap"]],
  ])("refuses a malformed 409 (%s)", async (_, body) => {
    const error = await failWith(json(body, 409));
    expect(overlaps.overlapsFromError(error)).toBeNull();
  });

  it("ignores other statuses and non-API errors", async () => {
    expect(overlaps.overlapsFromError(await failWith(json(body409([ITEM]), 400)))).toBeNull();
    expect(overlaps.overlapsFromError(new Error("boom"))).toBeNull();
    expect(overlaps.overlapsFromError(undefined)).toBeNull();
  });

  it("an HTML 409 or 500 is never read: generic message, no overlaps", async () => {
    for (const status of [409, 500]) {
      const error = await failWith(
        new Response("<html><body>Traceback: secret</body></html>", {
          status,
          headers: { "content-type": "text/html" },
        }),
      );
      expect(overlaps.overlapsFromError(error)).toBeNull();
      expect((error as Error).message).not.toMatch(/Traceback|html/);
      expect((error as Error).message.length).toBeLessThan(80);
    }
  });
});

describe("wording", () => {
  it("names the other ticket and where the two meet", () => {
    expect(overlaps.describeOverlap(ITEM)).toBe(
      "Overlaps 45 min with Ticket #CMS1002 (Troubleshooting), 10:00-10:45",
    );
  });

  it("names the other activity in the same ticket", () => {
    expect(
      overlaps.describeOverlap({
        ...ITEM,
        kind: "same_request",
        overlap_minutes: 30,
        label: "Activity 2",
        conflicting_activity: 2,
      }),
    ).toBe("Overlaps 30 min with another activity in this ticket (activity 2)");
  });

  it("names a manual entry", () => {
    expect(
      overlaps.describeOverlap({
        ...ITEM,
        kind: "manual_entry",
        label: "Manual entry",
        overlap_minutes: 30,
        overlap_start: "09:30",
        overlap_end: "10:00",
      }),
    ).toBe("Overlaps 30 min with Manual entry, 09:30-10:00");
  });

  it("formats minutes and hours", () => {
    expect(overlaps.formatOverlapDuration(30)).toBe("30 min");
    expect(overlaps.formatOverlapDuration(60)).toBe("1 h");
    expect(overlaps.formatOverlapDuration(75)).toBe("1 h 15 min");
  });
});

describe("same-form overlaps", () => {
  const at = (hhmm: string) => Date.parse(`2026-11-12T${hhmm}:00`);
  const item = (key: string, start: string, end: string, personId: string | null = "7") => ({
    key,
    startMs: at(start),
    endMs: at(end),
    personId,
  });

  it("pairs rows with the same resolver whose times overlap", () => {
    expect(
      overlaps.sameFormOverlaps([
        item("a", "09:00", "10:00"),
        item("b", "09:30", "10:30"),
        item("c", "10:00", "11:00"), // touches a, overlaps b
      ]),
    ).toEqual({ a: [2], b: [1, 3], c: [2] });
  });

  it("ignores different resolvers, no resolver, and invalid or empty times", () => {
    expect(
      overlaps.sameFormOverlaps([
        item("a", "09:00", "10:00", "7"),
        item("b", "09:00", "10:00", "8"),
        item("c", "09:00", "10:00", null),
        { key: "d", startMs: NaN, endMs: NaN, personId: "7" },
        item("e", "09:30", "09:30", "7"),
      ]),
    ).toEqual({});
  });

  it("words the warning", () => {
    expect(overlaps.sameFormWarning([2])).toBe("Overlaps with activity 2");
    expect(overlaps.sameFormWarning([1, 3])).toBe("Overlaps with activities 1 and 3");
    expect(overlaps.sameFormWarning([1, 2, 4])).toBe("Overlaps with activities 1, 2 and 4");
  });
});

describe("doubleCountedMinutes", () => {
  const e = (start_time: string, end_time: string) => ({ start_time, end_time });

  it("is the summed length minus the covered time", () => {
    expect(overlaps.doubleCountedMinutes([e("09:00", "10:00"), e("09:30", "10:30")])).toBe(30);
    expect(
      overlaps.doubleCountedMinutes([
        e("09:00", "10:00"),
        e("09:30", "10:30"),
        e("09:45", "10:00"),
        e("11:00", "12:00"),
      ]),
    ).toBe(45);
  });

  it("is 0 for touching or separate entries", () => {
    expect(overlaps.doubleCountedMinutes([e("09:00", "10:00"), e("10:00", "11:00")])).toBe(0);
    expect(overlaps.doubleCountedMinutes([])).toBe(0);
  });
});
