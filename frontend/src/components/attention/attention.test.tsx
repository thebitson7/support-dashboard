// The sign-in alert and Home's "Needs closing" box, rendered with the real
// provider over a mocked API.

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet } from "@/lib/api";
import { acknowledge, clearAcknowledgement } from "@/lib/attention";
import type { AttentionResponse } from "@/types/attention";
import { AttentionAlert } from "@/components/attention/attention-alert";
import { NeedsClosingBox } from "@/components/attention/needs-closing-box";
import {
  UrgentTicketsProvider,
  useUrgentTickets,
} from "@/components/attention/urgent-tickets-provider";
import { adminAttention, attentionTicket, staffAttention } from "@/test/attention-fixtures";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const viewer = { current: { id: 2, username: "syed", role: "staff" } };
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({ user: viewer.current }),
}));

function serve(response: AttentionResponse | ApiError) {
  vi.mocked(apiGet).mockImplementation(async () => {
    if (response instanceof ApiError) throw response;
    return response;
  });
}

function renderWith(ui: ReactNode) {
  render(<UrgentTicketsProvider>{ui}</UrgentTicketsProvider>);
  return userEvent.setup();
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  sessionStorage.clear();
  clearAcknowledgement();
  viewer.current = { id: 2, username: "syed", role: "staff" };
});
afterEach(() => clearAcknowledgement());

describe("sign-in alert", () => {
  it("shows the staff list for an overdue ticket, focused on I understand", async () => {
    serve(staffAttention([attentionTicket()]));
    renderWith(<AttentionAlert />);
    const dialog = await screen.findByRole("dialog", { name: "Tickets waiting to be closed" });
    expect(
      within(dialog).getByText("Tickets should be closed within 2 days of the last activity."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("DEMO-ATT-1001")).toBeInTheDocument();
    expect(within(dialog).getByText("Overdue")).toBeInTheDocument();
    expect(within(dialog).getByText("2 d 3 h since last activity")).toBeInTheDocument();
    expect(within(dialog).getByText("Also on this ticket: Naleefa Kareem")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "I understand" })).toHaveFocus(),
    );
  });

  it("links Close ticket to the ticket's Verification tab", async () => {
    serve(staffAttention([attentionTicket()]));
    renderWith(<AttentionAlert />);
    const link = await screen.findByRole("link", { name: "Close ticket DEMO-ATT-1001" });
    expect(link).toHaveAttribute("href", "/ams-tickets?edit=1001&tab=verification");
  });

  it("shows for a critical ticket", async () => {
    serve(staffAttention([attentionTicket({ level: "critical", age_hours: 77 })]));
    renderWith(<AttentionAlert />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not show for due-soon tickets only", async () => {
    serve(staffAttention([attentionTicket({ level: "due_soon", age_hours: 30 })]));
    renderWith(<AttentionAlert />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not show once acknowledged this tab session", async () => {
    acknowledge();
    serve(staffAttention([attentionTicket()]));
    renderWith(<AttentionAlert />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("I understand dismisses it and remembers that", async () => {
    serve(staffAttention([attentionTicket()]));
    const user = renderWith(<AttentionAlert />);
    await user.click(await screen.findByRole("button", { name: "I understand" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sessionStorage.getItem("attention-alert-acknowledged")).toBe("1");
  });

  it("Escape acknowledges it", async () => {
    serve(staffAttention([attentionTicket()]));
    const user = renderWith(<AttentionAlert />);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sessionStorage.getItem("attention-alert-acknowledged")).toBe("1");
  });

  it("shows admins the team summary, not a ticket list", async () => {
    viewer.current = { id: 1, username: "admin", role: "admin" };
    serve(adminAttention());
    renderWith(<AttentionAlert />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Team summary")).toBeInTheDocument();
    expect(within(dialog).getByText("Wahida Begum")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: /Close ticket/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /View all/ })).toHaveAttribute("href", "/");
  });

  it("stays out of the way when the endpoint fails", async () => {
    serve(new ApiError(500, "The server returned an unexpected error."));
    renderWith(<AttentionAlert />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Needs closing box", () => {
  it("shows staff the chips, their tickets and the live label", async () => {
    serve(
      staffAttention([
        attentionTicket(),
        attentionTicket({
          id: 1004,
          cms_next_ticket_no: "DEMO-ATT-1004",
          level: "due_soon",
          age_hours: 60,
          basis: "received",
        }),
      ]),
    );
    renderWith(<NeedsClosingBox />);
    const box = await screen.findByRole("region", { name: "Needs closing" });
    expect(await within(box).findByText("DEMO-ATT-1001")).toBeInTheDocument();
    expect(within(box).getByText("Live")).toBeInTheDocument();
    const chips = within(box).getByRole("list", { name: "Tickets by level" });
    expect(chips).toHaveTextContent("Critical0");
    expect(chips).toHaveTextContent("Overdue1");
    expect(chips).toHaveTextContent("Due soon1");
    expect(within(box).getByRole("link", { name: /DEMO-ATT-1004/ })).toHaveAttribute(
      "href",
      "/ams-tickets?edit=1004&tab=verification",
    );
    expect(within(box).queryByRole("tab")).not.toBeInTheDocument();
    expect(
      within(box).getByText(/Target: close within 48 h of the last activity/),
    ).toBeInTheDocument();
  });

  it("collapses long lists behind Show N more", async () => {
    serve(
      staffAttention(
        Array.from({ length: 9 }, (_, i) =>
          attentionTicket({ id: 2000 + i, cms_next_ticket_no: `T-${i}` }),
        ),
      ),
    );
    const user = renderWith(<NeedsClosingBox />);
    const more = await screen.findByRole("button", { name: "Show 3 more" });
    expect(screen.getAllByRole("link")).toHaveLength(6);
    await user.click(more);
    expect(screen.getAllByRole("link")).toHaveLength(9);
  });

  it("says all caught up when nothing waits", async () => {
    serve(staffAttention([]));
    renderWith(<NeedsClosingBox />);
    expect(
      await screen.findByText("All caught up — nothing is waiting to be closed."),
    ).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    vi.mocked(apiGet).mockImplementation(() => new Promise(() => {}));
    renderWith(<NeedsClosingBox />);
    expect(
      screen.getByRole("status", { name: "Loading tickets waiting to be closed" }),
    ).toBeInTheDocument();
  });

  it("shows a short generic error with a retry that works", async () => {
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new ApiError(500, "The server returned an unexpected error."))
      .mockResolvedValue(staffAttention([attentionTicket()]));
    const user = renderWith(<NeedsClosingBox />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load tickets waiting to be closed");
    expect(alert).toHaveTextContent("The server returned an unexpected error.");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("DEMO-ATT-1001")).toBeInTheDocument();
  });

  it("gives admins By person and All tickets tabs", async () => {
    viewer.current = { id: 1, username: "admin", role: "admin" };
    serve(adminAttention());
    const user = renderWith(<NeedsClosingBox />);
    expect(await screen.findByRole("tab", { name: "By Person" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("A ticket counts for everyone named on it.")).toBeInTheDocument();
    const naleefa = screen.getByRole("button", { name: /Naleefa Kareem/ });
    expect(naleefa).toHaveTextContent("1 overdue");
    expect(naleefa).toHaveTextContent("1 due soon");
    await user.click(naleefa);
    const theirs = screen.getByRole("list", { name: "Naleefa Kareem's tickets" });
    expect(within(theirs).getAllByRole("link")).toHaveLength(2);

    await user.click(screen.getByRole("tab", { name: "All Tickets" }));
    const all = await screen.findByRole("list", { name: "Tickets waiting to be closed" });
    expect(within(all).getAllByRole("link")).toHaveLength(3);
  });
});

describe("provider", () => {
  function Probe() {
    const { data, error } = useUrgentTickets();
    return <p>{error ? "error" : data ? `total ${data.total}` : "none"}</p>;
  }

  it("keeps the last good data when a later refresh fails", async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(staffAttention([attentionTicket()]))
      .mockRejectedValue(new ApiError(502, "down"));
    render(
      <UrgentTicketsProvider>
        <Probe />
      </UrgentTicketsProvider>,
    );
    expect(await screen.findByText("total 1")).toBeInTheDocument();
    document.dispatchEvent(new Event("visibilitychange")); // jsdom is "visible"
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("total 1")).toBeInTheDocument();
  });

  it("treats a malformed 2xx body as an error, never rendering it", async () => {
    vi.mocked(apiGet).mockResolvedValue("<html>oops</html>" as unknown as AttentionResponse);
    render(
      <UrgentTicketsProvider>
        <Probe />
      </UrgentTicketsProvider>,
    );
    expect(await screen.findByText("error")).toBeInTheDocument();
  });
});
