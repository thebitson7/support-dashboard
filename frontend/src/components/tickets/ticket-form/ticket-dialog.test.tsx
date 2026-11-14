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
    await screen.findByRole("button", { name: "Save changes" });
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
    await screen.findByRole("button", { name: "Save changes" });
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
    await user.click(await screen.findByRole("button", { name: "Save changes" }));

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
    await user.click(await screen.findByRole("button", { name: "Save changes" }));

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
    await user.click(await screen.findByRole("button", { name: "Save changes" }));

    expect(apiPatch).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Ticket Verification/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(flaggedTabs()["Ticket Verification"]).toBe(true);
  });
});

describe("initial tab (the attention alert's deep link)", () => {
  it("opens an edit on the Verification tab when asked", async () => {
    serve(closedTicket());
    render(
      <TicketDialog
        open
        onOpenChange={vi.fn()}
        ticketId={17}
        initialTab="verification"
        onSaved={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Save changes" });
    expect(screen.getByRole("tab", { name: /Ticket Verification/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("still opens on the Ticket tab by default", async () => {
    serve(closedTicket());
    renderDialog(17);
    await screen.findByRole("button", { name: "Save changes" });
    expect(screen.getByRole("tab", { name: /^Ticket$/ })).toHaveAttribute("aria-selected", "true");
  });

  it("reports a ticket that can't be loaded to onLoadError", async () => {
    serve();
    const onLoadError = vi.fn();
    render(
      <TicketDialog
        open
        onOpenChange={vi.fn()}
        ticketId={999}
        onSaved={vi.fn()}
        onLoadError={onLoadError}
      />,
    );
    await waitFor(() =>
      expect(onLoadError).toHaveBeenCalledWith(expect.objectContaining({ status: 404 })),
    );
  });
});

describe("overlapping time (409 confirmation)", () => {
  const OVERLAP_409 = new ApiError(
    409,
    "This time overlaps other work logged by the same person.",
    {
      data: {
        code: "overlap_confirmation_required",
        detail: "This time overlaps other work logged by the same person.",
        overlaps: [
          {
            kind: "manual_entry",
            person: { id: 3, name: "Alice Tan" },
            date: "2026-09-24",
            start: "22:00",
            end: "23:30",
            conflicting_start: "22:30",
            conflicting_end: "23:00",
            overlap_start: "22:30",
            overlap_end: "23:00",
            overlap_minutes: 30,
            label: "Manual entry",
            activity: 1,
            conflicting_activity: null,
            conflicting_ticket: null,
          },
        ],
      },
    },
  );

  const formEntries = (body: unknown) =>
    [...(body as FormData).entries()].map(([k, v]) => [k, String(v)] as const);

  it("asks to confirm, then resends the same payload with confirm_overlaps", async () => {
    serve(closedTicket());
    vi.mocked(apiPatch).mockRejectedValueOnce(OVERLAP_409).mockResolvedValueOnce(closedTicket());
    const user = renderDialog(17);
    await user.click(await screen.findByRole("button", { name: "Save changes" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Overlapping time" });
    expect(dialog).toHaveTextContent("Overlaps 30 min with Manual entry, 22:30-23:00");
    // Not a field error: no tab is flagged for it (the modal hides the tabs
    // from the accessibility tree, so look for the flag's text itself).
    expect(screen.queryByText(/needs attention/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "I confirm this overlap is correct" }));
    await user.click(screen.getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(apiPatch).mock.calls;
    expect(second?.[0]).toBe("/tickets/17/");
    expect(formEntries(second?.[1])).toContainEqual(["confirm_overlaps", "true"]);
    // Everything else is exactly what was sent the first time.
    expect(formEntries(second?.[1]).filter(([k]) => k !== "confirm_overlaps")).toEqual(
      formEntries(first?.[1]).filter(([k]) => k !== "confirm_overlaps"),
    );
  });

  it("Go back and edit keeps everything entered", async () => {
    serve(closedTicket());
    vi.mocked(apiPatch).mockRejectedValueOnce(OVERLAP_409);
    const user = renderDialog(17);
    const number = await screen.findByLabelText(/CMS Next Ticket No/);
    await user.clear(number);
    await user.type(number, "CMS-2002");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Go back and edit" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/CMS Next Ticket No/)).toHaveValue("CMS-2002");
    expect(apiPatch).toHaveBeenCalledTimes(1);
  });

  it("a malformed 409 is a generic error, not a confirmation", async () => {
    serve(closedTicket());
    vi.mocked(apiPatch).mockRejectedValueOnce(
      new ApiError(409, "The request couldn't be completed.", { data: { code: "other" } }),
    );
    const user = renderDialog(17);
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        "The ticket couldn't be saved (error 409). Your entries are kept; try again.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("warns inline when two activities with the same resolver overlap", async () => {
    const base = closedTicket().activities[0]!;
    serve(
      closedTicket({
        activities: [
          base,
          { ...base, id: 92, start_at: "2026-09-24T15:00:00Z", end_at: "2026-09-24T16:00:00Z" },
          // Same time, nobody resolving it: never compared.
          { ...base, id: 93, resolved_by: null },
        ],
      }),
    );
    const user = renderDialog(17);
    await user.click(await screen.findByRole("tab", { name: /Activities/ }));
    expect(await screen.findByText("Overlaps with activity 2")).toBeVisible();
    expect(screen.getByText("Overlaps with activity 1")).toBeVisible();
    expect(screen.getAllByText(/^Overlaps with/)).toHaveLength(2);
    // Advisory only: nothing flagged as an error.
    expect(flaggedTabs().Activities).toBe(false);
  });
});
