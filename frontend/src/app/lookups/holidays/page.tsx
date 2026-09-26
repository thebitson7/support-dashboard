"use client";

import { CalendarDays } from "lucide-react";

import { formatDateDisplay } from "@/lib/local-datetime";
import { FlagCell, TextCell } from "@/components/tickets/cells";
import { LookupPage } from "@/components/lookups/lookup-page";
import { COUNTRY_OPTIONS, CountryCell } from "@/components/lookups/shared";
import type { LookupConfig } from "@/components/lookups/types";

type HolidayRow = {
  id: number;
  name: string;
  /** "YYYY-MM-DD"; for recurring holidays only the month/day matter. */
  date: string;
  is_recurring_annually: boolean;
  country: number | null;
  country_name: string | null;
  country_code: string | null;
};

/** "25 Dec · every year" for recurring holidays (their year is ignored), else "20 Mar 2026". */
function HolidayDate({ row }: { row: HolidayRow }) {
  if (!row.is_recurring_annually) {
    return <span className="tabular-nums">{formatDateDisplay(row.date)}</span>;
  }
  return (
    <span className="tabular-nums">
      {formatDateDisplay(row.date, { withYear: false })}
      <span className="text-caption"> · every year</span>
    </span>
  );
}

const config: LookupConfig<HolidayRow> = {
  title: "Holidays",
  description: "Public and company holidays, per country or company-wide.",
  noun: "holiday",
  nounPlural: "holidays",
  endpoint: "/lookups/holidays/",
  searchPlaceholder: "Search by name or country…",
  emptyIcon: CalendarDays,
  columns: [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      cell: (r) => <TextCell value={r.name} strong />,
    },
    // Calendar order (month, day), so yearly holidays sort by when they fall.
    { id: "date", header: "Date", sortKey: "month,day", cell: (r) => <HolidayDate row={r} /> },
    {
      id: "country",
      header: "Country",
      sortKey: "country__name",
      cell: (r) => (
        <CountryCell name={r.country_name} code={r.country_code} globalLabel="All countries" />
      ),
    },
    {
      id: "recurring",
      header: "Recurring Annually",
      sortKey: "is_recurring_annually",
      align: "center",
      className: "w-44",
      cell: (r) => <FlagCell checked={r.is_recurring_annually} label="Recurring annually" />,
    },
  ],
  defaultSort: { column: "date" },
  fields: [
    {
      kind: "text",
      name: "name",
      label: "Holiday name",
      required: true,
      maxLength: 150,
      wide: true,
    },
    {
      kind: "date",
      name: "date",
      label: "Date",
      required: true,
      hint: (v) =>
        v.is_recurring_annually
          ? "Only the day and month are used; the year is ignored."
          : "This exact date only.",
    },
    {
      kind: "select",
      name: "country",
      label: "Country",
      source: COUNTRY_OPTIONS,
      noneLabel: "Global (all countries)",
    },
    {
      kind: "switch",
      name: "is_recurring_annually",
      label: "Recurs annually",
      defaultValue: true,
      wide: true,
      hint: "Falls on the same day and month every year (e.g. New Year's Day). Turn off for holidays that move each year, such as Eid or Lunar New Year, and add them once per year.",
    },
  ],
  rowLabel: (r) => r.name,
};

export default function HolidaysPage() {
  return <LookupPage config={config} />;
}
