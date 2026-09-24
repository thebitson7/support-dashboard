"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { DashboardData } from "@/types/dashboard";
import { markChoreographyStart } from "@/lib/motion";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { PeriodCards } from "@/components/dashboard/period-cards";
import { TicketStatusChart } from "@/components/dashboard/ticket-status-chart";
import { TopSites } from "@/components/dashboard/top-sites";
import { WeeklyHoursChart } from "@/components/dashboard/weekly-hours-chart";

// The simulated load only happens once per browser session: navigating away
// and back shouldn't replay it. Real async data will replace this timer.
const SIMULATED_LOAD_MS = 480;
let loadedThisSession = false;

/**
 * Sections below the page header. Shows shape-matched skeletons for a
 * moment, then swaps in the real content and starts the entrance
 * choreography clock (see lib/motion). The theme toggle never touches this
 * state, so switching themes can't replay any of it.
 */
export function DashboardSections({ data }: { data: DashboardData }) {
  const reduceMotion = useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wait = reduceMotion || loadedThisSession ? 0 : SIMULATED_LOAD_MS;
    const id = setTimeout(() => {
      markChoreographyStart();
      loadedThisSession = true;
      setReady(true);
    }, wait);
    return () => clearTimeout(id);
  }, [reduceMotion]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {ready ? (
        <div key="content" className="flex flex-col gap-6">
          <KpiCards kpis={data.kpis} />
          <PeriodCards periods={data.periods} />

          <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
            <div className="@4xl:col-span-3">
              <WeeklyHoursChart data={data.weeklyHours} goal={data.weeklyGoalHours} />
            </div>
            <div className="@4xl:col-span-2">
              <TicketStatusChart data={data.ticketsByStatus} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
            <div className="@4xl:col-span-3">
              <ActivityFeed items={data.activity} />
            </div>
            <div className="@4xl:col-span-2">
              <TopSites sites={data.topSites} />
            </div>
          </div>
        </div>
      ) : (
        <motion.div key="skeleton" exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <DashboardSkeleton />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
