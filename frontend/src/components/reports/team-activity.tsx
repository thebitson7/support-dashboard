"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarRange, ChevronRight, CircleAlert, ClipboardList, Users } from "lucide-react";
import { cn } from "cn";

import type { MemberActivityReport, ReportMember, TeamActivityReport } from "@/types/reports";
import type { WorkLogEntry } from "@/types/working-hours";
import { displayName, type AuthUser } from "@/lib/auth";
import { formatDuration } from "@/lib/format";
import {
  addDaysToDate,
  formatDateDisplay,
  formatDateLong,
  formatLocalDate,
  parseLocalDate,
  todayInZone,
} from "@/lib/local-datetime";
import { EASE } from "@/lib/motion";
import { entryMinutes, formatTimeRange } from "@/lib/working-hours";
import { useApiGet } from "@/hooks/use-api";
import { DateTimePicker } from "@/components/common/date-time-picker";
import { ExportButton } from "@/components/common/export-button";
import { SortIcon } from "@/components/common/sort-icon";
import { LoadErrorPlaceholder, StatePlaceholder } from "@/components/common/state-placeholder";
import { CategoryPill, FromTicketBadge } from "@/components/job-sheets/day-entries";
import { formatMinutes } from "@/components/tickets/ticket-form/form-model";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the API's limit (reports/views.py). */
const MAX_RANGE_DAYS = 366;

type Range = { start: string; end: string };

// --- Ranges (plain "YYYY-MM-DD" calendar arithmetic) --------------------------------

/** The calendar month containing `day` (shifted by `offset` months). */
function monthOf(day: string, offset = 0): Range {
  const p = parseLocalDate(day);
  if (!p) return { start: day, end: day };
  const first = new Date(p.year, p.month - 1 + offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const iso = (d: Date) =>
    formatLocalDate({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
  return { start: iso(first), end: iso(last) };
}

/** Monday–Sunday around `day`, like the period summary's weeks. */
function weekOf(day: string): Range {
  const p = parseLocalDate(day);
  if (!p) return { start: day, end: day };
  const weekday = (new Date(p.year, p.month - 1, p.day).getDay() + 6) % 7;
  const start = addDaysToDate(day, -weekday);
  return { start, end: addDaysToDate(start, 6) };
}

function dayCount({ start, end }: Range): number {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (!s || !e) return NaN;
  return (
    (Date.UTC(e.year, e.month - 1, e.day) - Date.UTC(s.year, s.month - 1, s.day)) / 86_400_000 + 1
  );
}

function rangeProblem(range: Range): string | null {
  if (!range.start || !range.end) return "Choose both a start and an end date.";
  const days = dayCount(range);
  if (days < 1) return "The end date must be on or after the start date.";
  if (days > MAX_RANGE_DAYS) return `Choose a range of at most ${MAX_RANGE_DAYS} days.`;
  return null;
}

const rangeLabel = ({ start, end }: Range) =>
  start === end
    ? formatDateDisplay(start)
    : `${formatDateDisplay(start)} – ${formatDateDisplay(end)}`;

// Every duration here is the API's exact minutes (summed from entry times),
// never hours: rounded hours don't add up (6 x 20 min = 6 x 0.33 h = 1.98 h).
const duration = (minutes: number) => formatDuration(minutes);

// --- The team table -----------------------------------------------------------------

type SortColumn = "name" | "total_minutes" | "ams_minutes" | "non_ams_minutes" | "entry_count";

const COLUMNS: { id: SortColumn; header: string; numeric?: boolean }[] = [
  { id: "name", header: "Team member" },
  { id: "total_minutes", header: "Total", numeric: true },
  { id: "ams_minutes", header: "AMS", numeric: true },
  { id: "non_ams_minutes", header: "Non-AMS", numeric: true },
  { id: "entry_count", header: "Entries", numeric: true },
];

function sortMembers(members: ReportMember[], column: SortColumn, desc: boolean) {
  const sorted = [...members].sort((a, b) =>
    column === "name"
      ? displayName(a.user).localeCompare(displayName(b.user), undefined, { sensitivity: "base" })
      : a[column] - b[column] ||
        displayName(a.user).localeCompare(displayName(b.user), undefined, { sensitivity: "base" }),
  );
  return desc ? sorted.reverse() : sorted;
}

const TH =
  "sticky top-0 z-10 border-b border-border bg-muted px-4 py-2 text-[13px] font-semibold whitespace-nowrap";
const TD = "border-b border-border/60 px-4 py-2.5 whitespace-nowrap";

function Enter({ delay, children }: { delay: number; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Admin-only: every active staff member's logged work over a date range
 * (defaulting to the current month in the viewer's profile zone), sortable,
 * with an inline drill-down into one person's entries and CSV exports.
 */
export function TeamActivity({ viewer }: { viewer: AuthUser }) {
  const reduce = useReducedMotion();
  const today = todayInZone(viewer.timezone);
  const presets: { label: string; range: Range }[] = [
    { label: "This week", range: weekOf(today) },
    { label: "This month", range: monthOf(today) },
    { label: "Last month", range: monthOf(today, -1) },
  ];
  const [range, setRange] = useState<Range>(() => monthOf(today));
  const [sort, setSort] = useState<{ column: SortColumn; desc: boolean }>({
    column: "name",
    desc: false,
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const ids = { start: useId(), end: useId(), problem: useId() };

  const problem = rangeProblem(range);
  const rangeQuery = new URLSearchParams({ start_date: range.start, end_date: range.end });
  const report = useApiGet<TeamActivityReport>(
    problem ? null : `/reports/team-activity/?${rangeQuery}`,
    { keepPreviousData: true },
  );
  const data = report.data;
  // The range the rows on screen belong to (the response's), which can lag
  // the pickers while a new range loads: labels and drill-downs use it, so a
  // row's detail always covers the same days as the row.
  const shownRange: Range = data ? { start: data.start_date, end: data.end_date } : range;
  const members = useMemo(
    () => (data ? sortMembers(data.members, sort.column, sort.desc) : []),
    [data, sort],
  );

  const changeRange = (next: Range) => {
    setRange(next);
    setExpanded(null);
  };

  let body: ReactNode;
  if (problem) {
    // Not the previous range's rows: they'd sit under dates they don't match.
    body = (
      <StatePlaceholder icon={CalendarRange} title="Choose a valid date range">
        {problem}
      </StatePlaceholder>
    );
  } else if (report.error) {
    // Even with older rows in hand: they're for a range other than the one asked for.
    body = (
      <LoadErrorPlaceholder error={report.error} what="the team report" onRetry={report.retry} />
    );
  } else if (data && data.members.length === 0) {
    body = (
      <StatePlaceholder icon={Users} title="No staff members yet">
        Staff accounts appear here once they exist.
      </StatePlaceholder>
    );
  } else if (data && data.totals.entry_count === 0 && !report.isRefreshing) {
    body = (
      <StatePlaceholder icon={CalendarRange} title="No work logged in this range">
        Nobody has logged hours in {rangeLabel(shownRange)}. Try another range.
      </StatePlaceholder>
    );
  } else {
    body = (
      <div
        role="region"
        aria-label="Team activity table"
        tabIndex={0}
        // @container: the drill-downs size themselves to this visible width (100cqw).
        className="scrollbar-styled @container min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <table
          aria-busy={report.isLoading || report.isRefreshing}
          className="w-full border-separate border-spacing-0 text-sm"
        >
          <thead>
            <tr>
              {COLUMNS.map((column) => {
                const active = sort.column === column.id;
                const direction = active ? (sort.desc ? "desc" : "asc") : false;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : "none"
                    }
                    className={cn(TH, column.numeric ? "w-32 text-right" : "text-left")}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) =>
                          s.column === column.id
                            ? { ...s, desc: !s.desc }
                            : // Numbers read best biggest-first; names A–Z.
                              { column: column.id, desc: Boolean(column.numeric) },
                        )
                      }
                      className={cn(
                        "-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 outline-none transition-colors duration-150 hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring",
                        column.numeric && "flex-row-reverse",
                      )}
                    >
                      {column.header}
                      <SortIcon direction={direction} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          {!data ? (
            <tbody>
              {Array.from({ length: 5 }, (_, i) => (
                <tr key={i}>
                  {COLUMNS.map((column) => (
                    <td key={column.id} className={cn(TD, "py-3")}>
                      <Skeleton
                        className={cn(
                          "h-4 rounded-full motion-reduce:animate-none",
                          column.numeric ? "ml-auto w-14" : "w-36",
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : (
            <motion.tbody
              key={report.fetchedAt?.getTime()}
              initial={{ opacity: reduce ? 1 : 0.35 }}
              animate={{ opacity: report.isRefreshing ? 0.55 : 1 }}
              transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
            >
              {members.map((member) => (
                <MemberRows
                  key={member.user.id}
                  member={member}
                  range={shownRange}
                  open={expanded === member.user.id}
                  onToggle={() =>
                    setExpanded((id) => (id === member.user.id ? null : member.user.id))
                  }
                />
              ))}
            </motion.tbody>
          )}

          {data && (
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className={cn(TD, "border-b-0 bg-muted/60 text-left")}>
                  Team total
                  <span className="text-caption font-normal">
                    {" "}
                    · {data.totals.member_count}{" "}
                    {data.totals.member_count === 1 ? "person" : "people"}
                  </span>
                </th>
                <td className={cn(TD, "border-b-0 bg-muted/60 text-right tabular-nums")}>
                  {duration(data.totals.total_minutes)}
                </td>
                <td className={cn(TD, "border-b-0 bg-muted/60 text-right tabular-nums")}>
                  {duration(data.totals.ams_minutes)}
                </td>
                <td className={cn(TD, "border-b-0 bg-muted/60 text-right tabular-nums")}>
                  {duration(data.totals.non_ams_minutes)}
                </td>
                <td className={cn(TD, "border-b-0 bg-muted/60 text-right tabular-nums")}>
                  {data.totals.entry_count}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <Enter delay={0}>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div className="grid gap-1.5">
            <span id={ids.start} className="text-caption font-medium">
              From
            </span>
            <div className="w-40">
              <DateTimePicker
                mode="date"
                value={range.start}
                onChange={(start) => changeRange({ ...range, start })}
                invalid={Boolean(problem)}
                aria-labelledby={ids.start}
                aria-describedby={problem ? ids.problem : undefined}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <span id={ids.end} className="text-caption font-medium">
              To
            </span>
            <div className="w-40">
              <DateTimePicker
                mode="date"
                value={range.end}
                onChange={(end) => changeRange({ ...range, end })}
                invalid={Boolean(problem)}
                aria-labelledby={ids.end}
                aria-describedby={problem ? ids.problem : undefined}
              />
            </div>
          </div>
          <div role="group" aria-label="Quick ranges" className="flex flex-wrap gap-1.5 pb-0.5">
            {presets.map((preset) => {
              const active = preset.range.start === range.start && preset.range.end === range.end;
              return (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => changeRange(preset.range)}
                  className={cn(
                    "h-8 rounded-full px-3 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto">
            <ExportButton
              path={`/reports/team-activity/export/?${rangeQuery}`}
              fallbackName={`team-activity_${range.start}_${range.end}.csv`}
              disabled={Boolean(problem) || !data || data.totals.entry_count === 0}
            />
          </div>
        </div>
        {problem && (
          <p
            id={ids.problem}
            role="alert"
            className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive"
          >
            <CircleAlert className="size-3.5 shrink-0" aria-hidden />
            {problem}
          </p>
        )}
      </Enter>

      <Enter delay={0.08}>
        <Card className="min-h-80 gap-0 py-0 shadow-elev-1">{body}</Card>
      </Enter>
    </div>
  );
}

// --- One person: their row, and the drill-down under it -------------------------------

function MemberRows({
  member,
  range,
  open,
  onToggle,
}: {
  member: ReportMember;
  range: Range;
  open: boolean;
  onToggle: () => void;
}) {
  const detailId = useId();
  const name = displayName(member.user);
  const empty = member.entry_count === 0;

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer transition-colors duration-150 hover:bg-foreground/5",
          open && "bg-accent/60 hover:bg-accent/80",
          empty && "text-muted-foreground",
        )}
      >
        <td className={TD}>
          {/* The row is clickable; this button makes the same toggle reachable by keyboard. */}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            className="-mx-1 inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-90",
              )}
            />
            <span className="font-semibold">{name}</span>
            <span className="text-caption">@{member.user.username}</span>
            <span className="sr-only">, {open ? "hide" : "show"} entries</span>
          </button>
        </td>
        <td className={cn(TD, "text-right font-semibold tabular-nums")}>
          {duration(member.total_minutes)}
        </td>
        <td className={cn(TD, "text-right tabular-nums")}>{duration(member.ams_minutes)}</td>
        <td className={cn(TD, "text-right tabular-nums")}>{duration(member.non_ams_minutes)}</td>
        <td className={cn(TD, "text-right tabular-nums")}>{member.entry_count}</td>
      </tr>
      <tr>
        {/* Always rendered, so the toggle's aria-controls always has a target. */}
        <td id={detailId} colSpan={COLUMNS.length} className="p-0">
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="detail"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                // Pinned to the visible width of the (sideways-scrolling) table,
                // so on narrow screens its export button and "Open Job Sheet"
                // links aren't off to the right. Sticky here, on the
                // overflow-hidden element itself: sticky doesn't work inside one.
                className="sticky left-0 w-[100cqw] overflow-hidden border-b border-border/60 bg-muted/30"
              >
                <MemberDetail member={member} name={name} range={range} />
              </motion.div>
            )}
          </AnimatePresence>
        </td>
      </tr>
    </>
  );
}

function MemberDetail({
  member,
  name,
  range,
}: {
  member: ReportMember;
  name: string;
  range: Range;
}) {
  const query = new URLSearchParams({
    start_date: range.start,
    end_date: range.end,
    user_id: String(member.user.id),
  });
  const detail = useApiGet<MemberActivityReport>(`/reports/team-activity/?${query}`);

  // Entries arrive in date, then time order: group them by day.
  const days = useMemo(() => {
    const groups: { date: string; entries: WorkLogEntry[] }[] = [];
    for (const entry of detail.data?.entries ?? []) {
      const last = groups.at(-1);
      if (last?.date === entry.date) last.entries.push(entry);
      else groups.push({ date: entry.date, entries: [entry] });
    }
    return groups;
  }, [detail.data]);

  return (
    <div className="grid gap-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-label">
          {name}&apos;s entries · {rangeLabel(range)}
        </p>
        {member.entry_count > 0 && (
          <ExportButton
            path={`/reports/team-activity/export/?${query}`}
            fallbackName={`team-activity_${member.user.username}_${range.start}_${range.end}.csv`}
            label={`Export ${member.user.first_name || name}'s CSV`}
          />
        )}
      </div>

      {detail.error ? (
        <p role="alert" className="text-label">
          Couldn&apos;t load {name}&apos;s entries.{" "}
          <button
            type="button"
            onClick={detail.retry}
            className="font-semibold text-foreground underline underline-offset-4"
          >
            Try again
          </button>
        </p>
      ) : !detail.data ? (
        <div className="grid gap-2.5" role="status" aria-label={`Loading ${name}'s entries`}>
          <Skeleton className="h-5 w-1/3 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-5 w-2/3 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-5 w-1/2 rounded-full motion-reduce:animate-none" />
        </div>
      ) : days.length === 0 ? (
        <p className="text-label flex items-center gap-2 py-2">
          <ClipboardList className="size-4" aria-hidden />
          No work logged in this range.
        </p>
      ) : (
        // Block flow, not grid or flex: a height-capped grid shrinks its rows
        // to fit, and each day group (overflow-hidden, for its rounded
        // corners) may shrink to nothing, clipping every entry. Block layout
        // never squeezes children, so a long range scrolls instead.
        <div className="scrollbar-styled max-h-[28rem] space-y-3 overflow-y-auto pr-1">
          {days.map((day) => {
            const total = day.entries.reduce((sum, e) => sum + entryMinutes(e), 0);
            return (
              <section
                key={day.date}
                aria-label={formatDateLong(day.date)}
                className="overflow-hidden rounded-lg bg-card ring-1 ring-border"
              >
                <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-2">
                  <h4 className="text-sm font-semibold">
                    {formatDateLong(day.date)}
                    <span className="text-caption font-normal tabular-nums">
                      {" "}
                      · {formatMinutes(total)}
                    </span>
                  </h4>
                  <Link
                    href={`/job-sheets?${new URLSearchParams({ user_id: String(member.user.id), date: day.date })}`}
                    className="text-caption rounded-sm font-medium underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Open Job Sheet
                  </Link>
                </header>
                <ul className="divide-y divide-border">
                  {day.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
                    >
                      <CategoryPill category={entry.category} />
                      <span className="shrink-0 text-sm whitespace-nowrap tabular-nums">
                        {formatTimeRange(entry)}
                        <span className="text-muted-foreground" aria-hidden>
                          {" · "}
                        </span>
                        <span className="sr-only">, </span>
                        <span className="font-semibold">{formatMinutes(entryMinutes(entry))}</span>
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 basis-48 truncate text-sm",
                          !entry.is_auto && "text-muted-foreground",
                        )}
                        title={(entry.is_auto ? entry.ticket_reference : entry.note) || undefined}
                      >
                        {entry.is_auto
                          ? entry.ticket_reference
                          : entry.note || <span className="text-caption">No note</span>}
                      </span>
                      {entry.is_auto && (
                        <FromTicketBadge reference={entry.ticket_reference ?? "a ticket"} />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
