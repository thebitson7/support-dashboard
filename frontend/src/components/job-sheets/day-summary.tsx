"use client";

import { Check } from "lucide-react";

import type { WorkLogEntry } from "@/types/working-hours";
import { formatDuration } from "@/lib/format";
import { CATEGORY_COLOR, entryMinutes } from "@/lib/working-hours";
import { deepen, readable } from "@/components/dashboard/accent";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Same daily goal as the period summary's Today card (working_hours/periods.py). */
const DAY_GOAL_MINUTES = 8 * 60;

const gradientOf = (color: string) => `linear-gradient(90deg, ${deepen(color, 14)}, ${color})`;

function Breakdown({ color, label, minutes }: { color: string; label: string; minutes: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-label">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{formatDuration(minutes)}</span>
    </div>
  );
}

/**
 * The day at a glance, in the period cards' visual language: total vs. the
 * 8 h goal, split AMS / Non-AMS. Computed from the day's entries (exact
 * minutes from their times), which are the same rows the summary adds up.
 */
export function DaySummary({ entries }: { entries: WorkLogEntry[] | undefined }) {
  if (!entries) {
    return (
      <Card className="h-[9.5rem] justify-center gap-4 px-5 shadow-elev-1" aria-hidden>
        <Skeleton className="h-9 w-40 rounded-lg motion-reduce:animate-none" />
        <Skeleton className="h-2.5 w-full rounded-full motion-reduce:animate-none" />
      </Card>
    );
  }

  const minutesOf = (category: WorkLogEntry["category"]) =>
    entries.filter((e) => e.category === category).reduce((sum, e) => sum + entryMinutes(e), 0);
  const ams = minutesOf("ams");
  const nonAms = minutesOf("non_ams");
  const total = ams + nonAms;
  const percent = Math.round((total / DAY_GOAL_MINUTES) * 100);
  const goalMet = percent >= 100;

  return (
    <Card className="gap-4 px-5 shadow-elev-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-metric">{formatDuration(total)}</span>
          <span className="text-label">of {formatDuration(DAY_GOAL_MINUTES)} goal</span>
        </p>
        {goalMet && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{
              color: readable("var(--chart-success)"),
              backgroundColor: "color-mix(in oklab, var(--chart-success) 14%, transparent)",
            }}
          >
            <Check className="size-3.5" strokeWidth={2} />
            Goal met
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Breakdown color={CATEGORY_COLOR.ams} label="AMS" minutes={ams} />
        <Breakdown color={CATEGORY_COLOR.non_ams} label="Non-AMS" minutes={nonAms} />
      </div>

      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Share of the 8 hour daily goal"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${percent}% of the daily goal: ${formatDuration(ams)} AMS, ${formatDuration(nonAms)} Non-AMS`}
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="flex h-full overflow-hidden rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ width: `${Math.min(percent, 100)}%` }}
          >
            <div style={{ flex: `${ams} 1 0`, backgroundImage: gradientOf(CATEGORY_COLOR.ams) }} />
            <div
              style={{
                flex: `${nonAms} 1 0`,
                backgroundImage: gradientOf(CATEGORY_COLOR.non_ams),
              }}
            />
          </div>
        </div>
        <span className="w-11 text-right text-sm font-bold tabular-nums" aria-hidden>
          {percent}%
        </span>
      </div>
    </Card>
  );
}
