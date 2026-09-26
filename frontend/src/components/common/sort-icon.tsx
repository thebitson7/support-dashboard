"use client";

import { ChevronUp } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { EASE } from "@/lib/motion";

/** A chevron that flips (asc = up, desc = down) with a quick eased rotation. */
export function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      initial={false}
      animate={{ rotate: direction === "desc" ? 180 : 0, opacity: direction ? 1 : 0.35 }}
      transition={{ duration: reduce ? 0 : 0.18, ease: EASE }}
      className="flex"
    >
      <ChevronUp className="size-4" strokeWidth={2} />
    </motion.span>
  );
}
