// The shared pieces this review consolidated: the status pill, read-only
// flags, the page header and its primary action, and the date-time cell.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActiveBadge, ToneBadge } from "@/components/common/tone-badge";
import { PageHeader, PrimaryAction } from "@/components/layout/page-header";
import { DateTimeCell, FlagCell, StatusCell } from "@/components/tickets/cells";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("ToneBadge", () => {
  it("always shows the word, with the colour only as decoration", () => {
    render(<ToneBadge tone="var(--status-open)">Open</ToneBadge>);
    const badge = screen.getByText("Open");
    expect(badge).toHaveAttribute("data-slot", "tone-badge");
    // The text is mixed toward the foreground (contrast), the pill a light tint.
    expect(badge.style.color).toContain("var(--foreground) 60%");
    expect(badge.style.backgroundColor).toContain("var(--status-open) 14%");
    // The dot is hidden from assistive tech: the word carries the meaning.
    expect(badge.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("renders the shared Active / Inactive and ticket status pills", () => {
    render(
      <>
        <ActiveBadge active />
        <ActiveBadge active={false} />
        <StatusCell status="Closed" />
      </>,
    );
    for (const word of ["Active", "Inactive", "Closed"]) {
      expect(screen.getByText(word)).toHaveAttribute("data-slot", "tone-badge");
    }
  });
});

describe("FlagCell", () => {
  it("is not a control: a check mark for yes, a dash for no, both named", () => {
    render(
      <>
        <FlagCell checked label="Pre" />
        <FlagCell checked={false} label="Likely cause" />
      </>,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Pre: yes")).toBeInTheDocument();
    expect(screen.getByText("Likely cause: no")).toBeInTheDocument();
  });
});

describe("DateTimeCell", () => {
  it("uses the app's one date-time format, in local time", () => {
    // Vitest runs in America/New_York (see vitest.config.mts).
    render(<DateTimeCell value={Date.UTC(2026, 8, 24, 18, 30)} />);
    expect(screen.getByText("24 Sep 2026, 2:30 PM")).toBeInTheDocument();
  });

  it("shows a named dash when empty", () => {
    render(<DateTimeCell value={undefined} />);
    expect(screen.getByText("No value")).toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("lays out the breadcrumb, a single h1, the description and the actions", async () => {
    const onClick = vi.fn();
    render(
      <PageHeader
        trail={[{ label: "Lookups" }, { label: "Sites" }]}
        title="Sites"
        description="Where tickets come from."
        actions={<PrimaryAction onClick={onClick}>Add site</PrimaryAction>}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sites");
    expect(screen.getByText("Where tickets come from.")).toBeInTheDocument();
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail).toHaveTextContent("Home");
    expect(screen.getByText("Sites", { selector: "[aria-current=page]" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add site" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("omits the description and actions when there are none", () => {
    const { container } = render(<PageHeader trail={[{ label: "Reports" }]} title="Reports" />);
    expect(container.querySelector("p.text-label")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
