"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

import { CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Truncates with an ellipsis and, only when the text is actually clipped,
 * reveals the full string in a tooltip. Clipping is tracked with a
 * ResizeObserver, so the tooltip is already enabled by the time a hover
 * begins (and stays correct when the sidebar collapses or the window resizes).
 */
export function TruncatedText({ children, className }: { children: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ResizeObserver reports once on observe(), which seeds the first value.
    const observer = new ResizeObserver(() => {
      setClipped(el.scrollWidth - el.clientWidth > 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <Tooltip disabled={!clipped}>
      <TooltipTrigger render={<span ref={ref} className={cn("block truncate", className)} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Card heading: icon tile + title + subtitle, with an optional right-hand aside. */
export function CardHeading({
  icon: Icon,
  title,
  description,
  aside,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" strokeWidth={2} />
            </span>
            <CardTitle className="text-title font-bold">{title}</CardTitle>
          </div>
          <p className="text-label">{description}</p>
        </div>
        {aside}
      </CardHeader>
      <div aria-hidden className="mx-(--card-spacing) h-px bg-border/70" />
    </>
  );
}
