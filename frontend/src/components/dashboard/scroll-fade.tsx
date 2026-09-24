"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

/**
 * A barely-there scroll effect for the hero row: as it scrolls away it eases
 * back a hair (scale 1 → 0.97) and dims (1 → 0.55), so the content coming up
 * beneath it takes focus. Both are transform/opacity only (compositor-run),
 * driven by the <main> scroll container rather than the window, and skipped
 * entirely for prefers-reduced-motion.
 */
export function ScrollFade({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();

  // Runs before useScroll's own effect, so the container is set in time.
  useLayoutEffect(() => {
    container.current = ref.current?.closest("main") ?? null;
  }, []);

  const { scrollYProgress } = useScroll({
    target: ref,
    container,
    offset: ["start start", "end start"],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.97]);
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0.55]);

  return (
    <motion.div
      ref={ref}
      style={reduce ? undefined : { scale, opacity, transformOrigin: "50% 0%" }}
    >
      {children}
    </motion.div>
  );
}
