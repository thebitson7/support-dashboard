import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AuditAction } from "@/types/audit";
import { AuditFilters, type AuditFilterState } from "@/components/audit/audit-filters";

const DEFAULTS = { start: "2026-08-30", end: "2026-09-28" };

const ACTIONS: AuditAction[] = [
  { value: "login", label: "Signed in", group: "Sign-in" },
  { value: "logout", label: "Signed out", group: "Sign-in" },
  { value: "ticket_created", label: "Ticket created", group: "Tickets" },
  { value: "ticket_closed", label: "Ticket closed", group: "Tickets" },
];

const EMPTY: AuditFilterState = {
  query: "",
  range: DEFAULTS,
  actor: null,
  actions: [],
  target: null,
};

function setup(state: Partial<AuditFilterState> = {}, count?: number) {
  const onChange = vi.fn();
  const onClearAll = vi.fn();
  render(
    <AuditFilters
      state={{ ...EMPTY, ...state }}
      defaults={DEFAULTS}
      actions={ACTIONS}
      panelOpen={false}
      onPanelOpenChange={vi.fn()}
      onChange={onChange}
      onClearAll={onClearAll}
      problem={null}
      count={count}
    />,
  );
  return { user: userEvent.setup(), onChange, onClearAll };
}

/** Each chip is announced by its remove button: "Remove filter <label>: <value>". */
const chipNames = () =>
  screen
    .queryAllByRole("button", { name: /^Remove filter / })
    .map((b) => b.getAttribute("aria-label")!.replace("Remove filter ", ""));

/** The number badge on the "Filters" disclosure (user + action only), or null. */
const panelBadge = () =>
  screen.getByRole("button", { name: /Filters/ }).textContent?.replace("Filters", "") || null;

describe("AuditFilters active-filter chips", () => {
  it("shows the default scope, and no chips or Clear all, when nothing is filtered", () => {
    setup();
    expect(chipNames()).toEqual([]);
    expect(screen.getByText("Everyone, every action, the last 30 days.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
    expect(panelBadge()).toBeNull();
  });

  it("ignores a whitespace-only search", () => {
    setup({ query: "   " });
    expect(chipNames()).toEqual([]);
  });

  it("shows a trimmed search chip that clears only the search", async () => {
    const { user, onChange } = setup({ query: "  CMS-1001 " });
    expect(chipNames()).toEqual(["Search: “CMS-1001”"]);
    await user.click(screen.getByRole("button", { name: "Remove filter Search: “CMS-1001”" }));
    expect(onChange).toHaveBeenCalledWith({ query: "" });
  });

  it("shows a date chip only when the range differs from the default", async () => {
    const { user, onChange } = setup({ range: { start: "2026-09-01", end: "2026-09-15" } });
    expect(chipNames()).toEqual(["Dates: 1 Sep 2026 – 15 Sep 2026"]);
    await user.click(screen.getByRole("button", { name: /^Remove filter Dates/ }));
    expect(onChange).toHaveBeenCalledWith({ range: DEFAULTS });
  });

  it("counts a range that moves only one end as custom", () => {
    setup({ range: { ...DEFAULTS, end: "2026-09-20" } });
    expect(chipNames()).toEqual(["Dates: 30 Aug 2026 – 20 Sep 2026"]);
  });

  it("shows no date chip while one end of the range is still empty", () => {
    setup({ range: { start: "2026-09-01", end: "" } });
    expect(chipNames()).toEqual([]);
  });

  it("summarises actions: up to two by name, then a count", () => {
    setup({ actions: ["login", "logout"] });
    expect(chipNames()).toEqual(["Action: Signed in, Signed out"]);
  });

  it("switches to a count for three or more actions", () => {
    setup({ actions: ["login", "logout", "ticket_closed"] });
    expect(chipNames()).toEqual(["Action: 3 actions"]);
  });

  it("falls back to the raw value for an action the list doesn't know (e.g. from an old URL)", () => {
    setup({ actions: ["retired_action"] });
    expect(chipNames()).toEqual(["Action: retired_action"]);
  });

  it("removes the user, action and target filters individually", async () => {
    const { user, onChange } = setup({
      actor: { value: "3", label: "Alice Tan" },
      actions: ["ticket_closed"],
      target: { type: "ticket", id: "17", label: "Ticket CMS-1001" },
    });
    expect(chipNames()).toEqual([
      "User: Alice Tan",
      "Action: Ticket closed",
      "Target: Ticket CMS-1001",
    ]);

    await user.click(screen.getByRole("button", { name: "Remove filter User: Alice Tan" }));
    expect(onChange).toHaveBeenLastCalledWith({ actor: null });
    await user.click(screen.getByRole("button", { name: "Remove filter Action: Ticket closed" }));
    expect(onChange).toHaveBeenLastCalledWith({ actions: [] });
    await user.click(screen.getByRole("button", { name: "Remove filter Target: Ticket CMS-1001" }));
    expect(onChange).toHaveBeenLastCalledWith({ target: null });
  });

  it("orders every chip consistently and clears them all at once", async () => {
    const { user, onClearAll } = setup({
      query: "reboot",
      range: { start: "2026-09-01", end: "2026-09-15" },
      actor: { value: "3", label: "Alice Tan" },
      actions: ["login"],
      target: { type: "ticket", id: "17", label: "Ticket CMS-1001" },
    });
    expect(chipNames()).toEqual([
      "Search: “reboot”",
      "Dates: 1 Sep 2026 – 15 Sep 2026",
      "User: Alice Tan",
      "Action: Signed in",
      "Target: Ticket CMS-1001",
    ]);
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("badges the Filters button with only the filters hidden inside it", () => {
    setup({
      query: "x",
      range: { start: "2026-09-01", end: "2026-09-15" },
      target: { type: "ticket", id: "1", label: "T" },
    });
    expect(panelBadge()).toBeNull();
  });

  it("counts user and action filters on the Filters badge", () => {
    setup({ actor: { value: "3", label: "Alice Tan" }, actions: ["login", "logout"] });
    expect(panelBadge()).toBe("2");
  });
});

describe("AuditFilters result count", () => {
  it.each([
    [undefined, ""],
    [0, "0 entries"],
    [1, "1 entry"],
    [1234, "1,234 entries"],
  ])("count %j reads %j", (count, text) => {
    setup({}, count);
    const live = document.querySelector('[aria-live="polite"].tabular-nums');
    expect(live?.textContent).toBe(text);
  });
});
