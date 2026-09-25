"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAGE_SIZES, type TicketsTable } from "@/components/tickets/tickets-table-config";

const fmt = (n: number) => n.toLocaleString("en-US");

/** 0-based page indexes with "…" gaps: first, last, and a window around the current page. */
function pageItems(current: number, count: number): (number | "gap-start" | "gap-end")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const items: (number | "gap-start" | "gap-end")[] = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(count - 2, current + 1);
  if (start > 1) items.push("gap-start");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < count - 2) items.push("gap-end");
  items.push(count - 1);
  return items;
}

export function TicketsPagination({
  table,
  totalRows,
}: {
  table: TicketsTable;
  /** Row count before any search or filter, for the "filtered from" note. */
  totalRows: number;
}) {
  const { pageIndex, pageSize } = table.state.pagination;
  // Server-side: the API reports how many rows match the current query.
  const matching = table.getRowCount();
  const pageCount = table.getPageCount();
  const first = matching === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, matching);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border bg-card px-4 py-3">
      <p className="text-label" aria-live="polite">
        Showing{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {fmt(first)}–{fmt(last)}
        </span>{" "}
        of <span className="font-semibold text-foreground tabular-nums">{fmt(matching)}</span>{" "}
        tickets
        {matching !== totalRows && (
          <span className="text-muted-foreground"> (filtered from {fmt(totalRows)})</span>
        )}
      </p>

      <nav aria-label="Pagination" className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="First page"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.firstPage()}
        >
          <ChevronsLeft strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous page"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          <ChevronLeft strokeWidth={2} />
        </Button>

        {pageItems(pageIndex, pageCount).map((item) =>
          typeof item === "number" ? (
            <Button
              key={item}
              variant={item === pageIndex ? "default" : "ghost"}
              size="icon"
              aria-label={`Page ${item + 1}`}
              aria-current={item === pageIndex ? "page" : undefined}
              onClick={() => table.setPageIndex(item)}
              className={cn(
                "w-auto min-w-8 px-2 tabular-nums transition-colors duration-150",
                item === pageIndex && "font-bold",
              )}
            >
              {item + 1}
            </Button>
          ) : (
            <span
              key={item}
              aria-hidden
              className="grid h-8 min-w-6 place-items-center text-muted-foreground"
            >
              …
            </span>
          ),
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Next page"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          <ChevronRight strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Last page"
          disabled={!table.getCanNextPage()}
          onClick={() => table.lastPage()}
        >
          <ChevronsRight strokeWidth={2} />
        </Button>
      </nav>

      <div className="flex items-center gap-2">
        <span className="text-label">Items per page</span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => value && table.setPageSize(Number(value))}
        >
          <SelectTrigger size="default" aria-label="Items per page" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
