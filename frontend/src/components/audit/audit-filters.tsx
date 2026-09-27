"use client";

import { useId, useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "cn";

import type { AdminUser } from "@/types/administration";
import type { AuditAction, AuditActionGroup } from "@/types/audit";
import { apiGet } from "@/lib/api";
import { displayName } from "@/lib/auth";
import { formatDateDisplay } from "@/lib/local-datetime";
import { EASE } from "@/lib/motion";
import { DateTimePicker } from "@/components/common/date-time-picker";
import { SearchCombobox, type ComboOption } from "@/components/common/search-combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type Target = { type: string; id: string; label: string };
export type Range = { start: string; end: string };

export type AuditFilterState = {
  query: string;
  range: Range;
  actor: ComboOption | null;
  actions: string[];
  target: Target | null;
};

async function loadUsers(query: string, signal: AbortSignal): Promise<ComboOption[]> {
  // Every account, staff and admins, active or not: anyone can appear in the log.
  const params = new URLSearchParams({ ordering: "first_name,last_name" });
  if (query) params.set("search", query);
  const users = await apiGet<AdminUser[]>(`/accounts/admin/users/?${params}`, { signal });
  return users.map((u) => ({
    value: String(u.id),
    label: displayName(u),
    description: `@${u.username}${u.role === "admin" ? " · admin" : ""}${u.is_active ? "" : " · inactive"}`,
  }));
}

/** "Ticket closed", "Signed in, Signed out", or "6 actions". */
function actionSummary(selected: string[], actions: AuditAction[]) {
  const labels = selected.map((v) => actions.find((a) => a.value === v)?.label ?? v);
  return labels.length <= 2 ? labels.join(", ") : `${labels.length} actions`;
}

/** Multi-select of actions, grouped the way the API groups them. Empty = every action. */
function ActionFilter({
  id,
  actions,
  selected,
  onChange,
}: {
  id: string;
  actions: AuditAction[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<AuditActionGroup, AuditAction[]>();
    for (const a of actions) map.set(a.group, [...(map.get(a.group) ?? []), a]);
    return [...map];
  }, [actions]);
  const chosen = new Set(selected);
  const toggle = (values: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const v of values) {
      if (on) next.add(v);
      else next.delete(v);
    }
    // Keep the API's order so the query string (and the request) is stable.
    onChange(actions.map((a) => a.value).filter((v) => next.has(v)));
  };
  const summary = selected.length ? actionSummary(selected, actions) : "All actions";

  return (
    <Popover modal="trap-focus">
      <PopoverTrigger
        id={id}
        render={
          <Button
            variant="outline"
            className={cn(
              "h-9 w-full justify-between rounded-lg border-control bg-card px-2.5 font-normal dark:bg-input/30",
              !selected.length && "text-muted-foreground",
            )}
          />
        }
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1 p-1.5">
        <div className="scrollbar-styled max-h-80 overflow-y-auto">
          {groups.map(([group, items]) => {
            const values = items.map((a) => a.value);
            const count = values.filter((v) => chosen.has(v)).length;
            return (
              <fieldset key={group} className="grid py-1">
                <legend className="sr-only">{group}</legend>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:bg-foreground/5">
                  <Checkbox
                    checked={count === values.length}
                    indeterminate={count > 0 && count < values.length}
                    onCheckedChange={(on) => toggle(values, on)}
                  />
                  {group}
                </label>
                {items.map((a) => (
                  <label
                    key={a.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-7 text-sm hover:bg-foreground/5"
                  >
                    <Checkbox
                      checked={chosen.has(a.value)}
                      onCheckedChange={(on) => toggle([a.value], on)}
                    />
                    {a.label}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        <div className="flex justify-between gap-2 border-t border-border pt-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={!selected.length}
            onClick={() => onChange([])}
          >
            Clear
          </Button>
          <PopoverClose render={<Button size="sm" />}>Done</PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Chip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent py-0.5 pr-1 pl-2.5 text-sm text-accent-foreground">
      <span className="truncate">
        <span className="opacity-75">{label}:</span> <span className="font-semibold">{value}</span>
      </span>
      <button
        type="button"
        aria-label={`Remove filter ${label}: ${value}`}
        onClick={onRemove}
        className="grid size-5 shrink-0 place-items-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/**
 * The Audit Log toolbar, in three tiers:
 * 1. primary: search and the date range, always visible;
 * 2. secondary: user and action, behind a "Filters" disclosure (like AMS
 *    Tickets' Advanced Search), with a count of what's set inside it;
 * 3. a summary line: every active filter as a removable chip + Clear all,
 *    and the result count, so what's applied is readable at a glance.
 */
export function AuditFilters({
  state,
  defaults,
  actions,
  panelOpen,
  onPanelOpenChange,
  onChange,
  onClearAll,
  problem,
  count,
}: {
  state: AuditFilterState;
  defaults: Range;
  actions: AuditAction[];
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<AuditFilterState>) => void;
  onClearAll: () => void;
  /** Why the date range can't be used, if it can't. */
  problem: string | null;
  /** Matching entries, once loaded. */
  count: number | undefined;
}) {
  const ids = {
    from: useId(),
    to: useId(),
    problem: useId(),
    user: useId(),
    action: useId(),
    panel: useId(),
  };
  const { range, actor, actions: selected, target, query } = state;
  const customRange = range.start !== defaults.start || range.end !== defaults.end;
  const panelCount = (actor ? 1 : 0) + (selected.length ? 1 : 0);

  const chips: ReactNode[] = [];
  const search = query.trim();
  if (search)
    chips.push(
      <Chip
        key="q"
        label="Search"
        value={`“${search}”`}
        onRemove={() => onChange({ query: "" })}
      />,
    );
  if (customRange && range.start && range.end) {
    chips.push(
      <Chip
        key="dates"
        label="Dates"
        value={`${formatDateDisplay(range.start)} – ${formatDateDisplay(range.end)}`}
        onRemove={() => onChange({ range: defaults })}
      />,
    );
  }
  if (actor)
    chips.push(
      <Chip
        key="user"
        label="User"
        value={actor.label}
        onRemove={() => onChange({ actor: null })}
      />,
    );
  if (selected.length) {
    chips.push(
      <Chip
        key="action"
        label="Action"
        value={actionSummary(selected, actions)}
        onRemove={() => onChange({ actions: [] })}
      />,
    );
  }
  if (target)
    chips.push(
      <Chip
        key="target"
        label="Target"
        value={target.label}
        onRemove={() => onChange({ target: null })}
      />,
    );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="relative w-full max-w-md min-w-60 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => onChange({ query: e.target.value })}
            placeholder="Search the log…"
            aria-label="Search the audit log"
            spellCheck={false}
            className="h-9 bg-card pl-9 shadow-elev-1"
          />
        </div>

        <div role="group" aria-label="Date range" className="flex items-center gap-1.5">
          <span id={ids.from} className="sr-only">
            From
          </span>
          <div className="w-40">
            <DateTimePicker
              mode="date"
              value={range.start}
              onChange={(start) => onChange({ range: { ...range, start } })}
              invalid={Boolean(problem)}
              aria-labelledby={ids.from}
              aria-describedby={problem ? ids.problem : undefined}
            />
          </div>
          <span aria-hidden className="text-muted-foreground">
            –
          </span>
          <span id={ids.to} className="sr-only">
            To
          </span>
          <div className="w-40">
            <DateTimePicker
              mode="date"
              value={range.end}
              onChange={(end) => onChange({ range: { ...range, end } })}
              invalid={Boolean(problem)}
              aria-labelledby={ids.to}
              aria-describedby={problem ? ids.problem : undefined}
            />
          </div>
        </div>

        <Button
          variant="outline"
          aria-expanded={panelOpen}
          aria-controls={panelOpen ? ids.panel : undefined}
          onClick={() => onPanelOpenChange(!panelOpen)}
          className={cn("h-9 gap-2 bg-card", panelOpen && "bg-accent text-accent-foreground")}
        >
          <SlidersHorizontal aria-hidden />
          Filters
          {panelCount > 0 && (
            <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums">
              {panelCount}
            </span>
          )}
          <ChevronDown
            aria-hidden
            className={cn(
              "text-muted-foreground transition-transform duration-200",
              panelOpen && "rotate-180",
            )}
          />
        </Button>
      </div>

      {problem && (
        <p id={ids.problem} role="alert" className="-mt-1 text-sm font-medium text-destructive">
          {problem}
        </p>
      )}

      <AnimatePresence initial={false}>
        {panelOpen && (
          <motion.div
            id={ids.panel}
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            {/* padding lives inside so the shadow isn't clipped by the height animation */}
            <div className="p-1">
              <div className="grid gap-4 rounded-xl bg-card p-4 shadow-elev-1 ring-1 ring-foreground/10 sm:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,18rem))]">
                <div className="grid gap-1.5">
                  <label htmlFor={ids.user} className="text-caption font-medium">
                    User
                  </label>
                  <SearchCombobox
                    id={ids.user}
                    value={actor}
                    onChange={(option) => onChange({ actor: option })}
                    loadOptions={loadUsers}
                    placeholder="Anyone"
                    emptyText="No users match."
                    clearable
                  />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={ids.action} className="text-caption font-medium">
                    Action
                  </label>
                  <ActionFilter
                    id={ids.action}
                    actions={actions}
                    selected={selected}
                    onChange={(next) => onChange({ actions: next })}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {chips.length ? (
            <>
              {chips}
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAll}
                className="text-muted-foreground"
              >
                Clear all
              </Button>
            </>
          ) : (
            <p className="text-label">Everyone, every action, the last 30 days.</p>
          )}
        </div>
        <p className="text-label tabular-nums" aria-live="polite">
          {count === undefined
            ? ""
            : `${count.toLocaleString("en-US")} ${count === 1 ? "entry" : "entries"}`}
        </p>
      </div>
    </div>
  );
}
