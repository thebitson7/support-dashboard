import type { CSSProperties } from "react";

import type { Accent } from "@/types/dashboard";

// Every accent resolves to a theme token, so light/dark variants and any
// future re-theming come for free. "navy" maps to --chart-2 (navy in light,
// a lighter slate in dark, where navy would vanish into the card).
export const ACCENT_VAR: Record<Accent, string> = {
  primary: "var(--primary)",
  info: "var(--chart-info)",
  violet: "var(--chart-violet)",
  success: "var(--chart-success)",
  navy: "var(--chart-2)",
};

export function tint(accent: Accent | string, percent = 14) {
  const color = accent in ACCENT_VAR ? ACCENT_VAR[accent as Accent] : accent;
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

/**
 * Small text in an accent colour on a pale tint of that same colour (tags,
 * badges) can't pass 4.5:1 as-is (orange-on-orange is ~2.3:1). Mixing 50%
 * toward the foreground colour keeps the hue and clears AA in both themes.
 */
export function readable(color: string, towardForeground = 50) {
  return `color-mix(in oklab, ${color}, var(--foreground) ${towardForeground}%)`;
}

/** Same hue, pushed toward black: the "deeper" end of an accent gradient. */
export function deepen(color: string, percent = 16) {
  return `color-mix(in oklab, ${color}, black ${percent}%)`;
}

/** A soft accent glow for the top-left corner of a card. */
export function accentGlow(accent: Accent): CSSProperties {
  return {
    backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${tint(accent, 11)}, transparent 55%)`,
  };
}
