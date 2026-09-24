import { cn } from "cn";

import type { TicketStatus } from "@/types/tickets";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

/** DD/MM/YYYY HH:mm. UTC getters keep server and client output identical. */
function formatDateTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Empty values read as a quiet dash, not a blank gap. */
function Dash() {
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
 * A real checkbox in a read-only state: a filled orange box with a check when
 * set, a clear outlined box when not. Not editable for now.
 */
export function PreCell({ checked }: { checked: boolean }) {
  return (
    <span className="flex justify-center">
      <Checkbox
        checked={checked}
        readOnly
        tabIndex={-1}
        aria-label={checked ? "Pre: yes" : "Pre: no"}
        className="pointer-events-none size-4.5"
      />
    </span>
  );
}
