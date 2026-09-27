"use client";

import { Fragment, useState, useSyncExternalStore, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crosshair,
} from "lucide-react";
import { cn } from "cn";

import type { AuditEntry } from "@/types/audit";
import { EASE } from "@/lib/motion";
import { SortIcon } from "@/components/common/sort-icon";
import { TruncatedText } from "@/components/dashboard/bits";
import { Dash } from "@/components/tickets/cells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  TONE_TOKEN,
  dayKey,
  dayLabel,
  eventText,
  formatFull,
  formatStamp,
  formatTime,
  metadataLines,
  toneOf,
} from "./audit-format";
import type { Target } from "./audit-filters";

export type SortColumn = "created_at" | "actor" | "action" | "target";
export type Sort = { column: SortColumn; desc: boolean };
export type Person = { name: string; initials: string };

export const PAGE_SIZE = 50;

/** Same shape as the ticket Status and Lookups Active badges: dot + tinted pill. */
function ActionBadge({ action, label }: { action: string; label: string }) {
  const token = TONE_TOKEN[toneOf(action)];
  const neutral = toneOf(action) === "neutral";
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-0 font-semibold"
      style={{
        color: neutral
          ? "var(--muted-foreground)"
          : `color-mix(in oklab, ${token}, var(--foreground) 30%)`,
        backgroundColor: neutral
          ? "var(--muted)"
          : `color-mix(in oklab, ${token} 13%, transparent)`,
      }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: token }} />
      {label}
    </Badge>
  );
}

function Avatar({ person }: { person: Person | null }) {
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground"
    >
      {person?.initials ?? "·"}
    </span>
  );
}

// Column plan (table-layout: fixed, so widths hold and long text truncates):
// When | Who | Action | Event (takes the rest) | Target (wide screens) | expand.
type Column = { id: string; header: string; sort?: SortColumn; col: string };
const columnsFor = (grouped: boolean, wide: boolean): Column[] => [
  // Inside a day group only the time is shown, so the column can be narrower.
  { id: "when", header: "When", sort: "created_at", col: grouped ? "w-24" : "w-36" },
  { id: "who", header: "Who", sort: "actor", col: "w-40" },
  { id: "action", header: "Action", sort: "action", col: "w-40" },
  { id: "event", header: "Event", col: "" },
  ...(wide ? [{ id: "target", header: "Target", sort: "target" as const, col: "w-52" }] : []),
];

// The Target column is left out below 1280px (it's in the row details too).
// Decided in JS, not with display:none, because a fixed-layout table still
// counts a hidden column, which left a phantom gap beside the day headings.
const WIDE_QUERY = "(min-width: 80rem)";
function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-caption font-medium">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </>
  );
}

function EntryDetails({
  entry,
  person,
  onTarget,
}: {
  entry: AuditEntry;
  person: Person | null;
  onTarget: (target: Target) => void;
}) {
  const lines = metadataLines(entry);
  const hasTarget = Boolean(entry.target_type && entry.target_id);
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <DetailRow label="Recorded">
        <span className="tabular-nums">{formatFull(entry.created_at)}</span>
      </DetailRow>
      <DetailRow label="Description">{entry.description}</DetailRow>
      <DetailRow label="User">
        {entry.actor_username ? (
          <>
            {person?.name ?? entry.actor_username}{" "}
            <span className="font-mono text-[13px] text-muted-foreground">
              @{entry.actor_username}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">System</span>
        )}
      </DetailRow>
      <DetailRow label="Target">
        {hasTarget ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{entry.target_label || `${entry.target_type} #${entry.target_id}`}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {entry.target_type} · {entry.target_id}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onTarget({
                  type: entry.target_type,
                  id: entry.target_id,
                  label: entry.target_label || `${entry.target_type} ${entry.target_id}`,
                })
              }
              className="-my-1 h-7 text-primary hover:text-primary"
            >
              <Crosshair aria-hidden />
              Show all entries for this
            </Button>
          </span>
        ) : (
          <Dash />
        )}
      </DetailRow>
      {lines.map((line) => (
        <DetailRow key={line.label} label={line.label}>
          {line.value}
        </DetailRow>
      ))}
      <DetailRow label="IP address">
        {entry.ip_address ? (
          <span className="font-mono text-[13px]">{entry.ip_address}</span>
        ) : (
          <Dash />
        )}
      </DetailRow>
    </dl>
  );
}

function Pagination({
  page,
  count,
  onPage,
}: {
  page: number;
  count: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const first = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, count);
  const fmt = (n: number) => n.toLocaleString("en-US");
  const buttons: [string, typeof ChevronLeft, number, boolean][] = [
    ["First page", ChevronsLeft, 1, page > 1],
    ["Previous page", ChevronLeft, page - 1, page > 1],
    ["Next page", ChevronRight, page + 1, page < pages],
    ["Last page", ChevronsRight, pages, page < pages],
  ];
  const nav = (items: typeof buttons) =>
    items.map(([label, Icon, to, enabled]) => (
      <Button
        key={label}
        variant="ghost"
        size="icon"
        aria-label={label}
        disabled={!enabled}
        onClick={() => onPage(to)}
      >
        <Icon strokeWidth={2} />
      </Button>
    ));
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border bg-card px-4 py-2.5">
      <p className="text-label">
        Showing{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {fmt(first)}–{fmt(last)}
        </span>{" "}
        of <span className="font-semibold text-foreground tabular-nums">{fmt(count)}</span>
      </p>
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          {nav(buttons.slice(0, 2))}
          <span className="text-label px-2 tabular-nums">
            Page <span className="font-semibold text-foreground">{fmt(page)}</span> of {fmt(pages)}
          </span>
          {nav(buttons.slice(2))}
        </nav>
      )}
    </div>
  );
}

/**
 * The log itself. Rows are one line each (who, what, when first; the target
 * quieter; the IP, ids and changed values in the expandable details), grouped
 * under a day heading while sorted by time.
 */
export function AuditTable({
  rows,
  count,
  page,
  onPage,
  sort,
  onSort,
  people,
  onTarget,
  loading,
  refreshing,
  fetchedAt,
}: {
  rows: AuditEntry[];
  count: number | undefined;
  page: number;
  onPage: (page: number) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
  /** Current names by user id (the entry itself snapshots only the username). */
  people: Map<number, Person>;
  onTarget: (target: Target) => void;
  loading: boolean;
  refreshing: boolean;
  fetchedAt: Date | undefined;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const grouped = sort.column === "created_at";
  const wide = useWide();
  const columns = columnsFor(grouped, wide);
  const columnCount = columns.length + 1;

  const cell = "border-b border-border/60 px-4 py-2.5";
  const body = rows.map((entry, index) => {
    const person = entry.actor !== null ? (people.get(entry.actor) ?? null) : null;
    const name = person?.name ?? (entry.actor_username || null);
    const expanded = open.has(entry.id);
    const detailsId = `audit-entry-${entry.id}`;
    const newDay =
      grouped && (index === 0 || dayKey(rows[index - 1].created_at) !== dayKey(entry.created_at));
    const hasTarget = Boolean(entry.target_type && entry.target_id);
    return (
      <Fragment key={entry.id}>
        {newDay && (
          <tr>
            <th
              colSpan={columnCount}
              scope="colgroup"
              className="border-b border-border/60 bg-muted/50 px-4 py-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {dayLabel(entry.created_at)}
            </th>
          </tr>
        )}
        <tr
          onClick={(event) => {
            // The whole row opens the details, except its own buttons and a text selection.
            if (event.target instanceof Element && event.target.closest("button")) return;
            if (window.getSelection()?.toString()) return;
            toggle(entry.id);
          }}
          className={cn(
            "group cursor-pointer transition-colors duration-150 hover:bg-foreground/5",
            expanded && "bg-foreground/[0.035]",
          )}
        >
          <td className={cn(cell, "whitespace-nowrap text-muted-foreground tabular-nums")}>
            <time dateTime={entry.created_at} title={formatFull(entry.created_at)}>
              {grouped ? formatTime(entry.created_at) : formatStamp(entry.created_at)}
            </time>
          </td>
          <td className={cell}>
            <span className="flex min-w-0 items-center gap-2">
              <Avatar person={person} />
              {name ? (
                <TruncatedText className="font-semibold">{name}</TruncatedText>
              ) : (
                <span className="text-muted-foreground">System</span>
              )}
            </span>
          </td>
          <td className={cell}>
            <ActionBadge action={entry.action} label={entry.action_label} />
          </td>
          <td className={cell}>
            {/* "signed in" beside a "Signed in" badge adds nothing, so it steps back. */}
            <TruncatedText
              className={cn(
                eventText(entry, name).toLowerCase() === entry.action_label.toLowerCase() &&
                  "text-muted-foreground",
              )}
            >
              {eventText(entry, name)}
            </TruncatedText>
          </td>
          {wide && (
            <td className={cell}>
              {hasTarget ? (
                <button
                  type="button"
                  title="Show all entries for this"
                  onClick={() =>
                    onTarget({
                      type: entry.target_type,
                      id: entry.target_id,
                      label: entry.target_label || `${entry.target_type} ${entry.target_id}`,
                    })
                  }
                  className="block max-w-full truncate rounded-sm text-left text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {entry.target_label || `${entry.target_type} #${entry.target_id}`}
                </button>
              ) : (
                <Dash />
              )}
            </td>
          )}
          <td className={cn(cell, "px-2 py-1 text-right")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={expanded}
              aria-controls={expanded ? detailsId : undefined}
              aria-label={expanded ? "Hide details" : "Show details"}
              onClick={() => toggle(entry.id)}
              className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronDown
                aria-hidden
                className={cn("transition-transform duration-200", expanded && "rotate-180")}
              />
            </Button>
          </td>
        </tr>
        {expanded && (
          <tr id={detailsId}>
            <td
              colSpan={columnCount}
              className={cn(
                "border-b border-border/60 bg-muted/40 px-4 py-3",
                grouped ? "sm:pl-[7rem]" : "sm:pl-[10rem]",
              )}
            >
              <EntryDetails entry={entry} person={person} onTarget={onTarget} />
            </td>
          </tr>
        )}
      </Fragment>
    );
  });

  return (
    <>
      <div
        role="region"
        aria-label="Audit log table"
        tabIndex={0}
        // relative: keeps absolutely positioned descendants (sr-only text) inside the scroll area.
        className="scrollbar-styled relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <table
          aria-busy={loading || refreshing}
          className="w-full min-w-[40rem] table-fixed border-separate border-spacing-0 text-sm"
        >
          <colgroup>
            {columns.map((c) => (
              <col key={c.id} className={c.col} />
            ))}
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = column.sort === sort.column;
                const direction = active ? (sort.desc ? "desc" : "asc") : false;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      !column.sort
                        ? undefined
                        : direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : "none"
                    }
                    className={cn(
                      "sticky top-0 z-10 border-b border-border bg-muted px-4 py-2 text-left text-[13px] font-semibold whitespace-nowrap",
                    )}
                  >
                    {column.sort ? (
                      <button
                        type="button"
                        onClick={() => {
                          const key = column.sort!;
                          // Time reads best newest-first; the rest A→Z.
                          onSort(
                            sort.column === key
                              ? { ...sort, desc: !sort.desc }
                              : { column: key, desc: key === "created_at" },
                          );
                        }}
                        className="-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 outline-none transition-colors duration-150 hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {column.header}
                        <SortIcon direction={direction} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              <th
                scope="col"
                className="sticky top-0 z-10 border-b border-border bg-muted px-2 py-2"
              >
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              {Array.from({ length: 10 }, (_, i) => (
                <tr key={i}>
                  <td className={cell}>
                    <Skeleton className="h-4 w-16 rounded-full motion-reduce:animate-none" />
                  </td>
                  <td className={cell}>
                    <span className="flex items-center gap-2">
                      <Skeleton className="size-6 rounded-full motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-24 rounded-full motion-reduce:animate-none" />
                    </span>
                  </td>
                  <td className={cell}>
                    <Skeleton className="h-5 w-24 rounded-full motion-reduce:animate-none" />
                  </td>
                  <td className={cell}>
                    <Skeleton
                      className={cn(
                        "h-4 rounded-full motion-reduce:animate-none",
                        i % 3 ? "w-3/4" : "w-1/2",
                      )}
                    />
                  </td>
                  {wide && (
                    <td className={cell}>
                      <Skeleton className="h-4 w-28 rounded-full motion-reduce:animate-none" />
                    </td>
                  )}
                  <td className={cell} />
                </tr>
              ))}
            </tbody>
          ) : (
            <motion.tbody
              key={fetchedAt?.getTime()}
              initial={{ opacity: reduce ? 1 : 0.35 }}
              animate={{ opacity: refreshing ? 0.55 : 1 }}
              transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
            >
              {body}
            </motion.tbody>
          )}
        </table>
      </div>
      {count !== undefined && <Pagination page={page} count={count} onPage={onPage} />}
    </>
  );
}
