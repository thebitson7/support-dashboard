"use client";

import { ClipboardList, Lock, Pencil, Plus, RotateCw, Ticket, Trash2 } from "lucide-react";

import type { WorkLogEntry } from "@/types/working-hours";
import type { ApiError } from "@/lib/api";
import {
  CATEGORY_COLOR,
  WORK_CATEGORIES,
  entryMinutes,
  formatTimeRange,
} from "@/lib/working-hours";
import { formatMinutes } from "@/components/tickets/ticket-form/form-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const categoryLabel = (entry: WorkLogEntry) =>
  WORK_CATEGORIES.find((c) => c.value === entry.category)?.label ?? entry.category;

function CategoryPill({ category }: { category: WorkLogEntry["category"] }) {
  const color = CATEGORY_COLOR[category];
  return (
    <span
      className="inline-flex w-20 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        color: `color-mix(in oklab, ${color}, var(--foreground) 45%)`,
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
      }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {WORK_CATEGORIES.find((c) => c.value === category)?.label}
    </span>
  );
}

/** In place of edit/delete on an auto entry: why it can't be changed here. */
function FromTicketBadge({ reference }: { reference: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            // Focusable so keyboard users can reach the explanation too.
            tabIndex={0}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={`From ${reference}. Recorded automatically from the ticket's activity; to change it, edit the activity on the ticket.`}
          />
        }
      >
        <Lock className="size-3.5" aria-hidden />
        From ticket
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64">
        Recorded automatically from this ticket activity. To change it, edit the activity on the
        ticket.
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One person's entries for one day, in time order: auto entries (from ticket
 * activities, read-only) and manual ones (edit / delete).
 */
export function DayEntries({
  entries,
  error,
  onRetry,
  canLog,
  onAdd,
  onEdit,
  onDelete,
}: {
  entries: WorkLogEntry[] | undefined;
  error: ApiError | undefined;
  onRetry: () => void;
  /** False for a future day, where nothing can be logged yet. */
  canLog: boolean;
  onAdd: () => void;
  onEdit: (entry: WorkLogEntry) => void;
  onDelete: (entry: WorkLogEntry) => void;
}) {
  const totalMinutes = (entries ?? []).reduce((sum, e) => sum + entryMinutes(e), 0);

  return (
    <Card className="gap-0 py-0 shadow-elev-1">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3.5">
        <h2 className="text-title">Entries</h2>
        {entries && entries.length > 0 && (
          <p className="text-label tabular-nums">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
            <span className="font-semibold text-foreground">{formatMinutes(totalMinutes)}</span>
          </p>
        )}
      </header>

      {error && !entries ? (
        <div
          role="alert"
          className="text-label flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        >
          {error.status === 404
            ? "This person's account doesn't exist or has been deactivated."
            : error.status === 403
              ? "You don't have permission to view this job sheet."
              : "Couldn't load this day's entries."}
          {error.status !== 403 && error.status !== 404 && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw aria-hidden />
              Try again
            </Button>
          )}
        </div>
      ) : !entries ? (
        <div className="grid gap-3 px-5 py-4" role="status" aria-label="Loading entries">
          <Skeleton className="h-5 w-2/3 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-5 w-1/2 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-5 w-3/5 rounded-full motion-reduce:animate-none" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <ClipboardList className="size-6" aria-hidden />
          </span>
          <div className="grid gap-1">
            <p className="text-title">No work logged for this day</p>
            <p className="text-label">
              AMS time appears here from ticket activities; Non-AMS time is logged by hand.
            </p>
          </div>
          {canLog && (
            <Button variant="outline" size="sm" onClick={onAdd}>
              <Plus aria-hidden />
              Log hours
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => {
            const range = formatTimeRange(entry);
            const label = `${categoryLabel(entry)} ${range}`;
            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5"
              >
                <CategoryPill category={entry.category} />
                {/* "9:00 AM – 10:30 AM · 1h 30m" */}
                <span className="shrink-0 text-sm whitespace-nowrap tabular-nums">
                  {range}
                  <span className="text-muted-foreground" aria-hidden>
                    {" · "}
                  </span>
                  <span className="sr-only">, </span>
                  <span className="font-semibold">{formatMinutes(entryMinutes(entry))}</span>
                </span>
                {entry.is_auto && entry.ticket_reference ? (
                  <span
                    className="flex min-w-0 flex-1 basis-48 items-center gap-1.5 text-sm"
                    title={entry.ticket_reference}
                  >
                    <Ticket className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{entry.ticket_reference}</span>
                  </span>
                ) : (
                  <span
                    className="min-w-0 flex-1 basis-48 truncate text-sm text-muted-foreground"
                    title={entry.note || undefined}
                  >
                    {entry.note || <span className="text-caption">No note</span>}
                  </span>
                )}
                {entry.is_auto ? (
                  <FromTicketBadge reference={entry.ticket_reference ?? "a ticket"} />
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${label}`}
                      onClick={() => onEdit(entry)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${label}`}
                      onClick={() => onDelete(entry)}
                      className="hover:text-destructive"
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
