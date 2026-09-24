"use client";

import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_betweenInclusive,
  filterFn_equalsString,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

import type { AmsTicket } from "@/types/tickets";
import {
  DateTimeCell,
  DurationCell,
  PreCell,
  StatusCell,
  TextCell,
} from "@/components/tickets/cells";

// --- Features: only what the table uses -------------------------------------

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    equalsString: filterFn_equalsString,
    betweenInclusive: filterFn_betweenInclusive,
  },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
  },
});

// --- Columns: exactly the real system's 11, in order -------------------------

const helper = createColumnHelper<typeof features, AmsTicket>();

export const columns = helper.columns([
  helper.accessor("siteName", {
    header: "Site Name",
    sortFn: "alphanumeric",
    filterFn: "equalsString",
    cell: (ctx) => <TextCell value={ctx.getValue()} strong />,
  }),
  helper.accessor("siteOcn", {
    header: "Site OCN",
    sortFn: "alphanumeric",
    cell: (ctx) => <TextCell value={ctx.getValue()} mono />,
  }),
  helper.accessor("cmsTicketNo", {
    header: "CMS Next Ticket No",
    sortFn: "alphanumeric",
    cell: (ctx) => <TextCell value={ctx.getValue()} mono />,
  }),
  helper.accessor("receivedAt", {
    header: "Ticket Received Date Time",
    sortFn: "basic",
    sortDescFirst: true,
    filterFn: "betweenInclusive",
    enableGlobalFilter: false,
    cell: (ctx) => <DateTimeCell value={ctx.getValue()} />,
  }),
  helper.accessor("status", {
    header: "Status",
    sortFn: "alphanumeric",
    filterFn: "equalsString",
    cell: (ctx) => <StatusCell status={ctx.getValue()} />,
  }),
  helper.accessor("pre", {
    header: "Pre",
    enableSorting: false,
    enableGlobalFilter: false,
    cell: (ctx) => <PreCell checked={ctx.getValue()} />,
  }),
  helper.accessor((row) => row.closedBy ?? undefined, {
    id: "closedBy",
    header: "Ticket Closed By",
    sortFn: "alphanumeric",
    sortUndefined: "last",
    cell: (ctx) => <TextCell value={ctx.getValue()} />,
  }),
  helper.accessor("createdBy", {
    header: "Created By",
    sortFn: "alphanumeric",
    cell: (ctx) => <TextCell value={ctx.getValue()} />,
  }),
  helper.accessor("durationHours", {
    header: "Total Duration (Hours)",
    sortFn: "basic",
    sortDescFirst: true,
    enableGlobalFilter: false,
    cell: (ctx) => <DurationCell value={ctx.getValue()} />,
  }),
  helper.accessor((row) => row.cmsClosedOn ?? undefined, {
    id: "cmsClosedOn",
    header: "CMS Ticket Closed On",
    sortFn: "basic",
    sortDescFirst: true,
    sortUndefined: "last",
    enableGlobalFilter: false,
    cell: (ctx) => <DateTimeCell value={ctx.getValue()} />,
  }),
  helper.accessor((row) => row.serviceClosedDate ?? undefined, {
    id: "serviceClosedDate",
    header: "Service Closed Date",
    sortFn: "basic",
    sortDescFirst: true,
    sortUndefined: "last",
    enableGlobalFilter: false,
    cell: (ctx) => <DateTimeCell value={ctx.getValue()} />,
  }),
]);

/** The text columns the search box scans. */
const SEARCHABLE = new Set([
  "siteName",
  "siteOcn",
  "cmsTicketNo",
  "status",
  "closedBy",
  "createdBy",
]);

export const PAGE_SIZES = [25, 50, 100, 200] as const;

// Module-level so their identity is stable across renders (the table treats
// changed option objects as new input and would recompute its row models).
const INITIAL_STATE = {
  // Newest ticket first.
  sorting: [{ id: "receivedAt", desc: true }],
  pagination: { pageIndex: 0, pageSize: 50 },
};

// The default only samples the first row, which would wrongly drop
// "Ticket Closed By" (the newest rows are Open, so it starts empty).
const canGlobalFilter = (column: { id: string }) => SEARCHABLE.has(column.id);

export function useTicketsTable(data: AmsTicket[]) {
  return useTable(
    {
      features,
      columns,
      data,
      initialState: INITIAL_STATE,
      // Stable per record, so row identity survives sorting/filtering.
      getRowId: (row) => row.id,
      // Header clicks flip asc <-> desc instead of cycling through "unsorted".
      enableSortingRemoval: false,
      globalFilterFn: "includesString",
      getColumnCanGlobalFilter: canGlobalFilter,
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
