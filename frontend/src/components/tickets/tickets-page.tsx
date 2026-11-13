"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";

import { PageHeader, PrimaryAction } from "@/components/layout/page-header";
import type { ComboOption } from "@/components/common/search-combobox";
import type { TicketStatus } from "@/types/tickets";
import type { ApiError } from "@/lib/api";
import { parseTicketDeepLink, type TicketDeepLink } from "@/lib/attention";
import { EASE } from "@/lib/motion";
import {
  ticketExportPath,
  ticketListPath,
  toAmsTicket,
  type TicketListQuery,
  type TicketListResponse,
} from "@/lib/tickets-api";
import { useApiGet } from "@/hooks/use-api";
import { Card } from "@/components/ui/card";
import { ExportButton } from "@/components/common/export-button";
import { TicketsPagination } from "@/components/tickets/tickets-pagination";
import { TicketsTableView, type TicketsEmptyKind } from "@/components/tickets/tickets-table";
import {
  DEFAULT_VIEW,
  useTicketsTable,
  type TicketsViewState,
} from "@/components/tickets/tickets-table-config";
import { TicketsToolbar } from "@/components/tickets/tickets-toolbar";
import type { TabId } from "@/components/tickets/ticket-form/form-model";
import { useUrgentTickets } from "@/components/attention/urgent-tickets-provider";

const SEARCH_DEBOUNCE_MS = 250;

// The New / Edit dialog is the biggest piece of this page (~33 KB gzipped)
// and only needed on demand: it's split out, so the read-only Reports view
// never downloads it, and the editable page fetches it in the background
// once the table is up (see the preload below), so opening it stays instant.
const loadTicketDialog = () =>
  import("@/components/tickets/ticket-form/ticket-dialog").then((m) => m.TicketDialog);
const TicketDialog = dynamic(loadTicketDialog, { ssr: false });
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
 * The editable AMS Tickets page, reading the deep link
 * `?edit=<id>&tab=<tab>` (e.g. from "Close ticket" in the attention alert):
 * it opens that ticket's edit dialog on that tab, and closing the dialog
 * removes the params. The read-only Reports table never reads the URL.
 */
export function EditableTicketsPage() {
  // useSearchParams needs a Suspense boundary (as on Job Sheets).
  return (
    <Suspense fallback={null}>
      <TicketsPageFromUrl />
    </Suspense>
  );
}

function TicketsPageFromUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const deepLink = parseTicketDeepLink(params);
  const hasParams = params.has("edit") || params.has("tab");
  const clear = useCallback(() => router.replace(pathname, { scroll: false }), [router, pathname]);
  // A malformed link (e.g. ?edit=abc) opens nothing; just tidy the URL.
  useEffect(() => {
    if (hasParams && !deepLink) clear();
  }, [hasParams, deepLink, clear]);
  return <TicketsPage deepLink={deepLink} onDeepLinkDone={clear} />;
}

type DialogState = {
  open: boolean;
  key: number;
  ticketId?: number;
  initialTab?: TabId;
  /** Opened from the URL: closing it clears the params. */
  fromLink?: boolean;
};

/**
 * The AMS Tickets table with its search, filters and paging. `readOnly` is
 * the Reports page's version: no page header or New Ticket, no Edit column
 * or ticket dialog, and an Export CSV of the current view instead (the page
 * around it supplies the title and the toast container).
 */
export function TicketsPage({
  readOnly = false,
  deepLink = null,
  onDeepLinkDone,
}: {
  readOnly?: boolean;
  /** Editable page only: a ticket to open from the URL (see EditableTicketsPage). */
  deepLink?: TicketDeepLink | null;
  onDeepLinkDone?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const urgent = useUrgentTickets();
  const [view, setView] = useState<TicketsViewState>(DEFAULT_VIEW);
  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // One dialog for both flows: no ticketId = create, a ticketId = edit.
  const [dialog, setDialog] = useState<DialogState>({ open: false, key: 0 });

  // Open the linked ticket once per distinct link (adjusting state during
  // render, React's pattern for "respond to a prop change").
  const linkKey = !readOnly && deepLink ? `${deepLink.ticketId}:${deepLink.tab ?? ""}` : null;
  const [seenLink, setSeenLink] = useState<string | null>(null);
  if (linkKey !== seenLink) {
    setSeenLink(linkKey);
    if (deepLink && linkKey) {
      setDialog((d) => ({
        open: true,
        key: d.key + 1,
        ticketId: deepLink.ticketId,
        initialTab: deepLink.tab,
        fromLink: true,
      }));
    }
  }

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

  // Editable page: warm the dialog's chunk once the first rows are in.
  const hasData = Boolean(list.data);
  useEffect(() => {
    if (!readOnly && hasData) void loadTicketDialog();
  }, [readOnly, hasData]);

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

  const closeDialog = () => {
    setDialog((d) => ({ ...d, open: false }));
    if (dialog.fromLink) onDeepLinkDone?.();
  };
  const linkedTicketFailed = useCallback(
    (error: ApiError) => {
      toast.error(
        error.status === 404
          ? "That ticket wasn't found."
          : "Couldn't open that ticket. Try again.",
      );
      setDialog((d) => ({ ...d, open: false }));
      onDeepLinkDone?.();
    },
    [onDeepLinkDone],
  );

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
            <PageHeader
              trail={[{ label: "AMS Tickets" }]}
              title="AMS Tickets"
              description="Every support ticket, with its activities and verification."
              actions={<PrimaryAction onClick={openNewTicket}>New ticket</PrimaryAction>}
            />
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
          initialTab={dialog.initialTab}
          onOpenChange={(open) => (open ? setDialog((d) => ({ ...d, open })) : closeDialog())}
          // A new ticket: jump to the default view so it's visible. An edit:
          // refetch the current page in place, so e.g. a just-closed ticket
          // shows as Closed straight away. Either way the attention data
          // (badge, Home box) is refreshed.
          onSaved={() => {
            if (dialog.ticketId === undefined) showCreated();
            else list.retry();
            urgent.refresh();
          }}
          onLoadError={dialog.fromLink ? linkedTicketFailed : undefined}
        />
      )}
    </MotionConfig>
  );
}
