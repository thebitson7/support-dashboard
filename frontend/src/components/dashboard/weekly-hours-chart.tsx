"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Activity } from "lucide-react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { WeeklyHoursPoint } from "@/types/dashboard";
import { delayFor } from "@/lib/motion";
import { CardHeading } from "@/components/dashboard/bits";
import { DashCard } from "@/components/dashboard/reveal";

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "var(--elev-2)",
};

const CARD_OFFSET = 0.32; // choreography slot of the card itself
const DRAW_MS = 1300;

/** Mounts a chart shortly after its card lands, so Recharts' mount animation plays while it's visible. */
function useMountWhenVisible(offset: number) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!inView) return;
    const id = setTimeout(() => setReady(true), delayFor(offset) * 1000);
    return () => clearTimeout(id);
  }, [inView, offset]);
  return { ref, ready };
}

/**
 * The latest point: a solid dot with a soft, endlessly expanding halo.
 * Recharts renders custom dots while the line is still being drawn, so the
 * whole marker waits for the draw to finish and then fades in, rather than
 * floating at the end of a line that hasn't reached it yet.
 */
function LatestDot({ cx, cy, reduce }: { cx: number; cy: number; reduce: boolean }) {
  return (
    <motion.g
      initial={{ opacity: reduce ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: reduce ? 0 : DRAW_MS / 1000 }}
    >
      {reduce ? (
        <circle cx={cx} cy={cy} r={11} fill="var(--primary)" opacity={0.22} />
      ) : (
        <motion.circle
          cx={cx}
          cy={cy}
          fill="var(--primary)"
          initial={{ r: 6, opacity: 0.45 }}
          animate={{ r: 18, opacity: 0 }}
          transition={{
            duration: 1.8,
            ease: "easeOut",
            repeat: Infinity,
            repeatDelay: 0.4,
          }}
        />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={5.5}
        fill="var(--primary)"
        stroke="var(--card)"
        strokeWidth={2.5}
      />
    </motion.g>
  );
}

export function WeeklyHoursChart({ data, goal }: { data: WeeklyHoursPoint[]; goal: number }) {
  const reduce = !!useReducedMotion();
  // Recharts animates on mount, so the chart only mounts once its card is on
  // screen; the min-height box below reserves the space (no layout shift).
  const { ref, ready } = useMountWhenVisible(CARD_OFFSET + 0.1);
  const average = data.length > 0 ? data.reduce((sum, p) => sum + p.hours, 0) / data.length : 0;
  const lastIndex = data.length - 1;

  return (
    <DashCard className="gap-4" glow="primary" offset={CARD_OFFSET} lift={2}>
      <CardHeading
        icon={Activity}
        title="Weekly hours"
        description={`Last ${data.length} weeks vs. the ${goal}h goal`}
        aside={
          <div className="text-right">
            <p className="text-metric-sm">{average.toFixed(1)}h</p>
            <p className="text-caption mt-1">weekly average</p>
          </div>
        }
      />
      <div ref={ref} className="min-h-64 w-full min-w-0 flex-1 px-3">
        {ready && (
          <ResponsiveContainer width="100%" height="100%" minHeight={256}>
            <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="weeklyHoursFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
              <XAxis
                dataKey="week"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              />
              <YAxis
                domain={[0, 50]}
                ticks={[0, 10, 20, 30, 40, 50]}
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={(value) => `${value}h`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }}
                formatter={(value) => [`${value}h`, "Hours worked"]}
                labelFormatter={(label) => `Week of ${label}`}
              />
              <ReferenceLine
                y={goal}
                stroke="var(--muted-foreground)"
                strokeDasharray="6 6"
                strokeOpacity={0.7}
              />
              {/* Fill reveals left-to-right... */}
              <Area
                type="monotone"
                dataKey="hours"
                stroke="none"
                fill="url(#weeklyHoursFill)"
                activeDot={false}
                isAnimationActive={!reduce}
                animationDuration={DRAW_MS}
                animationEasing="ease-out"
              />
              {/* ...while the stroke itself is drawn along its path. */}
              <Line
                type="monotone"
                dataKey="hours"
                stroke="var(--primary)"
                strokeWidth={3}
                strokeLinecap="round"
                isAnimationActive={!reduce}
                animationDuration={DRAW_MS}
                animationEasing="ease-out"
                dot={(props: { cx?: number; cy?: number; index?: number }): ReactElement =>
                  props.index === lastIndex && props.cx !== undefined && props.cy !== undefined ? (
                    <LatestDot key="latest" cx={props.cx} cy={props.cy} reduce={reduce} />
                  ) : (
                    <g key={props.index} />
                  )
                }
                activeDot={{
                  r: 6,
                  fill: "var(--primary)",
                  stroke: "var(--card)",
                  strokeWidth: 2.5,
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </DashCard>
  );
}
