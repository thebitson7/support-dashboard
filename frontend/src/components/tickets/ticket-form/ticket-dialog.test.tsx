// The per-tab "needs attention" dots on the ticket form: each tab must light
// up exactly when something on it needs fixing, whether that's a live client
// rule or an error the API sent back, so nobody has to hunt across tabs.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiTicketDetail, ApiWorkDoneCode } from "@/lib/tickets-api";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { TicketDialog } from "@/components/tickets/ticket-form/ticket-dialog";
import { closedTicket } from "@/test/fixtures";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
// Signed in as staff (the ticket tab reads the role); the rest of the module is real.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({ user: { id: 3, username: "alice", role: "staff" } }),
}));

const CODES: ApiWorkDoneCode[] = [
  { id: 2, code: "RB", description: "Rebooted analyzer", is_active: true },
];

/** GET responses by path: the ticket being edited, and the work-done codes. */
function serve(ticket?: ApiTicketDetail) {
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === "/tickets/work-done-codes/") return CODES;
    if (ticket && path === `/tickets/${ticket.id}/`) return ticket;
    throw new ApiError(404, "Not found.");
  });
}

function renderDialog(ticketId?: number) {
  render(<TicketDialog open onOpenChange={vi.fn()} ticketId={ticketId} onSaved={vi.fn()} />);
  return userEvent.setup();
}

/** Tab name -> whether it's flagged (its accessible name ends ", needs attention"). */
function flaggedTabs() {
  return Object.fromEntries(
    screen.getAllByRole("tab").map((tab) => {
      const name = tab.textContent ?? "";
      const label = name
        .replace(/\d+ added/, "")
        .replace(", needs attention", "")
        .trim();
      return [label, name.includes(", needs attention")];
    }),
  );
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPatch).mockReset();
});

describe("ticket form tab indicators", () => {
  it("flags only the Ticket tab on a blank new ticket, before anything is touched", async () => {
    serve();
    renderDialog();
    await screen.findAllByRole("tab");
    expect(flaggedTabs()).toEqual({
      Ticket: true,
      Activities: false,
      "Ticket Verification": false,
    });
  });

  it("flags nothing on a complete, valid closed ticket", async () => {
    serve(closedTicket());
    renderDialog(17);
    await screen.findByRole("button", { name: "Save Changes" });
    expect(flaggedTabs()).toEqual({
      Ticket: false,
      Activities: false,
      "Ticket Verification": false,
    });
    // The activity count badge is not mistaken for a problem.
    expect(screen.getByRole("tab", { name: /Activities/ })).toHaveTextContent("1 added");
  });

  it("flags Verification live when it's only partly filled (all-or-nothing rule)", async () => {
    serve(
      closedTicket({
        status: "open",
        resolution_verified_by: null,
        resolution_verified_on: null,
        cms_closed_by: null,
        service_closed_date: null,
        // cms_closed_on left set: one field without the others.
      }),
    );
    renderDialog(17);
    await screen.findByRole("button", { name: "Save Changes" });
    expect(flaggedTabs()).toEqual({
      Ticket: false,
      Activities: false,
      "Ticket Verification": true,
    });
  });

  it("flags the tabs the API's 400 points at, and opens the first one", async () => {
    serve(closedTicket());
    vi.mocked(apiPatch).mockRejectedValue(
      new ApiError(400, "The request couldn't be completed.", {
        data: {
          cms_closed_on: ["Closed on can't be before the ticket was received."],
          activities: { "0": { end_at: ["Overlaps another activity."] } },
        },
      }),
    );
    const user = renderDialog(17);
    await user.click(await screen.findByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(flaggedTabs()).toEqual({
        Ticket: false,
        Activities: true,
        "Ticket Verification": true,
      }),
    );
    expect(screen.getByRole("tab", { name: /Ticket Verification/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Closed on can't be before the ticket was received.")).toBeVisible();
  });

  it("flags a server error on the Ticket tab and leaves the others alone", async () => {
    serve(closedTicket());
    vi.mocked(apiPatch).mockRejectedValue(
      new ApiError(400, "The request couldn't be completed.", {
        data: { cms_next_ticket_no: ["A ticket with this CMS number already exists."] },
      }),
    );
    const user = renderDialog(17);
    await user.click(await screen.findByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(flaggedTabs()).toEqual({
        Ticket: true,
        Activities: false,
        "Ticket Verification": false,
      }),
    );
  });

  it("sends nothing while a client rule is broken, and goes to the offending tab", async () => {
    serve(
      closedTicket({
        resolution_verified_by: null, // closing needs every verification field
      }),
    );
    const user = renderDialog(17);
    await user.click(await screen.findByRole("button", { name: "Save Changes" }));

    expect(apiPatch).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Ticket Verification/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(flaggedTabs()["Ticket Verification"]).toBe(true);
  });
});
