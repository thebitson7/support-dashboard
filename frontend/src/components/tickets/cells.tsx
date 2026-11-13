import { Check } from "lucide-react";
import { cn } from "cn";

import type { TicketStatus } from "@/types/tickets";
import { formatLocal, formatLocalDisplay, partsOfDate } from "@/lib/local-datetime";
import { ToneBadge } from "@/components/common/tone-badge";

/**
 * "24 Sep 2026, 2:30 PM" in the viewer's local time: the app's one date-time
 * format, the same the ticket form's pickers show. (Rows only ever render in
 * the browser, after the API call, so there is no hydration mismatch.)
 */
function formatDateTime(ms: number) {
  return formatLocalDisplay(formatLocal(partsOfDate(new Date(ms))));
}

/**
 * Empty values read as a quiet dash, not a blank gap. Screen readers get
 * "No value" as text: an aria-label on a plain span is ignored by many.
 */
export function Dash() {
  return (
    <span className="text-muted-foreground/60">
      <span aria-hidden>—</span>
      <span className="sr-only">No value</span>
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
  return (
    <ToneBadge tone={status === "Open" ? "var(--status-open)" : "var(--status-closed)"}>
      {status}
    </ToneBadge>
  );
}

/**
 * A read-only yes/no in a table: a check mark for yes, the table's quiet
 * dash for no. Deliberately not a checkbox, which would look clickable.
 */
export function FlagCell({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span className="flex justify-center">
      {checked ? (
        <>
          <Check className="size-4.5 text-foreground" strokeWidth={2.5} aria-hidden />
          <span className="sr-only">{label}: yes</span>
        </>
      ) : (
        <span className="text-muted-foreground/60">
          <span aria-hidden>—</span>
          <span className="sr-only">{label}: no</span>
        </span>
      )}
    </span>
  );
}

export function PreCell({ checked }: { checked: boolean }) {
  return <FlagCell checked={checked} label="Pre" />;
}
