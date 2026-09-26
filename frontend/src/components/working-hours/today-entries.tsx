"use client";

import { ClipboardList, Pencil, RotateCw, Trash2 } from "lucide-react";

import type { WorkLogEntry } from "@/types/working-hours";
import type { ApiError } from "@/lib/api";
import { formatDateDisplay } from "@/lib/local-datetime";
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

/**
 * The day's entries, so a mistake can be fixed where it was made. Only
 * today's: a full history browser is deliberately out of scope for now.
 */
export function TodayEntries({
  today,
  entries,
  error,
  onRetry,
  onAdd,
  onEdit,
  onDelete,
}: {
  today: string;
  entries: WorkLogEntry[] | undefined;
  error: ApiError | undefined;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (entry: WorkLogEntry) => void;
  onDelete: (entry: WorkLogEntry) => void;
}) {
  const totalMinutes = (entries ?? []).reduce((sum, e) => sum + entryMinutes(e), 0);

  return (
    <Card className="gap-0 py-0 shadow-elev-1">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3.5">
        <h2 className="text-title">
          Today&apos;s entries
          <span className="text-caption font-normal"> · {formatDateDisplay(today)}</span>
        </h2>
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
          Couldn&apos;t load today&apos;s entries.
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw aria-hidden />
            Try again
          </Button>
        </div>
      ) : !entries ? (
        <div className="grid gap-3 px-5 py-4" role="status" aria-label="Loading today's entries">
          <Skeleton className="h-5 w-2/3 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-5 w-1/2 rounded-full motion-reduce:animate-none" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-label flex items-center gap-2">
            <ClipboardList className="size-4" aria-hidden />
            Nothing logged today yet.
          </p>
          <Button variant="outline" size="sm" onClick={onAdd}>
            Log hours
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => {
            const range = formatTimeRange(entry);
            const duration = formatMinutes(entryMinutes(entry));
            const label = `${WORK_CATEGORIES.find((c) => c.value === entry.category)?.label} ${range}`;
            return (
              <li key={entry.id} className="flex items-center gap-3 px-5 py-2.5">
                <CategoryPill category={entry.category} />
                {/* "9:00 AM – 10:45 AM · 1h 45m" */}
                <span className="shrink-0 text-sm whitespace-nowrap tabular-nums">
                  {range}
                  <span className="text-muted-foreground" aria-hidden>
                    {" · "}
                  </span>
                  <span className="sr-only">, </span>
                  <span className="font-semibold">{duration}</span>
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
                  title={entry.note || undefined}
                >
                  {entry.note || <span className="text-caption">No note</span>}
                </span>
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
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
