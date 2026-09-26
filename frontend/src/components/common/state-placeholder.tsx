"use client";

import type { ReactNode } from "react";
import { RotateCw, TriangleAlert, WifiOff, type LucideIcon } from "lucide-react";

import type { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * The empty / error block shown inside a table card (AMS Tickets, Lookups):
 * icon chip, title, one line of explanation, optional action.
 */
export function StatePlaceholder({
  icon: Icon,
  title,
  children,
  action,
  alert,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** Announce it (errors). */
  alert?: boolean;
}) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-7" strokeWidth={2} aria-hidden />
      </span>
      <div className="grid gap-1">
        <p className="text-title">{title}</p>
        <p className="text-label">{children}</p>
      </div>
      {action}
    </div>
  );
}

/** A failed list load: "can't reach the server" (offline) vs. the API's own message, plus retry. */
export function LoadErrorPlaceholder({
  error,
  what,
  onRetry,
}: {
  error: ApiError;
  /** e.g. "tickets" -> "Couldn't load tickets". */
  what: string;
  onRetry: () => void;
}) {
  const offline = error.status === 0 || error.status === 502;
  return (
    <StatePlaceholder
      alert
      icon={offline ? WifiOff : TriangleAlert}
      title={offline ? "Can't reach the server" : `Couldn't load ${what}`}
      action={
        <Button variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden />
          Try again
        </Button>
      }
    >
      {offline ? "Check your connection, then try again." : error.message}
    </StatePlaceholder>
  );
}
