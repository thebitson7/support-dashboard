"use client";

import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "cn";

import type { Accent } from "@/types/dashboard";
import { SPRING_POP } from "@/lib/motion";
import { useCardHover } from "@/components/dashboard/reveal";
import { ACCENT_VAR, tint } from "@/components/dashboard/accent-tokens";

export {
  ACCENT_VAR,
  accentGlow,
  deepen,
  readable,
  tint,
} from "@/components/dashboard/accent-tokens";

// What the chip does while its card is hovered. Springs overshoot, so the
// same target value reads as a bounce (bounce) or a playful wobble (tilt).
const HOVER_EFFECT = {
  none: { y: 0, scale: 1, rotate: 0 },
  bounce: { y: -5, scale: 1.1, rotate: 0 },
  tilt: { y: 0, scale: 1.08, rotate: 14 },
} as const;
const REST = { y: 0, scale: 1, rotate: 0 };

export function IconChip({
  icon: Icon,
  accent,
  effect = "none",
  className,
}: {
  icon: LucideIcon;
  accent: Accent;
  effect?: keyof typeof HOVER_EFFECT;
  className?: string;
}) {
  const hovered = useCardHover();
  const reduce = useReducedMotion();

  return (
    <motion.span
      animate={hovered && !reduce ? HOVER_EFFECT[effect] : REST}
      transition={SPRING_POP}
      className={cn("grid size-11 shrink-0 place-items-center rounded-full", className)}
      style={{
        // Soft top-lit gradient + hairline ring + top highlight: a glassy
        // chip instead of a flat disc. Same hue, so contrast is unchanged.
        backgroundImage: `linear-gradient(150deg, ${tint(accent, 30)}, ${tint(accent, 9)})`,
        color: ACCENT_VAR[accent],
        boxShadow: `inset 0 0 0 1px ${tint(accent, 26)}, inset 0 1px 0 color-mix(in oklab, white 35%, transparent)`,
      }}
    >
      <Icon className="size-5" strokeWidth={2} />
    </motion.span>
  );
}
