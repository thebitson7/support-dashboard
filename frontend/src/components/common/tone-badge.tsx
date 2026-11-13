import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * The app's one status pill: a coloured dot and a word on a tint of the same
 * colour (ticket status, active / inactive, AMS / Non-AMS, audit actions).
 * Meaning never rests on colour alone: the word is always there.
 *
 * `tone` is a theme colour, e.g. "var(--status-open)". The text is that
 * colour mixed 60% toward the foreground and the pill a 14% tint of it, which
 * keeps every theme token at or above 5:1 (WCAG AA) in light and dark mode,
 * on the card and on the tickets table's tinted Open rows.
 */
export function ToneBadge({
  tone,
  children,
  className,
}: {
  tone: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-slot="tone-badge"
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap",
        className,
      )}
      style={{
        color: `color-mix(in oklab, ${tone}, var(--foreground) 60%)`,
        backgroundColor: `color-mix(in oklab, ${tone} 14%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: tone }}
      />
      {children}
    </span>
  );
}

/** Active / Inactive (users, sites, work done codes). */
export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <ToneBadge tone={active ? "var(--chart-success)" : "var(--muted-foreground)"}>
      {active ? "Active" : "Inactive"}
    </ToneBadge>
  );
}
