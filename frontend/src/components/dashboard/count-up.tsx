"use client";

import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";

import { COUNT_EASE, delayFor } from "@/lib/motion";

function format(value: number, decimals: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Counts from 0 to `value` the first time it scrolls into view.
 * - Eased on a gentler curve than the UI's expo, so digits visibly settle.
 * - Every frame is formatted with thousands separators and a fixed number of
 *   decimals, so the width never jitters and the last frame is exact.
 * - Writes to the DOM node directly, so a 60fps tween never re-renders React.
 * `delay` is a choreography offset in seconds (see lib/motion).
 */
export function CountUp({
  value,
  decimals = 0,
  suffix = "",
  duration = 1.1,
  delay = 0,
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || !inView) return;
    const finalText = `${format(value, decimals)}${suffix}`;
    if (reduceMotion) {
      node.textContent = finalText;
      return;
    }
    const controls = animate(0, value, {
      duration,
      delay: delayFor(delay),
      ease: COUNT_EASE,
      onUpdate: (latest) => {
        node.textContent = `${format(latest, decimals)}${suffix}`;
      },
      onComplete: () => {
        node.textContent = finalText;
      },
    });
    return () => controls.stop();
  }, [inView, reduceMotion, value, decimals, suffix, duration, delay]);

  return (
    <span ref={ref} className={className}>
      {format(0, decimals)}
      {suffix}
    </span>
  );
}
