"use client";

import {
  columnFilteringFeature,
  createColumnHelper,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";

import type { AmsTicket } from "@/types/tickets";
import {
  DateTimeCell,
  DurationCell,
  PreCell,
  StatusCell,
  TextCell,
} from "@/components/tickets/cells";

// --- Features ------------------------------------------------------------------
// Server-side table: the API sorts, filters and paginates, so no client row
// models are needed. The features remain for their state + column APIs
// (sort toggles, filter values, page navigation).

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
});

// --- Columns: exactly the real system's 11, in order -------------------------

const helper = createColumnHelper<typeof features, AmsTicket>();

export const columns = helper.columns([
  helper.accessor("siteName", {
    header: "Site Name",
    cell: (ctx) => <TextCell value={ctx.getValue()} strong />,
  }),
  helper.accessor("siteOcn", {
    header: "Site OCN",
    cell: (ctx) => <TextCell value={ctx.getValue()} mono />,
  }),
  helper.accessor("cmsTicketNo", {
    header: "CMS Next Ticket No",
    cell: (ctx) => <TextCell value={ctx.getValue()} mono />,
  }),
  helper.accessor("receivedAt", {
    header: "Ticket Received Date Time",
    sortDescFirst: true,
    cell: (ctx) => <DateTimeCell value={ctx.getValue()} />,
  }),
  helper.accessor("status", {
    header: "Status",
    cell: (ctx) => <StatusCell status={ctx.getValue()} />,
  }),
  helper.accessor("pre", {
    header: "Pre",
    enableSorting: false,
    cell: (ctx) => <PreCell checked={ctx.getValue()} />,
  }),
  helper.accessor((row) => row.closedBy ?? undefined, {
    id: "closedBy",
    header: "Ticket Closed By",
    cell: (ctx) => <TextCell value={ctx.getValue()} />,
  }),
  helper.accessor("createdBy", {
    header: "Created By",
    cell: (ctx) => <TextCell value={ctx.getValue()} />,
  }),
  helper.accessor("durationHours", {
    header: "Total Duration (Hours)",
    sortDescFirst: true,
    cell: (ctx) => <DurationCell value={ctx.getValue()} />,
  }),
  helper.accessor((row) => row.cmsClosedOn ?? undefined, {
    id: "cmsClosedOn",
    header: "CMS Ticket Closed On",
    sortDescFirst: true,
    cell: (ctx) => <DateTimeCell value={ctx.getValue()} />,
  }),
  helper.accessor((row) => row.serviceClosedDate ?? undefined, {
    id: "serviceClosedDate",
    header: "Service Closed Date",
    sortDescFirst: true,
    cell: (ctx) => <DateTimeCell value={ctx.getValue()} />,
  }),
]);

export const PAGE_SIZES = [25, 50, 100, 200] as const;

// --- State (owned by the page, since it drives the API request) ---------------

export type TicketsViewState = {
  sorting: SortingState;
  pagination: PaginationState;
  globalFilter: string;
  columnFilters: ColumnFiltersState;
};

export const DEFAULT_VIEW: TicketsViewState = {
  // Newest ticket first.
  sorting: [{ id: "receivedAt", desc: true }],
  pagination: { pageIndex: 0, pageSize: 50 },
  globalFilter: "",
  columnFilters: [],
};

const resolve = <T,>(updater: Updater<T>, previous: T): T =>
  typeof updater === "function" ? (updater as (old: T) => T)(previous) : updater;

export function useTicketsTable(
  data: AmsTicket[],
  rowCount: number,
  view: TicketsViewState,
  setView: (update: (previous: TicketsViewState) => TicketsViewState) => void,
) {
  // Any change to what's being asked for starts again from the first page
  // (manual pagination has no automatic page reset).
  const firstPage = (v: TicketsViewState) => ({
    ...v.pagination,
    pageIndex: 0,
  });

  return useTable(
    {
      features,
      columns,
      data,
      rowCount,
      manualPagination: true,
      manualSorting: true,
      manualFiltering: true,
      state: view,
      onSortingChange: (u) =>
        setView((v) => ({ ...v, sorting: resolve(u, v.sorting), pagination: firstPage(v) })),
      onGlobalFilterChange: (u) =>
        setView((v) => ({
          ...v,
          globalFilter: resolve(u, v.globalFilter) ?? "",
          pagination: firstPage(v),
        })),
      onColumnFiltersChange: (u) =>
        setView((v) => ({
          ...v,
          columnFilters: resolve(u, v.columnFilters),
          pagination: firstPage(v),
        })),
      onPaginationChange: (u) => setView((v) => ({ ...v, pagination: resolve(u, v.pagination) })),
      // Stable per record, so row identity survives page/sort changes.
      getRowId: (row) => row.id,
      // Header clicks flip asc <-> desc instead of cycling through "unsorted".
      enableSortingRemoval: false,
    },
    (state) => ({
      sorting: state.sorting,
      pagination: state.pagination,
      globalFilter: state.globalFilter,
      columnFilters: state.columnFilters,
    }),
  );
}

export type TicketsTable = ReturnType<typeof useTicketsTable>;
