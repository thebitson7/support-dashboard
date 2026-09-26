"use client";

import { useState } from "react";
import Link from "next/link";
import { Tabs } from "@base-ui/react/tabs";
import { motion, MotionConfig, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

import { useAuth, type AuthUser } from "@/lib/auth";
import { EASE } from "@/lib/motion";
import { TeamActivity } from "@/components/reports/team-activity";
import { TicketsPage } from "@/components/tickets/tickets-page";
import { Toaster } from "@/components/ui/sonner";

const TABS = [
  { id: "tickets", label: "All Tickets" },
  { id: "team", label: "Team Activity" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Reports. Everyone gets "All Tickets" (the tickets table, read-only, with a
 * CSV export). Admins also get "Team Activity"; only then is there a tab bar,
 * since staff would have nothing to switch to.
 */
export default function ReportsPage() {
  const { user } = useAuth();
  if (!user) return null; // AppShell only renders pages for a signed-in user.
  const isAdmin = user.role === "admin";

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex w-full flex-1 flex-col gap-5">
        <motion.div
          className="grid gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
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
                Reports
              </li>
            </ol>
          </nav>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Reports</h1>
            <p className="text-label">
              {isAdmin
                ? "Every ticket, and the team's logged work over any date range."
                : "Every ticket, searchable and exportable."}
            </p>
          </div>
        </motion.div>

        {isAdmin ? <AdminReports viewer={user} /> : <TicketsPage readOnly />}
      </div>
      <Toaster position="bottom-right" />
    </MotionConfig>
  );
}

function AdminReports({ viewer }: { viewer: AuthUser }) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<TabId>("tickets");
  // Team Activity loads on its first visit and then stays mounted, so its
  // range, sort and open drill-down survive a trip to the other tab.
  const [teamOpened, setTeamOpened] = useState(false);

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(next) => {
        setTab(next as TabId);
        if (next === "team") setTeamOpened(true);
      }}
      className="flex flex-1 flex-col gap-5"
    >
      {/* Same pill tabs as the ticket dialog. */}
      <Tabs.List
        aria-label="Reports"
        className="flex w-fit gap-1 rounded-full bg-card p-1 shadow-elev-1 ring-1 ring-border"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Tabs.Tab
              key={t.id}
              value={t.id}
              className={cn(
                "relative flex h-9 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="reports-tab-pill"
                  transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
                  className="absolute inset-0 rounded-full bg-primary"
                  aria-hidden
                />
              )}
              <span className="relative">{t.label}</span>
            </Tabs.Tab>
          );
        })}
      </Tabs.List>

      {/* Kept mounted, so its search, filters and page survive a trip to the other tab. */}
      <Tabs.Panel value="tickets" keepMounted className="flex flex-1 flex-col outline-none">
        <motion.div
          className="flex flex-1 flex-col"
          initial={false}
          animate={{ opacity: tab === "tickets" ? 1 : 0 }}
          transition={{ duration: 0.16, ease: EASE }}
        >
          <TicketsPage readOnly />
        </motion.div>
      </Tabs.Panel>
      <Tabs.Panel value="team" keepMounted className="outline-none">
        {teamOpened && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: tab === "team" ? 1 : 0 }}
            transition={{ duration: 0.16, ease: EASE }}
          >
            <TeamActivity viewer={viewer} />
          </motion.div>
        )}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
