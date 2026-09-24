import type { Variants } from "framer-motion";

// Shared motion tokens for the dashboard.

/** Base curve for everything (same as the sidebar): fast out, long settle. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Counters use a gentler curve so digits visibly settle instead of snapping. */
export const COUNT_EASE = [0.25, 0.8, 0.25, 1] as const;

/**
 * Springs are used on purpose for small, tactile hover reactions (icons, the
 * mascot): a spring overshoots and rebounds, which reads as "bounce" where a
 * tween just slides. Everything else stays on EASE.
 */
export const SPRING_POP = {
  type: "spring",
  stiffness: 460,
  damping: 13,
  mass: 0.8,
} as const;

export const VIEWPORT = { once: true, amount: 0.15 } as const;

/**
 * Spread onto any motion element that has its own delay. framer resolves a
 * child's variant with the *parent's* `custom` when the parent propagates a
 * label, which would silently drop the child's delay, so every timed element
 * triggers itself.
 */
export const REVEAL_PROPS = {
  initial: "hidden",
  whileInView: "visible",
  viewport: VIEWPORT,
} as const;

// --- Choreography clock ------------------------------------------------------
// Entrance offsets ("KPI first, then periods, then charts...") are measured
// from the moment the dashboard content mounts. Anything that scrolls into
// view later has already "missed" its slot, so its delay collapses to 0
// instead of making the user wait.

let epoch = 0;
let armed = false;

/**
 * Arms the clock. It doesn't start ticking until the first animation asks
 * for a delay: mounting the tree takes a few hundred ms, and starting the
 * clock at mount would burn through the whole (short) choreography before
 * anything had even begun to animate.
 */
export function markChoreographyStart() {
  armed = true;
}

export function delayFor(offset: number) {
  if (armed) {
    epoch = performance.now();
    armed = false;
  }
  if (!epoch) return offset;
  return Math.max(0, offset - (performance.now() - epoch) / 1000);
}

export type Custom = { offset?: number; index?: number; step?: number };

/** offset (choreography slot, decays) + index*step (local stagger, always kept). */
export function resolveDelay({ offset = 0, index = 0, step = 0 }: Custom = {}) {
  return delayFor(offset) + index * step;
}

export const groupVariants: Variants = { hidden: {}, visible: {} };

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: (c: Custom) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE, delay: resolveDelay(c) },
  }),
};

export const slideItemVariants: Variants = {
  hidden: { opacity: 0, x: -14 },
  visible: (c: Custom) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.45, ease: EASE, delay: resolveDelay(c) },
  }),
};

/** prefers-reduced-motion: no travel, no stagger, just a short fade. */
export const reducedVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

export function liftHover(px: number) {
  return { y: -px, transition: { duration: 0.25, ease: EASE } };
}
