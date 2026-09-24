"use client";

import { Trophy } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";

import type { TopSite } from "@/types/dashboard";
import {
  EASE,
  REVEAL_PROPS,
  VIEWPORT,
  groupVariants,
  resolveDelay,
  slideItemVariants,
  type Custom,
} from "@/lib/motion";
import { CardHeading, TruncatedText } from "@/components/dashboard/bits";
import { DashCard } from "@/components/dashboard/reveal";
import { deepen } from "@/components/dashboard/accent";
import { CountUp } from "@/components/dashboard/count-up";

const LIST_OFFSET = 0.62; // choreography slot of the first row: the page settles here last
const ROW_STEP = 0.06;

const gradientOf = (color: string) => `linear-gradient(90deg, ${deepen(color, 14)}, ${color})`;

export function TopSites({ sites }: { sites: TopSite[] }) {
  const reduce = useReducedMotion();
  // Math.max() of an empty list is -Infinity; the floor of 1 also avoids /0.
  const max = Math.max(1, ...sites.map((s) => s.tickets));

  return (
    <DashCard className="gap-4" glow="primary" offset={LIST_OFFSET - 0.05} lift={2}>
      <CardHeading icon={Trophy} title="Top sites" description="Ticket volume this month" />
      <motion.ol
        variants={groupVariants}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
        className="grid gap-4 px-(--card-spacing)"
      >
        {sites.map((site, index) => {
          const first = index === 0;
          const color = first ? "var(--primary)" : "var(--chart-info)";
          const custom: Custom = { offset: LIST_OFFSET, index, step: ROW_STEP };
          const barVariants: Variants = reduce
            ? {
                hidden: { width: `${(site.tickets / max) * 100}%` },
                visible: { width: `${(site.tickets / max) * 100}%` },
              }
            : {
                hidden: { width: 0 },
                visible: (c: Custom) => ({
                  width: `${(site.tickets / max) * 100}%`,
                  transition: { duration: 0.8, ease: EASE, delay: resolveDelay(c) + 0.1 },
                }),
              };
          return (
            <motion.li
              key={site.site}
              {...REVEAL_PROPS}
              variants={slideItemVariants}
              custom={custom}
              className="group"
            >
              <div className="flex items-center gap-3">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110"
                  style={
                    first
                      ? {
                          backgroundImage: gradientOf("var(--primary)"),
                          color: "var(--primary-foreground)",
                        }
                      : {
                          backgroundColor: "var(--muted)",
                          color: "var(--muted-foreground)",
                        }
                  }
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    <TruncatedText>{site.site}</TruncatedText>
                  </p>
                  <p className="text-caption">
                    <TruncatedText>{site.country}</TruncatedText>
                  </p>
                </div>
                <CountUp
                  value={site.tickets}
                  duration={0.9}
                  delay={LIST_OFFSET + 0.1}
                  className="text-sm font-bold tabular-nums"
                />
              </div>
              <div className="mt-2 ml-9 h-1.5 overflow-hidden rounded-full bg-muted transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-y-150">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundImage: gradientOf(color) }}
                  {...REVEAL_PROPS}
                  variants={barVariants}
                  custom={custom}
                />
              </div>
            </motion.li>
          );
        })}
      </motion.ol>
    </DashCard>
  );
}
