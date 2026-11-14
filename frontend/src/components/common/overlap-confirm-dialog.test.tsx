// The overlap confirmation: plain-language lines, a required checkbox before
// "Save anyway", Escape / "Go back and edit" to return, and focus order.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Overlap } from "@/lib/overlaps";
import {
  OVERLAP_EXPLANATION,
  OverlapConfirmDialog,
} from "@/components/common/overlap-confirm-dialog";

const TICKET: Overlap = {
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
const SIBLING: Overlap = {
  ...TICKET,
  kind: "same_request",
  overlap_minutes: 30,
  label: "Activity 2",
  conflicting_activity: 2,
  conflicting_ticket: null,
};

function setup(props: Partial<Parameters<typeof OverlapConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onBack = vi.fn();
  render(
    <OverlapConfirmDialog
      open
      overlaps={[TICKET, SIBLING]}
      onConfirm={onConfirm}
      onBack={onBack}
      {...props}
    />,
  );
  return { user: userEvent.setup(), onConfirm, onBack };
}

describe("OverlapConfirmDialog", () => {
  it("explains and lists each overlap in plain language", async () => {
    setup();
    const dialog = await screen.findByRole("alertdialog", { name: "Overlapping time" });
    expect(dialog).toHaveTextContent(OVERLAP_EXPLANATION);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain(
      "Overlaps 45 min with Ticket #CMS1002 (Troubleshooting), 10:00-10:45",
    );
    expect(items[1]).toContain("Overlaps 30 min with another activity in this ticket (activity 2)");
    expect(items[0]).toContain("Activity 1");
  });

  it("enables Save anyway only once the box is ticked", async () => {
    const { user, onConfirm } = setup();
    const save = await screen.findByRole("button", { name: "Save anyway" });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: "I confirm this overlap is correct" }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("starts focus on the checkbox, then moves to Go back and Save anyway", async () => {
    const { user } = setup();
    const box = await screen.findByRole("checkbox", { name: "I confirm this overlap is correct" });
    await vi.waitFor(() => expect(box).toHaveFocus());
    await user.keyboard(" "); // tick it from the keyboard
    expect(box).toHaveAttribute("aria-checked", "true");
    await user.tab();
    expect(screen.getByRole("button", { name: "Go back and edit" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save anyway" })).toHaveFocus();
  });

  it("Escape and Go back both return to the form", async () => {
    const { user, onBack } = setup();
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    expect(onBack).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Go back and edit" }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("names the person only when more than one is involved", async () => {
    setup({ overlaps: [TICKET, { ...SIBLING, person: { id: 8, name: "Bob Lim" } }] });
    expect(await screen.findByText(/Syed Hussain/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Lim/)).toBeInTheDocument();
  });

  it("can't be confirmed or dismissed while saving", async () => {
    const { user, onBack } = setup({ submitting: true });
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onBack).not.toHaveBeenCalled();
  });
});
