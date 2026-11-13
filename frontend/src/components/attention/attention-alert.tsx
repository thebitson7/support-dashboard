"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing } from "lucide-react";
import { cn } from "cn";

import type { AttentionResponse } from "@/types/attention";
import {
  LEVELS,
  LEVEL_LABEL,
  acknowledge,
  closeTicketHref,
  ageSince,
  formatAgeLong,
  formatTarget,
  isAcknowledged,
  otherNames,
  shouldShowDialog,
} from "@/lib/attention";
import { useAuth } from "@/lib/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LEVEL_STYLE, LevelBadge } from "@/components/attention/level-badge";
import { useUrgentTickets } from "@/components/attention/urgent-tickets-provider";

const STAFF_LIMIT = 8;
const PEOPLE_LIMIT = 6;
const ACK_BUTTON_ID = "attention-alert-ack";

/**
 * The sign-in alert: once per tab session (and again after each new
 * sign-in), only when the viewer has an overdue or critical ticket. Staff
 * see their tickets with a "Close ticket" shortcut; admins see the team
 * summary. Escape or "I understand" acknowledges it; clicking outside
 * doesn't dismiss it.
 */
export function AttentionAlert() {
  const { data } = useUrgentTickets();
  const { user } = useAuth();
  const [acked, setAcked] = useState(isAcknowledged);
  const open = shouldShowDialog(data, acked);

  const dismiss = () => {
    acknowledge();
    setAcked(true);
  };

  if (!data || !user) return null;
  const isAdmin = data.scope === "all";

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) dismiss(); // Escape
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] motion-reduce:transition-none"
        initialFocus={() => document.getElementById(ACK_BUTTON_ID)}
      >
        <header className="flex items-start gap-3 border-b border-border px-6 pt-5 pb-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-attention-overdue/12 text-attention-overdue">
            <BellRing className="size-5" aria-hidden />
          </span>
          <div className="grid gap-1">
            <DialogTitle>Tickets waiting to be closed</DialogTitle>
            <DialogDescription>
              Tickets should be closed within {formatTarget(data.thresholds.overdue_hours)} of the
              last activity.
            </DialogDescription>
          </div>
        </header>

        <div className="scrollbar-styled min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {isAdmin ? (
            <TeamSummary data={data} onNavigate={dismiss} />
          ) : (
            <StaffList data={data} viewerId={user.id} onNavigate={dismiss} />
          )}
        </div>

        <footer className="flex justify-end border-t border-border bg-muted/40 px-6 py-3">
          <Button id={ACK_BUTTON_ID} onClick={dismiss} className="min-w-32">
            I understand
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function StaffList({
  data,
  viewerId,
  onNavigate,
}: {
  data: AttentionResponse;
  viewerId: number;
  onNavigate: () => void;
}) {
  // The alert is about overdue and critical tickets; due-soon ones live on Home.
  const urgent = data.results.filter((t) => t.level !== "due_soon");
  const shown = urgent.slice(0, STAFF_LIMIT);
  const urgentTotal = data.counts.overdue + data.counts.critical;
  const more = urgentTotal - shown.length;

  return (
    <div className="grid gap-3">
      <p className="text-sm">
        You have <strong>{urgentTotal}</strong> {urgentTotal === 1 ? "ticket" : "tickets"} past the
        target:
      </p>
      <ul className="grid gap-2" aria-label="Your tickets waiting to be closed">
        {shown.map((ticket) => {
          const others = otherNames(ticket, viewerId);
          return (
            <li
              key={ticket.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 ring-1 ring-border"
            >
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {ticket.cms_next_ticket_no}
                  </span>
                  <LevelBadge level={ticket.level} />
                </div>
                <p className="truncate text-sm text-muted-foreground" title={ticket.site_name}>
                  {ticket.site_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span title={formatAgeLong(ticket.age_hours)}>{ageSince(ticket)}</span>
                </p>
                {others.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Also on this ticket: {others.join(", ")}
                  </p>
                )}
              </div>
              <Link
                href={closeTicketHref(ticket.id)}
                onClick={onNavigate}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
                aria-label={`Close ticket ${ticket.cms_next_ticket_no}`}
              >
                Close ticket
              </Link>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <Link
          href="/"
          onClick={onNavigate}
          className="inline-flex w-fit items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline"
        >
          +{more} more on Home
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function TeamSummary({ data, onNavigate }: { data: AttentionResponse; onNavigate: () => void }) {
  const people = (data.people ?? [])
    .filter((p) => p.counts.critical + p.counts.overdue > 0)
    .slice(0, PEOPLE_LIMIT);

  return (
    <div className="grid gap-4">
      <div>
        <p className="mb-2 text-sm font-semibold">Team summary</p>
        <ul className="flex flex-wrap gap-2" aria-label="Open tickets by level">
          {LEVELS.map((level) => {
            const { icon: Icon, text, tint } = LEVEL_STYLE[level];
            return (
              <li
                key={level}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1",
                  text,
                  tint,
                )}
              >
                <Icon className="size-4" aria-hidden />
                {LEVEL_LABEL[level]}: <span className="tabular-nums">{data.counts[level]}</span>
              </li>
            );
          })}
        </ul>
      </div>
      {people.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Who has tickets past the target</p>
          <ul className="grid gap-1.5">
            {people.map((p) => (
              <li
                key={p.user.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-border"
              >
                <span className="min-w-0 truncate text-sm font-medium">{p.user.name}</span>
                <span className="flex gap-3 text-sm">
                  <span className={LEVEL_STYLE.critical.text}>
                    {p.counts.critical} {LEVEL_LABEL.critical.toLowerCase()}
                  </span>
                  <span className={LEVEL_STYLE.overdue.text}>
                    {p.counts.overdue} {LEVEL_LABEL.overdue.toLowerCase()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            A ticket counts for everyone named on it.
          </p>
        </div>
      )}
      <Link
        href="/"
        onClick={onNavigate}
        className="inline-flex w-fit items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline"
      >
        View all on Home
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
