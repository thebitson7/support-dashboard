"use client";

import type { ReactNode } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "cn";

import { EASE } from "@/lib/motion";
import { SITE_NAMES } from "@/lib/mock-tickets";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TicketsTable } from "@/components/tickets/tickets-table-config";

const DAY_MS = 86_400_000;
const ALL_STATUSES = "All";
const ALL_SITES = "All sites";
const SORTED_SITES = [...SITE_NAMES].sort((a, b) => a.localeCompare(b));

type DateRange = [number, number];

/** epoch ms -> "YYYY-MM-DD" for <input type="date"> (UTC, matching the table). */
function toInputDate(ms: number) {
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
}

/** "YYYY-MM-DD" -> epoch ms at the start of that UTC day. */
function fromInputDate(value: string) {
  return value ? Date.parse(`${value}T00:00:00Z`) : NaN;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-caption font-medium">{label}</span>
      {children}
    </div>
  );
}

export function TicketsToolbar({
  table,
  query,
  onQueryChange,
  advancedOpen,
  onAdvancedChange,
  onClearAll,
}: {
  table: TicketsTable;
  query: string;
  onQueryChange: (value: string) => void;
  advancedOpen: boolean;
  onAdvancedChange: (open: boolean) => void;
  onClearAll: () => void;
}) {
  const status = table.getColumn("status");
  const site = table.getColumn("siteName");
  const received = table.getColumn("receivedAt");

  const statusValue = (status?.getFilterValue() as string | undefined) ?? ALL_STATUSES;
  const siteValue = (site?.getFilterValue() as string | undefined) ?? ALL_SITES;
  const range = received?.getFilterValue() as DateRange | undefined;
  const from = range ? toInputDate(range[0]) : "";
  const to = range ? toInputDate(range[1]) : "";
  const activeFilters = table.state.columnFilters.length;

  // Both ends are inclusive whole days. An open end is +/-Infinity.
  const setRange = (nextFrom: string, nextTo: string) => {
    const start = fromInputDate(nextFrom);
    const end = fromInputDate(nextTo);
    if (Number.isNaN(start) && Number.isNaN(end)) {
      received?.setFilterValue(undefined);
      return;
    }
    received?.setFilterValue([
      Number.isNaN(start) ? -Infinity : start,
      Number.isNaN(end) ? Infinity : end + DAY_MS - 1,
    ] satisfies DateRange);
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="relative w-full max-w-md flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search tickets..."
            aria-label="Search tickets"
            spellCheck={false}
            className="h-10 bg-card pl-9 shadow-elev-1"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium select-none">
          <Checkbox
            aria-label="Advanced Search"
            checked={advancedOpen}
            onCheckedChange={(checked) => onAdvancedChange(checked === true)}
            aria-controls="advanced-search-panel"
          />
          <SlidersHorizontal className="size-4 text-muted-foreground" strokeWidth={2} />
          Advanced Search
          {activeFilters > 0 && (
            <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums">
              {activeFilters}
            </span>
          )}
        </label>
      </div>

      <AnimatePresence initial={false}>
        {advancedOpen && (
          <motion.div
            id="advanced-search-panel"
            key="advanced"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            {/* padding lives inside so the shadow isn't clipped by the height animation */}
            <div className="p-1">
              <div className="grid gap-4 rounded-xl bg-card p-4 shadow-elev-1 ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
                <Field label="Status">
                  <Select
                    value={statusValue}
                    onValueChange={(value) =>
                      status?.setFilterValue(value === ALL_STATUSES ? undefined : value)
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="Filter by status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_STATUSES}>{ALL_STATUSES}</SelectItem>
                      <SelectItem value="Open">Open</SelectItem>
                      <SelectItem value="Closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Site Name">
                  <Select
                    value={siteValue}
                    onValueChange={(value) =>
                      site?.setFilterValue(value === ALL_SITES ? undefined : value)
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="Filter by site">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={ALL_SITES}>{ALL_SITES}</SelectItem>
                      {SORTED_SITES.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Received from">
                  <Input
                    type="date"
                    value={from}
                    max={to || undefined}
                    onChange={(event) => setRange(event.target.value, to)}
                    aria-label="Received from date"
                    className={cn("h-8", !from && "text-muted-foreground")}
                  />
                </Field>

                <Field label="Received to">
                  <Input
                    type="date"
                    value={to}
                    min={from || undefined}
                    onChange={(event) => setRange(from, event.target.value)}
                    aria-label="Received to date"
                    className={cn("h-8", !to && "text-muted-foreground")}
                  />
                </Field>

                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    onClick={onClearAll}
                    disabled={activeFilters === 0 && !query}
                  >
                    <RotateCcw className="size-4" strokeWidth={2} />
                    Reset
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
