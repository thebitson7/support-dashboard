"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";

import type { ComboOption } from "@/components/common/search-combobox";
import type { TicketStatus } from "@/types/tickets";
import { EASE } from "@/lib/motion";
import {
  ticketExportPath,
  ticketListPath,
  toAmsTicket,
  type TicketListQuery,
  type TicketListResponse,
} from "@/lib/tickets-api";
import { useApiGet } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExportButton } from "@/components/common/export-button";
import { Toaster } from "@/components/ui/sonner";
import { TicketDialog } from "@/components/tickets/ticket-form/ticket-dialog";
import { TicketsPagination } from "@/components/tickets/tickets-pagination";
import { TicketsTableView, type TicketsEmptyKind } from "@/components/tickets/tickets-table";
import {
  DEFAULT_VIEW,
  useTicketsTable,
  type TicketsViewState,
} from "@/components/tickets/tickets-table-config";
import { TicketsToolbar } from "@/components/tickets/tickets-toolbar";

const SEARCH_DEBOUNCE_MS = 250;
const REVEAL_MS = 1000;

/** Fades/slides a page section in once on mount. `delay` staggers the sections. */
function Enter({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** The table's view state -> the API query for it. */
function viewQuery(view: TicketsViewState): TicketListQuery {
  const filter = (id: string) => view.columnFilters.find((f) => f.id === id)?.value;
  return {
    pageIndex: view.pagination.pageIndex,
    pageSize: view.pagination.pageSize,
    sort: view.sorting[0],
    search: view.globalFilter,
    status: filter("status") as TicketStatus | undefined,
    siteId: (filter("siteName") as ComboOption | undefined)?.value,
    receivedRange: filter("receivedAt") as [number, number] | undefined,
  };
}

/**
 * The AMS Tickets table with its search, filters and paging. `readOnly` is
 * the Reports page's version: no page header or New Ticket, no Edit column
 * or ticket dialog, and an Export CSV of the current view instead (the page
 * around it supplies the title and the toast container).
 */
export function TicketsPage({ readOnly = false }: { readOnly?: boolean }) {
  const reduceMotion = useReducedMotion();
  const [view, setView] = useState<TicketsViewState>(DEFAULT_VIEW);
  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // One dialog for both flows: no ticketId = create, a ticketId = edit.
  const [dialog, setDialog] = useState<{ open: boolean; key: number; ticketId?: number }>({
    open: false,
    key: 0,
  });

  const list = useApiGet<TicketListResponse>(ticketListPath(viewQuery(view)), {
    keepPreviousData: true,
  });
  const rows = useMemo(() => list.data?.results.map(toAmsTicket) ?? [], [list.data]);
  const table = useTicketsTable(rows, list.data?.count ?? 0, view, setView);

  // Rows rise in once, the first time any arrive.
  const [reveal, setReveal] = useState(false);
  const revealed = useRef(false);
  useEffect(() => {
    if (!list.data || revealed.current) return;
    revealed.current = true;
    if (reduceMotion) return;
    const start = setTimeout(() => setReveal(true), 0);
    const stop = setTimeout(() => setReveal(false), REVEAL_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [list.data, reduceMotion]);

  // Debounced search: typing updates `query`; the request follows it.
  useEffect(() => {
    if (query === view.globalFilter) return;
    const id = setTimeout(() => table.setGlobalFilter(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, view.globalFilter, table]);

  // A page that no longer exists (e.g. rows removed since) answers 404: go
  // back to the first page rather than showing an error.
  const outOfRange = list.error?.status === 404 && view.pagination.pageIndex > 0;
  useEffect(() => {
    if (outOfRange) table.setPageIndex(0);
  }, [outOfRange, table]);

  const clearAll = () => {
    setQuery("");
    setView((v) => ({
      ...v,
      globalFilter: "",
      columnFilters: [],
      pagination: { ...v.pagination, pageIndex: 0 },
    }));
  };

  const openNewTicket = () => setDialog((d) => ({ open: true, key: d.key + 1 }));
  const openEditTicket = (id: string) =>
    setDialog((d) => ({ open: true, key: d.key + 1, ticketId: Number(id) }));

  // After creating a ticket: back to the default "newest first" view with no
  // search or filters, so the new ticket is at (or near) the top, and refetch.
  const showCreated = () => {
    setQuery("");
    setView((v) => ({
      ...DEFAULT_VIEW,
      pagination: { ...DEFAULT_VIEW.pagination, pageSize: v.pagination.pageSize },
    }));
    list.retry();
  };

  const data = list.data;
  const empty: TicketsEmptyKind | null =
    data && data.count === 0 ? (data.total === 0 ? "no-tickets" : "no-matches") : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-[34rem] w-full flex-1 flex-col gap-5">
        {!readOnly && (
          <Enter delay={0}>
            <div className="grid gap-3">
              <nav aria-label="Breadcrumb">
                <ol className="text-label flex items-center gap-1.5">
                  <li>
                    <Link
                      href="/"
                      className="rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      Home
                    </Link>
                  </li>
                  <li aria-hidden className="flex">
                    <ChevronRight className="size-4" strokeWidth={2} />
                  </li>
                  <li aria-current="page" className="font-semibold text-foreground">
                    AMS Tickets
                  </li>
                </ol>
              </nav>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-extrabold tracking-tight">AMS Tickets</h1>
                {/* The page's primary action: full-size, brand orange, a lift on
                  hover and a press-in on click (same feel as the cards). */}
                <motion.div
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.16, ease: EASE }}
                >
                  <Button
                    size="lg"
                    onClick={openNewTicket}
                    className="h-10 gap-2 rounded-full px-5 font-semibold shadow-elev-1 transition-shadow duration-200 hover:bg-primary hover:shadow-elev-hover"
                  >
                    <Plus className="size-4.5" strokeWidth={2.5} aria-hidden />
                    New Ticket
                  </Button>
                </motion.div>
              </div>
            </div>
          </Enter>
        )}

        <Enter delay={readOnly ? 0 : 0.08}>
          <TicketsToolbar
            table={table}
            query={query}
            onQueryChange={setQuery}
            advancedOpen={advancedOpen}
            onAdvancedChange={setAdvancedOpen}
            onClearAll={clearAll}
            actions={
              readOnly && (
                <ExportButton
                  // The table's current sort, search and filters; every row.
                  path={ticketExportPath(viewQuery(view))}
                  fallbackName="tickets.csv"
                  disabled={!data || data.count === 0}
                />
              )
            }
          />
        </Enter>

        <Enter delay={readOnly ? 0.08 : 0.16} className="flex min-h-0 flex-1 flex-col">
          <Card className="min-h-0 flex-1 gap-0 py-0 shadow-elev-1">
            <TicketsTableView
              table={table}
              loading={list.isLoading}
              refreshing={list.isRefreshing}
              dataVersion={list.fetchedAt?.getTime() ?? 0}
              reveal={reveal}
              empty={empty}
              error={outOfRange ? undefined : list.error}
              onClear={clearAll}
              onRetry={list.retry}
              onCreate={readOnly ? undefined : openNewTicket}
              onEdit={readOnly ? undefined : openEditTicket}
            />
            {data && data.total > 0 && !list.error && (
              <TicketsPagination table={table} totalRows={data.total} />
            )}
          </Card>
        </Enter>
      </div>

      {!readOnly && (
        <TicketDialog
          key={dialog.key}
          open={dialog.open}
          ticketId={dialog.ticketId}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          // A new ticket: jump to the default view so it's visible. An edit:
          // refetch the current page in place, so e.g. a just-closed ticket
          // shows as Closed straight away.
          onSaved={dialog.ticketId === undefined ? showCreated : list.retry}
        />
      )}
      {!readOnly && <Toaster position="bottom-right" />}
    </MotionConfig>
  );
}
