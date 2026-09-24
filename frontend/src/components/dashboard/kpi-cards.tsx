"use client";

import { ArrowDownRight, ArrowUpRight, CircleCheck, MapPin, Ticket, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import type { Accent, Kpi, KpiKey } from "@/types/dashboard";
import { SPRING_POP } from "@/lib/motion";
import { CountUp } from "@/components/dashboard/count-up";
import { DashCard, RevealGroup, useCardHover } from "@/components/dashboard/reveal";
import { IconChip, accentGlow, readable } from "@/components/dashboard/accent";
import { Mascot } from "@/components/dashboard/mascot";
import { ScrollFade } from "@/components/dashboard/scroll-fade";

const KPI_META: Record<KpiKey, { icon: LucideIcon; accent: Accent }> = {
  ticketsThisMonth: { icon: Ticket, accent: "primary" },
  avgResolution: { icon: Timer, accent: "info" },
  closedToday: { icon: CircleCheck, accent: "success" },
  activeSites: { icon: MapPin, accent: "violet" },
};

/** Up/down arrow shows the direction of change; colour shows good vs bad. */
function DeltaBadge({ kpi }: { kpi: Kpi }) {
  const up = kpi.deltaPercent > 0;
  const good = up === kpi.higherIsBetter;
  const color = good ? "var(--chart-success)" : "var(--destructive)";
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
      style={{
        color: readable(color),
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
      }}
    >
      <Arrow className="size-3.5" strokeWidth={2} />
      {up ? "+" : "−"}
      {Math.abs(kpi.deltaPercent).toFixed(1)}%
    </span>
  );
}

/** The mascot waves (a springy tilt + hop) while the hero card is hovered. */
function HoverMascot() {
  const hovered = useCardHover();
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="pointer-events-none absolute -right-1 bottom-0"
      style={{ transformOrigin: "50% 90%" }}
      animate={
        hovered && !reduce ? { rotate: -9, y: -4, scale: 1.06 } : { rotate: 0, y: 0, scale: 1 }
      }
      transition={SPRING_POP}
    >
      <Mascot className="size-24" />
    </motion.div>
  );
}

function FeatureKpi({ kpi, offset }: { kpi: Kpi; offset: number }) {
  const { icon: Icon } = KPI_META[kpi.key];
  return (
    // `dark` scopes the dark-mode tokens to this card, so the gradient
    // hero stays navy in both themes with correctly-contrasted text.
    <DashCard
      elevation={2}
      glow="primary"
      offset={offset}
      className="dark relative border-0 text-foreground"
      style={{
        backgroundImage: [
          "radial-gradient(90% 120% at 100% 0%, color-mix(in oklab, var(--primary) 55%, transparent), transparent 60%)",
          "linear-gradient(140deg, var(--sidebar), color-mix(in oklab, var(--sidebar) 55%, black))",
        ].join(", "),
      }}
    >
      <div className="relative flex h-full flex-col justify-between gap-4 px-(--card-spacing)">
        <div className="text-label flex items-center gap-2 text-foreground/80">
          <Icon className="size-4" strokeWidth={2} />
          {kpi.label}
        </div>
        <div>
          <CountUp
            value={kpi.value}
            decimals={kpi.decimals}
            suffix={kpi.suffix}
            delay={offset + 0.15}
            className="text-metric block"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DeltaBadge kpi={kpi} />
            <span className="text-caption">{kpi.comparedTo}</span>
          </div>
        </div>
        <HoverMascot />
      </div>
    </DashCard>
  );
}

function StatKpi({ kpi, offset }: { kpi: Kpi; offset: number }) {
  const { icon, accent } = KPI_META[kpi.key];
  return (
    <DashCard elevation={2} glow={accent} offset={offset} style={accentGlow(accent)}>
      <div className="flex h-full flex-col justify-between gap-4 px-(--card-spacing)">
        <div className="flex items-center gap-3">
          <IconChip icon={icon} accent={accent} effect="bounce" />
          <span className="text-label">{kpi.label}</span>
        </div>
        <div>
          <CountUp
            value={kpi.value}
            decimals={kpi.decimals}
            suffix={kpi.suffix}
            delay={offset + 0.15}
            className="text-metric block"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DeltaBadge kpi={kpi} />
            <span className="text-caption">{kpi.comparedTo}</span>
          </div>
        </div>
      </div>
    </DashCard>
  );
}

export function KpiCards({ kpis }: { kpis: Kpi[] }) {
  return (
    <ScrollFade>
      <RevealGroup className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-4">
        {kpis.map((kpi, index) =>
          index === 0 ? (
            <FeatureKpi key={kpi.key} kpi={kpi} offset={index * 0.05} />
          ) : (
            <StatKpi key={kpi.key} kpi={kpi} offset={index * 0.05} />
          ),
        )}
      </RevealGroup>
    </ScrollFade>
  );
}
