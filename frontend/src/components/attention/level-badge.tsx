import { Clock, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "cn";

import type { AttentionLevel } from "@/types/attention";
import { LEVEL_LABEL } from "@/lib/attention";

/** Icon + word + colour for each level: never colour alone. */
export const LEVEL_STYLE: Record<AttentionLevel, { icon: LucideIcon; text: string; tint: string }> =
  {
    critical: {
      icon: OctagonAlert,
      text: "text-attention-critical",
      tint: "bg-attention-critical/12 ring-attention-critical/35",
    },
    overdue: {
      icon: TriangleAlert,
      text: "text-attention-overdue",
      tint: "bg-attention-overdue/12 ring-attention-overdue/35",
    },
    due_soon: {
      icon: Clock,
      text: "text-attention-soon",
      tint: "bg-attention-soon/12 ring-attention-soon/35",
    },
  };

export function LevelBadge({ level, className }: { level: AttentionLevel; className?: string }) {
  const { icon: Icon, text, tint } = LEVEL_STYLE[level];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap ring-1",
        text,
        tint,
        className,
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.5} aria-hidden />
      {LEVEL_LABEL[level]}
    </span>
  );
}
