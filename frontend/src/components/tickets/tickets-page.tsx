"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";

import { EASE } from "@/lib/motion";
import { MOCK_TICKETS } from "@/lib/mock-tickets";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { TicketsPagination } from "@/components/tickets/tickets-pagination";
import { TicketsTableView } from "@/components/tickets/tickets-table";
import { useTicketsTable } from "@/components/tickets/tickets-table-config";
import { TicketsToolbar } from "@/components/tickets/tickets-toolbar";

const SIMULATED_LOAD_MS = 450;
const SEARCH_DEBOUNCE_MS = 250;
// The simulated load only plays once per browser session.
let loadedThisSession = false;

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

export function TicketsPage() {
  const table = useTicketsTable(MOCK_TICKETS);
  const reduceMotion = useReducedMotion();

  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState(false);

  // Simulated fetch: skeleton rows, then the table, whose rows rise in once.
  useEffect(() => {
    const wait = reduceMotion || loadedThisSession ? 0 : SIMULATED_LOAD_MS;
    const loadTimer = setTimeout(() => {
      loadedThisSession = true;
      setLoading(false);
      setReveal(!reduceMotion);
    }, wait);
    const settleTimer = setTimeout(() => setReveal(false), wait + 1000);
    return () => {
      clearTimeout(loadTimer);
      clearTimeout(settleTimer);
    };
  }, [reduceMotion]);

  // Debounced global filter across the text columns.
  const applied = (table.state.globalFilter as string | undefined) ?? "";
  useEffect(() => {
    if (query === applied) return;
    const id = setTimeout(() => table.setGlobalFilter(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, applied, table]);

  const clearAll = () => {
    setQuery("");
    table.setGlobalFilter("");
    table.resetColumnFilters(true);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-[34rem] w-full flex-1 flex-col gap-5">
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
              <Button
                onClick={() =>
                  toast("Coming soon", {
                    description: "Creating tickets isn't available yet.",
                  })
                }
              >
                <Plus strokeWidth={2} />
                New
              </Button>
            </div>
          </div>
        </Enter>

        <Enter delay={0.08}>
          <TicketsToolbar
            table={table}
            query={query}
            onQueryChange={setQuery}
            advancedOpen={advancedOpen}
            onAdvancedChange={setAdvancedOpen}
            onClearAll={clearAll}
          />
        </Enter>

        <Enter delay={0.16} className="flex min-h-0 flex-1 flex-col">
          <Card className="min-h-0 flex-1 gap-0 py-0 shadow-elev-1">
            <TicketsTableView table={table} loading={loading} reveal={reveal} onClear={clearAll} />
            <TicketsPagination table={table} totalRows={MOCK_TICKETS.length} />
          </Card>
        </Enter>
      </div>
      <Toaster position="bottom-right" />
    </MotionConfig>
  );
}
