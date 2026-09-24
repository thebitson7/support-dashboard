"use client";

import { ChevronUp, SearchX } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "cn";

import { EASE } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { TicketsTable } from "@/components/tickets/tickets-table-config";

// Width and alignment per column id. Minimum widths keep every column legible
// (the container scrolls horizontally instead of squeezing them).
const COLUMN_STYLE: Record<string, { width: string; align?: "right" | "center" }> = {
  siteName: { width: "min-w-[17rem]" },
  siteOcn: { width: "min-w-[10rem]" },
  cmsTicketNo: { width: "min-w-[11.5rem]" },
  receivedAt: { width: "min-w-[13.5rem]" },
  status: { width: "min-w-[7.5rem]" },
  pre: { width: "min-w-[4.5rem]", align: "center" },
  closedBy: { width: "min-w-[10rem]" },
  createdBy: { width: "min-w-[9rem]" },
  durationHours: { width: "min-w-[12.5rem]", align: "right" },
  cmsClosedOn: { width: "min-w-[12.5rem]" },
  serviceClosedDate: { width: "min-w-[11.5rem]" },
};

// Placeholder bar widths for the loading skeleton.
const SKELETON_WIDTH: Record<string, string> = {
  siteName: "w-44",
  siteOcn: "w-28",
  cmsTicketNo: "w-32",
  receivedAt: "w-32",
  status: "w-16",
  pre: "w-5",
  closedBy: "w-20",
  createdBy: "w-20",
  durationHours: "w-12",
  cmsClosedOn: "w-32",
  serviceClosedDate: "w-32",
};

const alignClass = (align?: "right" | "center") =>
  align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

/** A chevron that flips (asc = up, desc = down) with a quick eased rotation. */
function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      initial={false}
      animate={{ rotate: direction === "desc" ? 180 : 0, opacity: direction ? 1 : 0.35 }}
      transition={{ duration: reduce ? 0 : 0.18, ease: EASE }}
      className="flex"
    >
      <ChevronUp className="size-4" strokeWidth={2} />
    </motion.span>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <SearchX className="size-7" strokeWidth={2} />
      </span>
      <div className="grid gap-1">
        <p className="text-title">No tickets match your search</p>
        <p className="text-label">Try a different keyword, or clear your filters.</p>
      </div>
      <Button variant="outline" onClick={onClear}>
        Clear search
      </Button>
    </div>
  );
}

export function TicketsTableView({
  table,
  loading,
  reveal,
  onClear,
}: {
  table: TicketsTable;
  loading: boolean;
  /** Rows rise in (tight, capped stagger) the first time they appear. */
  reveal: boolean;
  onClear: () => void;
}) {
  const reduce = useReducedMotion();
  const rows = table.getRowModel().rows;
  const { sorting, pagination, globalFilter, columnFilters } = table.state;
  // Changing any of these swaps the visible rows, so the body cross-fades.
  const bodyKey = JSON.stringify([pagination, sorting, globalFilter, columnFilters]);

  if (!loading && rows.length === 0) return <EmptyState onClear={onClear} />;

  const leafColumns = table.getAllLeafColumns();

  return (
    // A focusable, labelled region so keyboard users can scroll the table.
    <div
      role="region"
      aria-label="AMS tickets table"
      tabIndex={0}
      className="scrollbar-styled min-h-80 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <table
        aria-busy={loading}
        className="w-full min-w-max border-separate border-spacing-0 text-sm"
      >
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const style = COLUMN_STYLE[header.column.id];
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                    }
                    className={cn(
                      "sticky top-0 z-10 border-b border-border bg-muted px-4 py-2 text-[13px] font-semibold whitespace-nowrap text-foreground",
                      style?.width,
                      alignClass(style?.align),
                    )}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 outline-none transition-colors duration-150 hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring",
                          style?.align === "right" && "flex-row-reverse",
                        )}
                      >
                        <table.FlexRender header={header} />
                        <SortIcon direction={sorted} />
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        {loading ? (
          <tbody>
            {Array.from({ length: 12 }).map((_, index) => (
              <tr key={index}>
                {leafColumns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      "border-b border-border/60 px-4 py-3",
                      alignClass(COLUMN_STYLE[column.id]?.align),
                    )}
                  >
                    <Skeleton
                      className={cn(
                        "h-4 rounded-full motion-reduce:animate-none",
                        SKELETON_WIDTH[column.id],
                        COLUMN_STYLE[column.id]?.align === "right" && "ml-auto",
                        COLUMN_STYLE[column.id]?.align === "center" && "mx-auto",
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : (
          // A new page/sort/filter fades up from a soft 35% instead of
          // fading out first, which would leave the body blank while the
          // new rows render.
          <motion.tbody
            key={bodyKey}
            initial={{ opacity: reduce ? 1 : 0.35 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
          >
            {rows.map((row, index) => {
              const open = row.original.status === "Open";
              return (
                <tr
                  key={row.id}
                  data-status={row.original.status}
                  className={cn(
                    "transition-colors duration-150",
                    open
                      ? "bg-[color-mix(in_oklab,var(--status-open)_18%,transparent)] hover:bg-[color-mix(in_oklab,var(--status-open)_27%,transparent)] dark:bg-[color-mix(in_oklab,var(--status-open)_20%,transparent)] dark:hover:bg-[color-mix(in_oklab,var(--status-open)_28%,transparent)]"
                      : "hover:bg-foreground/5",
                    reveal && "row-enter",
                  )}
                  // Capped so even a 200-row page finishes appearing in ~0.5s.
                  style={reveal ? { animationDelay: `${Math.min(index * 10, 240)}ms` } : undefined}
                >
                  {row.getAllCells().map((cell, cellIndex) => {
                    const style = COLUMN_STYLE[cell.column.id];
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "border-b border-border/60 px-4 py-2.5 whitespace-nowrap",
                          alignClass(style?.align),
                          // Open rows get a 4px left-edge accent bar.
                          cellIndex === 0 && open && "shadow-[inset_4px_0_0_var(--status-open)]",
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </motion.tbody>
        )}
      </table>
    </div>
  );
}
