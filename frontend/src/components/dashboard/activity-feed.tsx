"use client";

import { CircleCheck, History, MessageSquare, RefreshCw, TicketPlus, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";

import type { Accent, ActivityItem, ActivityKind } from "@/types/dashboard";
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
import { ACCENT_VAR, readable, tint } from "@/components/dashboard/accent";

const KIND_META: Record<ActivityKind, { icon: LucideIcon; accent: Accent }> = {
  created: { icon: TicketPlus, accent: "primary" },
  resolved: { icon: CircleCheck, accent: "success" },
  updated: { icon: RefreshCw, accent: "info" },
  comment: { icon: MessageSquare, accent: "violet" },
  assigned: { icon: UserPlus, accent: "navy" },
};

const FEED_OFFSET = 0.55; // choreography slot of the first row
const ROW_STEP = 0.06;

// The connector grows down from the dot toward the next row, just after the
// row itself has appeared.
const lineVariants: Variants = {
  hidden: { scaleY: 0 },
  visible: (c: Custom) => ({
    scaleY: 1,
    transition: { duration: 0.5, ease: EASE, delay: resolveDelay(c) + 0.18 },
  }),
};

function TimelineItem({
  item,
  index,
  isLast,
}: {
  item: ActivityItem;
  index: number;
  isLast: boolean;
}) {
  const reduce = useReducedMotion();
  const { icon: Icon, accent } = KIND_META[item.kind];
  const isNewest = index === 0;
  const custom: Custom = { offset: FEED_OFFSET, index, step: ROW_STEP };

  return (
    <motion.li
      {...REVEAL_PROPS}
      variants={slideItemVariants}
      custom={custom}
      className="group relative flex gap-3 pb-4 last:pb-0"
    >
      {!isLast && (
        <motion.span
          aria-hidden
          {...REVEAL_PROPS}
          variants={reduce ? undefined : lineVariants}
          custom={custom}
          className="absolute top-8 bottom-0 left-4 w-px origin-top -translate-x-1/2 bg-border"
        />
      )}
      <span className="relative z-10 shrink-0">
        {/* Newest item: a thin ring keeps radiating outward, so recency reads at a glance. */}
        {isNewest && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: ACCENT_VAR[accent] }}
            initial={{ scale: 1, opacity: reduce ? 0.35 : 0.6 }}
            animate={reduce ? undefined : { scale: 1.8, opacity: 0 }}
            transition={{
              duration: 1.8,
              ease: "easeOut",
              repeat: Infinity,
              repeatDelay: 0.5,
            }}
          />
        )}
        <span
          className="relative grid size-8 place-items-center rounded-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110"
          style={{
            backgroundImage: `linear-gradient(150deg, ${tint(accent, 30)}, ${tint(accent, 9)})`,
            color: ACCENT_VAR[accent],
            boxShadow: `inset 0 0 0 1px ${tint(accent, 26)}, inset 0 1px 0 color-mix(in oklab, white 35%, transparent)`,
          }}
        >
          <Icon className="size-4" strokeWidth={2} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm">
            <span className="font-semibold">{item.actor}</span>{" "}
            <span className="text-muted-foreground">{item.action}</span>{" "}
            <span className="font-semibold">{item.ticketId}</span>
            {item.outcome && <span className="text-muted-foreground"> {item.outcome}</span>}
          </p>
          <span
            className="text-caption tabular-nums"
            style={isNewest ? { color: "var(--chart-success)", fontWeight: 600 } : undefined}
          >
            {item.relativeTime}
          </span>
        </div>
        <div className="text-caption mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 sm:max-w-[16rem] sm:flex-none">
            <TruncatedText>{item.site}</TruncatedText>
          </span>
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: tint(accent, 14),
              color: readable(ACCENT_VAR[accent]),
              backgroundImage: `linear-gradient(180deg, ${tint(accent, 6)}, transparent)`,
              boxShadow: `inset 0 0 0 1px ${tint(accent, 18)}`,
            }}
          >
            {item.category}
          </span>
        </div>
      </div>
    </motion.li>
  );
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <DashCard className="gap-4" glow="violet" offset={FEED_OFFSET - 0.05} lift={2}>
      <CardHeading
        icon={History}
        title="Recent activity"
        description="Latest ticket updates across sites"
      />
      <motion.ol
        variants={groupVariants}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
        className="px-(--card-spacing)"
      >
        {items.map((item, index) => (
          <TimelineItem
            key={item.id}
            item={item}
            index={index}
            isLast={index === items.length - 1}
          />
        ))}
      </motion.ol>
    </DashCard>
  );
}
