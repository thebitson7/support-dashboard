import { cn } from "cn";

import type { TicketStatus } from "@/types/tickets";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * DD/MM/YYYY HH:mm in the viewer's local time: the same clock the ticket form
 * uses for entry. (Rows only ever render in the browser, after the API call,
 * so there is no server/client hydration mismatch to guard against.)
 */
function formatDateTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Empty values read as a quiet dash, not a blank gap. */
export function Dash() {
  return (
    <span className="text-muted-foreground/60" aria-label="No value">
      —
    </span>
  );
}

export function TextCell({
  value,
  strong,
  mono,
}: {
  value: string | undefined;
  strong?: boolean;
  mono?: boolean;
}) {
  if (!value) return <Dash />;
  return (
    <span className={cn(strong && "font-semibold", mono && "font-mono text-[13px] tracking-tight")}>
      {value}
    </span>
  );
}

export function DateTimeCell({ value }: { value: number | undefined }) {
  if (value === undefined) return <Dash />;
  return <span className="tabular-nums">{formatDateTime(value)}</span>;
}

export function DurationCell({ value }: { value: number }) {
  return <span className="tabular-nums">{value.toFixed(2)}</span>;
}

/**
 * Open reads as "attention" (muted coral), Closed as calm and done (teal).
 * Both come from theme tokens, so light and dark are handled in globals.css.
 */
export function StatusCell({ status }: { status: TicketStatus }) {
  const token = status === "Open" ? "var(--status-open)" : "var(--status-closed)";
  // The Open row wash is strong, so the badge text steps toward the
  // foreground colour (deeper in light, paler in dark) to stay readable on it.
  const text =
    status === "Open" ? "color-mix(in oklab, var(--status-open), var(--foreground) 72%)" : token;
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-0 font-semibold"
      style={{
        color: text,
        backgroundColor: `color-mix(in oklab, ${token} 12%, transparent)`,
      }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: token }} />
      {status}
    </Badge>
  );
}

/**
 * A boolean shown as a real checkbox in a read-only state: a filled orange
 * box with a check when set, a clear outlined box when not.
 */
export function FlagCell({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span className="flex justify-center">
      <Checkbox
        checked={checked}
        readOnly
        tabIndex={-1}
        aria-label={`${label}: ${checked ? "yes" : "no"}`}
        className="pointer-events-none size-4.5"
      />
    </span>
  );
}

export function PreCell({ checked }: { checked: boolean }) {
  return <FlagCell checked={checked} label="Pre" />;
}
