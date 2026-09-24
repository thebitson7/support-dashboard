"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  BarChart3,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";

import type { Accent, PeriodKey, PeriodSummary } from "@/types/dashboard";
import { formatDuration } from "@/lib/format";
import { EASE, REVEAL_PROPS, resolveDelay, type Custom } from "@/lib/motion";
import { TruncatedText } from "@/components/dashboard/bits";
import { CountUp } from "@/components/dashboard/count-up";
import { DashCard, RevealGroup } from "@/components/dashboard/reveal";
import { IconChip, accentGlow, deepen, readable } from "@/components/dashboard/accent";

// Accents rotate so no two neighbours match in the 3-, 2- or 1-column layouts.
const PERIOD_META: Record<PeriodKey, { icon: LucideIcon; accent: Accent }> = {
  today: { icon: CalendarCheck, accent: "primary" },
  yesterday: { icon: CalendarClock, accent: "info" },
  currentWeek: { icon: CalendarRange, accent: "violet" },
  lastWeek: { icon: BarChart3, accent: "success" },
  currentMonth: { icon: CalendarDays, accent: "navy" },
  previousMonth: { icon: TrendingUp, accent: "primary" },
};

// AMS / Non-AMS keep the same two colours on every card.
const AMS_COLOR = "var(--primary)";
const NON_AMS_COLOR = "var(--chart-info)";
const gradientOf = (color: string) => `linear-gradient(90deg, ${deepen(color, 14)}, ${color})`;

const FILL_SECONDS = 0.9;
const SHIMMER_FROM = -64; // px; the shimmer is 64px wide and lives inside the fill's clip
const SHIMMER_TO = 360;

/** Reads how many columns the grid currently resolves to (it reflows with the container). */
function useGridColumns(ref: RefObject<HTMLElement | null>, fallback = 3) {
  const [cols, setCols] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ResizeObserver reports once on observe(), so this also seeds the value.
    const observer = new ResizeObserver(() => {
      setCols(getComputedStyle(el).gridTemplateColumns.split(" ").length);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return cols;
}

function ProgressBar({
  percent,
  amsMinutes,
  nonAmsMinutes,
  offset,
  sweepKey,
}: {
  percent: number;
  amsMinutes: number;
  nonAmsMinutes: number;
  /** Choreography slot the fill starts in. */
  offset: number;
  /** Bumps on card hover to replay the highlight sweep. */
  sweepKey: number;
}) {
  const reduce = useReducedMotion();
  const fill = `${Math.min(percent, 100)}%`;

  // Self-triggered (REVEAL_PROPS) so the fill reads its own choreography
  // slot; its delay decays like every other entrance.
  const fillVariants: Variants = reduce
    ? { hidden: { width: fill }, visible: { width: fill } }
    : {
        hidden: { width: 0 },
        visible: (c: Custom) => ({
          width: fill,
          transition: { duration: FILL_SECONDS, ease: EASE, delay: resolveDelay(c) },
        }),
      };
  const shimmerVariants: Variants = {
    hidden: { x: SHIMMER_FROM },
    visible: (c: Custom) => ({
      x: SHIMMER_TO,
      transition: { duration: FILL_SECONDS, ease: EASE, delay: resolveDelay(c) },
    }),
  };
  const sweepStyle = {
    background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.6), transparent)",
  };

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(percent, 100)}
      className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <motion.div
        className="relative flex h-full overflow-hidden rounded-full"
        {...REVEAL_PROPS}
        variants={fillVariants}
        custom={{ offset }}
      >
        <div style={{ flex: `${amsMinutes} 1 0`, backgroundImage: gradientOf(AMS_COLOR) }} />
        <div
          style={{
            flex: `${nonAmsMinutes} 1 0`,
            backgroundImage: gradientOf(NON_AMS_COLOR),
          }}
        />
        {/* Sweeps across the fill while it grows, then rests off-screen. */}
        {!reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-16"
            style={sweepStyle}
            {...REVEAL_PROPS}
            variants={shimmerVariants}
            custom={{ offset }}
          />
        )}
        {/* Hover replay. */}
        {!reduce && sweepKey > 0 && (
          <motion.span
            key={sweepKey}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-16"
            style={sweepStyle}
            initial={{ x: SHIMMER_FROM }}
            animate={{ x: SHIMMER_TO }}
            transition={{ duration: 0.7, ease: EASE }}
          />
        )}
      </motion.div>
    </div>
  );
}

function Breakdown({ color, label, minutes }: { color: string; label: string; minutes: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-label">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{formatDuration(minutes)}</span>
    </div>
  );
}

function PeriodCard({ period, offset }: { period: PeriodSummary; offset: number }) {
  const { icon, accent } = PERIOD_META[period.key];
  const goalMet = period.percentComplete >= 100;
  const [sweepKey, setSweepKey] = useState(0);
  // The bar and percentage start once the card has mostly landed.
  const fillOffset = offset + 0.25;

  return (
    <DashCard
      glow={accent}
      offset={offset}
      style={accentGlow(accent)}
      onHoverStart={() => setSweepKey((key) => key + 1)}
    >
      <div className="flex h-full flex-col gap-4 px-(--card-spacing)">
        <div className="flex items-center gap-3">
          <IconChip icon={icon} accent={accent} effect="tilt" />
          <div className="min-w-0 flex-1">
            <h3 className="text-title leading-tight">
              <TruncatedText>{period.label}</TruncatedText>
            </h3>
            <p className="text-caption">
              <TruncatedText>{period.dateRange}</TruncatedText>
            </p>
          </div>
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

        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-metric">{formatDuration(period.workedMinutes)}</span>
          <span className="text-label">of {formatDuration(period.goalMinutes)} goal</span>
        </p>

        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Breakdown color={AMS_COLOR} label="AMS" minutes={period.amsMinutes} />
          <Breakdown color={NON_AMS_COLOR} label="Non-AMS" minutes={period.nonAmsMinutes} />
        </div>

        <div className="mt-auto flex items-center gap-3">
          <div className="flex-1">
            <ProgressBar
              percent={period.percentComplete}
              amsMinutes={period.amsMinutes}
              nonAmsMinutes={period.nonAmsMinutes}
              offset={fillOffset}
              sweepKey={sweepKey}
            />
          </div>
          <CountUp
            value={period.percentComplete}
            suffix="%"
            delay={fillOffset}
            duration={FILL_SECONDS}
            className="w-11 text-right text-sm font-bold tabular-nums"
          />
        </div>
      </div>
    </DashCard>
  );
}

export function PeriodCards({ periods }: { periods: PeriodSummary[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const cols = useGridColumns(ref);

  return (
    <RevealGroup ref={ref} className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
      {periods.map((period, index) => {
        // Diagonal wave: a card's slot depends on its row AND column, so the
        // cascade sweeps from the top-left corner instead of reading in order.
        const row = Math.floor(index / cols);
        const col = index % cols;
        return <PeriodCard key={period.key} period={period} offset={0.12 + (row + col) * 0.055} />;
      })}
    </RevealGroup>
  );
}
