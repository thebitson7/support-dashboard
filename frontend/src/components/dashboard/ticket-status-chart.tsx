"use client";

import { useState } from "react";
import { PieChart } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { cn } from "cn";

import type { Accent, TicketStatus, TicketStatusCount } from "@/types/dashboard";
import {
  EASE,
  REVEAL_PROPS,
  VIEWPORT,
  groupVariants,
  resolveDelay,
  type Custom,
} from "@/lib/motion";
import { CardHeading } from "@/components/dashboard/bits";
import { DashCard } from "@/components/dashboard/reveal";
import { ACCENT_VAR, deepen } from "@/components/dashboard/accent";
import { CountUp } from "@/components/dashboard/count-up";

const STATUS_ACCENT: Record<TicketStatus, Accent> = {
  Open: "primary",
  "In Progress": "info",
  Resolved: "success",
  Closed: "violet",
};

// --- Donut geometry (a 208px box; angles in degrees, 0 = 12 o'clock) ------
const SIZE = 208;
const CENTER = SIZE / 2;
const RADIUS = 84;
const STROKE = 18;
const GAP_DEG = 4;
// Round caps poke past each arc's end by half the stroke, so shrink every arc
// by that angle (plus half the visual gap) to keep neat gaps between segments.
const CAP_DEG = (STROKE / 2 / RADIUS) * (180 / Math.PI);

function polar(deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CENTER + RADIUS * Math.cos(rad), CENTER + RADIUS * Math.sin(rad)];
}

function arc(startDeg: number, endDeg: number) {
  const [x0, y0] = polar(startDeg);
  const [x1, y1] = polar(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const SEGMENT_OFFSET = 0.5; // choreography slot of the first segment
const SEGMENT_STEP = 0.12; // each segment starts this much after the last

const segmentVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (c: Custom) => {
    const delay = resolveDelay(c);
    return {
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: { duration: 0.75, ease: EASE, delay },
        opacity: { duration: 0.05, delay },
      },
    };
  },
};

export function TicketStatusChart({ data }: { data: TicketStatusCount[] }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  const segments = data.map((d, index) => {
    const before =
      total > 0 ? data.slice(0, index).reduce((sum, item) => sum + item.count, 0) / total : 0;
    // total can be 0 (no tickets): every segment is then empty, never NaN.
    const fraction = total > 0 ? d.count / total : 0;
    const start = before * 360 + CAP_DEG + GAP_DEG / 2;
    const end = (before + fraction) * 360 - CAP_DEG - GAP_DEG / 2;
    return {
      ...d,
      percent: Math.round(fraction * 100),
      color: ACCENT_VAR[STATUS_ACCENT[d.status]],
      path: arc(start, Math.max(end, start + 0.5)),
    };
  });
  const focused = active === null ? null : segments[active];

  return (
    <DashCard className="gap-4" glow="info" offset={0.4} lift={2}>
      <CardHeading icon={PieChart} title="Tickets by status" description="All tickets this month" />

      <div className="relative mx-auto size-52">
        <motion.svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="size-full"
          role="img"
          aria-label={`Tickets by status: ${data.map((d) => `${d.status} ${d.count}`).join(", ")}`}
          variants={groupVariants}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          {/* faint track so the ring is legible while segments draw */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={STROKE}
            opacity={0.6}
          />
          {segments.map((segment, index) => (
            <g
              key={segment.status}
              className="transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                transformOrigin: `${CENTER}px ${CENTER}px`,
                transform: active === index ? "scale(1.05)" : "none",
                opacity: active !== null && active !== index ? 0.35 : 1,
              }}
            >
              <motion.path
                d={segment.path}
                fill="none"
                stroke={segment.color}
                strokeWidth={STROKE}
                strokeLinecap="round"
                variants={
                  reduce
                    ? {
                        hidden: { pathLength: 1, opacity: 1 },
                        visible: { pathLength: 1, opacity: 1 },
                      }
                    : segmentVariants
                }
                {...REVEAL_PROPS}
                custom={{ offset: SEGMENT_OFFSET, index, step: SEGMENT_STEP }}
                className="cursor-pointer"
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
              />
            </g>
          ))}
        </motion.svg>

        {/* Centre readout: the total, or the hovered segment's detail. */}
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <div
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-200",
              focused && "opacity-0",
            )}
          >
            <CountUp value={total} delay={SEGMENT_OFFSET} className="text-metric-sm block" />
            <span className="text-caption mt-1 block">tickets</span>
          </div>
          <div
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-200",
              !focused && "opacity-0",
            )}
            aria-hidden
          >
            <span className="text-metric-sm block">{focused?.count}</span>
            <span className="text-caption mt-1 block">
              {focused?.status} · {focused?.percent}%
            </span>
          </div>
        </div>
      </div>

      <ul className="grid gap-1 px-(--card-spacing)">
        {segments.map((segment, index) => (
          <li
            key={segment.status}
            className={cn(
              "-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors duration-200",
              active === index && "bg-muted",
            )}
            onPointerEnter={() => setActive(index)}
            onPointerLeave={() => setActive(null)}
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{
                backgroundImage: `linear-gradient(135deg, ${segment.color}, ${deepen(segment.color, 22)})`,
              }}
            />
            <span className="text-label flex-1">{segment.status}</span>
            <span className="font-semibold tabular-nums">{segment.count}</span>
            <span className="text-caption w-10 text-right tabular-nums">{segment.percent}%</span>
          </li>
        ))}
      </ul>
    </DashCard>
  );
}
