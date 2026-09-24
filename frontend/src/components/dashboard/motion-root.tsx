"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";

/** Respects the OS "reduce motion" setting for every dashboard animation. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
