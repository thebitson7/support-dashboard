"use client";

import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cn } from "cn";

import type { Accent } from "@/types/dashboard";
import { Card } from "@/components/ui/card";
import {
  REVEAL_PROPS,
  VIEWPORT,
  groupVariants,
  itemVariants,
  liftHover,
  reducedVariants,
} from "@/lib/motion";
import { ACCENT_VAR } from "@/components/dashboard/accent-tokens";

/** Fires the group's children as it scrolls into view (children carry their own delays). */
export function RevealGroup(props: HTMLMotionProps<"div">) {
  return (
    <motion.div
      variants={groupVariants}
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT}
      {...props}
    />
  );
}

function RevealItem({
  lift = 0,
  offset = 0,
  index = 0,
  step = 0,
  ...props
}: HTMLMotionProps<"div"> & {
  lift?: number;
  offset?: number;
  index?: number;
  step?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      {...REVEAL_PROPS}
      variants={reduce ? reducedVariants : itemVariants}
      custom={{ offset, index, step }}
      whileHover={lift ? liftHover(lift) : undefined}
      {...props}
    />
  );
}

// Lets a card's contents react to the card being hovered (icon bounce,
// mascot wave...) without each one needing its own pointer listeners.
const HoverContext = createContext(false);
export const useCardHover = () => useContext(HoverContext);

/**
 * The dashboard's standard card. Two elevation tiers (1 = standard, 2 = raised
 * hero), a lift + deeper shadow + accent ring glow on hover, and a
 * choreography slot (`offset`) for the entrance sequence.
 */
export function DashCard({
  className,
  style,
  children,
  lift = 3,
  elevation = 1,
  glow,
  offset = 0,
  onHoverStart,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  lift?: number;
  elevation?: 1 | 2;
  /** Accent whose colour rims the card on hover. */
  glow?: Accent;
  offset?: number;
  onHoverStart?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <HoverContext.Provider value={hovered}>
      <RevealItem
        lift={lift}
        offset={offset}
        className="h-full"
        onHoverStart={() => {
          setHovered(true);
          onHoverStart?.();
        }}
        onHoverEnd={() => setHovered(false)}
      >
        <Card
          style={
            {
              ...style,
              "--glow": glow ? ACCENT_VAR[glow] : "var(--foreground)",
            } as CSSProperties
          }
          className={cn(
            "h-full [--card-spacing:--spacing(5)] transition-[box-shadow,--tw-ring-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-elev-hover hover:ring-[color-mix(in_oklab,var(--glow)_38%,transparent)]",
            elevation === 2 ? "shadow-elev-2" : "shadow-elev-1",
            className,
          )}
        >
          {children}
        </Card>
      </RevealItem>
    </HoverContext.Provider>
  );
}
