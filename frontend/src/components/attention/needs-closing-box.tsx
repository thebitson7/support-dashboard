"use client";

import { useState } from "react";
import Link from "next/link";
import { Tabs } from "@base-ui/react/tabs";
import { ChevronDown, CircleCheck, Radio } from "lucide-react";
import { cn } from "cn";

import type { AttentionPerson, AttentionResponse, AttentionTicket } from "@/types/attention";
import {
  LEVELS,
  LEVEL_LABEL,
  ageSince,
  closeTicketHref,
  formatAgeLong,
  otherNames,
} from "@/lib/attention";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadErrorPlaceholder } from "@/components/common/state-placeholder";
import { LEVEL_STYLE, LevelBadge } from "@/components/attention/level-badge";
import { useUrgentTickets } from "@/components/attention/urgent-tickets-provider";

const LIST_LIMIT = 6;

/**
 * Home's live "Needs closing" box: the viewer's open tickets that have
 * waited too long since their last activity (admins: everyone's, by person or
 * all). Real data from /api/tickets/attention/, unlike the sample sections
 * below it, and labelled "Live" so the two can't be confused.
 */
export function NeedsClosingBox() {
  const { data, isLoading, error, refresh } = useUrgentTickets();
  const { user } = useAuth();

  return (
    <Card role="region" className="gap-4 px-5 shadow-elev-1" aria-labelledby="needs-closing-title">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 id="needs-closing-title" className="text-title flex items-center gap-2">
            Needs closing
          </h2>
          <p className="text-label">
            {data?.scope === "all"
              ? "Open tickets across the team that have waited since their last activity."
              : "Your open tickets that have waited since their last activity."}
          </p>
        </div>
        <span className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold text-status-closed ring-1 ring-status-closed/40">
          <Radio className="size-3.5" aria-hidden />
          Live
        </span>
      </header>

      {data ? (
        <>
          <LevelChips data={data} />
          {data.scope === "all" ? (
            <AdminViews data={data} />
          ) : data.total === 0 ? (
            <AllCaughtUp />
          ) : (
            <TicketList tickets={data.results} viewerId={user?.id} />
          )}
          {data.truncated && (
            <p className="text-caption">
              Showing the {data.results.length} most urgent of {data.total}.
            </p>
          )}
          <p className="text-caption border-t border-border pt-3">
            Target: close within {data.thresholds.overdue_hours} h of the last activity. No activity
            yet: {data.thresholds.no_activity_grace_hours} h more, from when it was received.
          </p>
        </>
      ) : error && !isLoading ? (
        <LoadErrorPlaceholder error={error} what="tickets waiting to be closed" onRetry={refresh} />
      ) : (
        <BoxSkeleton />
      )}
    </Card>
  );
}

function BoxSkeleton() {
  const bar = "rounded-full motion-reduce:animate-none";
  return (
    <div role="status" aria-label="Loading tickets waiting to be closed" className="grid gap-3">
      <div className="flex gap-2">
        {[24, 24, 28].map((w, i) => (
          <Skeleton key={i} className={cn(bar, "h-7")} style={{ width: `${w * 0.25}rem` }} />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-14 rounded-xl motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function AllCaughtUp() {
  return (
    <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-4 py-3 text-sm font-medium">
      <CircleCheck className="size-5 shrink-0 text-status-closed" aria-hidden />
      All caught up — nothing is waiting to be closed.
    </p>
  );
}

function LevelChips({ data }: { data: AttentionResponse }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Tickets by level">
      {LEVELS.map((level) => {
        const { icon: Icon, text, tint } = LEVEL_STYLE[level];
        const count = data.counts[level];
        return (
          <li
            key={level}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1",
              count ? cn(text, tint) : "text-muted-foreground ring-border",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {LEVEL_LABEL[level]}
            <span className="tabular-nums">{count}</span>
          </li>
        );
      })}
    </ul>
  );
}

function TicketRow({
  ticket,
  viewerId,
  admin,
}: {
  ticket: AttentionTicket;
  viewerId: number | undefined;
  admin?: boolean;
}) {
  const names = admin ? ticket.involved.map((p) => p.name) : otherNames(ticket, viewerId);
  return (
    <li>
      <Link
        href={closeTicketHref(ticket.id)}
        aria-label={`Open ticket ${ticket.cms_next_ticket_no} to close it`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2.5 ring-1 ring-border outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{ticket.cms_next_ticket_no}</span>
            <LevelBadge level={ticket.level} />
          </span>
          <span className="truncate text-sm text-muted-foreground" title={ticket.site_name}>
            {ticket.site_name} · {ticket.customer_name}
          </span>
          {names.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {admin ? "On this ticket" : "Also on this ticket"}: {names.join(", ")}
            </span>
          )}
        </span>
        <span
          className="text-xs font-medium text-muted-foreground"
          title={formatAgeLong(ticket.age_hours)}
        >
          {ageSince(ticket)}
        </span>
      </Link>
    </li>
  );
}

function TicketList({
  tickets,
  viewerId,
  admin,
  label = "Tickets waiting to be closed",
}: {
  tickets: AttentionTicket[];
  viewerId: number | undefined;
  admin?: boolean;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? tickets : tickets.slice(0, LIST_LIMIT);
  const hidden = tickets.length - shown.length;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2" aria-label={label}>
        {shown.map((t) => (
          <TicketRow key={t.id} ticket={t} viewerId={viewerId} admin={admin} />
        ))}
      </ul>
      {hidden > 0 && (
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => setExpanded(true)}>
          Show {hidden} more
        </Button>
      )}
    </div>
  );
}

const TAB_CLASS =
  "relative flex h-8 items-center rounded-full px-3.5 text-sm font-semibold whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 data-[active]:bg-primary data-[active]:text-primary-foreground text-muted-foreground hover:text-foreground data-[active]:hover:text-primary-foreground";

function AdminViews({ data }: { data: AttentionResponse }) {
  const { user } = useAuth();
  return (
    <Tabs.Root defaultValue="people" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs.List
          aria-label="Needs closing views"
          className="flex w-fit gap-1 rounded-full bg-muted/60 p-1"
        >
          <Tabs.Tab value="people" className={TAB_CLASS}>
            By Person
          </Tabs.Tab>
          <Tabs.Tab value="tickets" className={TAB_CLASS}>
            All Tickets
          </Tabs.Tab>
        </Tabs.List>
        <p className="text-caption">A ticket counts for everyone named on it.</p>
      </div>
      <Tabs.Panel value="people" className="outline-none">
        {data.total === 0 ? <AllCaughtUp /> : <PeopleList data={data} />}
      </Tabs.Panel>
      <Tabs.Panel value="tickets" className="outline-none">
        {data.total === 0 ? (
          <AllCaughtUp />
        ) : (
          <TicketList tickets={data.results} viewerId={user?.id} admin />
        )}
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function PeopleList({ data }: { data: AttentionResponse }) {
  const byId = new Map(data.results.map((t) => [t.id, t]));
  return (
    <ul className="grid gap-2" aria-label="People with tickets waiting to be closed">
      {(data.people ?? []).map((person) => (
        <PersonRow key={person.user.id} person={person} byId={byId} />
      ))}
    </ul>
  );
}

function PersonRow({
  person,
  byId,
}: {
  person: AttentionPerson;
  byId: Map<number, AttentionTicket>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `person-${person.user.id}-tickets`;
  const tickets = person.ticket_ids
    .map((id) => byId.get(id))
    .filter((t): t is AttentionTicket => Boolean(t));
  const unlisted = person.ticket_ids.length - tickets.length;
  const total = person.ticket_ids.length;

  return (
    <li className="rounded-xl ring-1 ring-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{person.user.name}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          {LEVELS.map((level) => {
            const count = person.counts[level];
            if (!count) return null;
            const { icon: Icon, text } = LEVEL_STYLE[level];
            return (
              <span key={level} className={cn("inline-flex items-center gap-1", text)}>
                <Icon className="size-3.5" aria-hidden />
                {count} {LEVEL_LABEL[level].toLowerCase()}
              </span>
            );
          })}
          <span className="sr-only">
            , {total} {total === 1 ? "ticket" : "tickets"}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div id={panelId} className="grid gap-2 border-t border-border p-2">
          <ul className="grid gap-2" aria-label={`${person.user.name}'s tickets`}>
            {tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} viewerId={undefined} admin />
            ))}
          </ul>
          {unlisted > 0 && (
            <p className="text-caption px-1">
              {unlisted} more not listed (only the {byId.size} most urgent tickets are loaded).
            </p>
          )}
        </div>
      )}
    </li>
  );
}
