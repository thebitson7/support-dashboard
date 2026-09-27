"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion, MotionConfig } from "framer-motion";
import { FilterX, History, SearchX } from "lucide-react";

import type { AdminUser } from "@/types/administration";
import type { AuditAction, AuditPage } from "@/types/audit";
import { displayName, initials, type AuthUser } from "@/lib/auth";
import { addDaysToDate, todayInZone } from "@/lib/local-datetime";
import { EASE } from "@/lib/motion";
import { useApiGet } from "@/hooks/use-api";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { ExportButton } from "@/components/common/export-button";
import { LoadErrorPlaceholder, StatePlaceholder } from "@/components/common/state-placeholder";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";

import { AuditFilters, type AuditFilterState } from "./audit-filters";
import { AuditTable, PAGE_SIZE, type Person, type Sort } from "./audit-table";

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_DAYS = 30;

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Audit Log: every recorded sign-in, ticket, hours, lookup and account
 * change, newest first, filterable by dates / text (always visible) and by
 * user / action (the Filters panel) or a target (from a row), with a CSV
 * export of the same view. Admin only: the route page guards it, the nav
 * hides it, and the API refuses anyone else.
 */
export function AuditLogPage({ viewer }: { viewer: AuthUser }) {
  // The API reads the dates as whole days in the admin's profile zone.
  const defaults = useMemo(() => {
    const end = todayInZone(viewer.timezone);
    return { start: addDaysToDate(end, -(DEFAULT_DAYS - 1)), end };
  }, [viewer.timezone]);

  const [filters, setFilters] = useState<AuditFilterState>({
    query: "",
    range: defaults,
    actor: null,
    actions: [],
    target: null,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>({ column: "created_at", desc: true });
  const change = (patch: Partial<AuditFilterState>) => setFilters((f) => ({ ...f, ...patch }));

  useEffect(() => {
    const id = setTimeout(() => setSearch(filters.query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filters.query]);

  const actionList = useApiGet<AuditAction[]>("/audit/logs/actions/");
  // Current names for the Who column (entries snapshot only the username).
  const users = useApiGet<AdminUser[]>("/accounts/admin/users/?ordering=first_name,last_name");
  const people = useMemo(
    () =>
      new Map<number, Person>(
        (users.data ?? []).map((u) => [u.id, { name: displayName(u), initials: initials(u) }]),
      ),
    [users.data],
  );

  const { range, actor, actions, target } = filters;
  const problem =
    !range.start || !range.end
      ? "Pick both dates."
      : range.start > range.end
        ? "The start date is after the end date."
        : null;

  const params = new URLSearchParams({
    start_date: range.start,
    end_date: range.end,
    ordering: `${sort.desc ? "-" : ""}${sort.column}`,
  });
  if (actor) params.set("actor", actor.value);
  if (actions.length) params.set("action", actions.join(","));
  if (target) {
    params.set("target_type", target.type);
    params.set("target_id", target.id);
  }
  if (search) params.set("search", search);
  const filterKey = params.toString();

  // Any change to the filters or the order goes back to page 1.
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;

  const listParams = new URLSearchParams(params);
  listParams.set("page", String(page));
  listParams.set("page_size", String(PAGE_SIZE));
  const list = useApiGet<AuditPage>(problem ? null : `/audit/logs/?${listParams}`, {
    keepPreviousData: true,
  });
  const rows = list.data?.results ?? [];

  const exportParams = new URLSearchParams(params);
  exportParams.set("tz", browserZone());

  const filtered =
    Boolean(actor || actions.length || target || search) ||
    range.start !== defaults.start ||
    range.end !== defaults.end;
  const clearAll = () => {
    setFilters({ query: "", range: defaults, actor: null, actions: [], target: null });
    setSearch("");
  };

  let body: ReactNode;
  if (problem) {
    body = (
      <StatePlaceholder icon={FilterX} title="Check the dates">
        {problem}
      </StatePlaceholder>
    );
  } else if (list.error && !list.data) {
    body = <LoadErrorPlaceholder error={list.error} what="the audit log" onRetry={list.retry} />;
  } else if (list.data && rows.length === 0) {
    body = filtered ? (
      <StatePlaceholder
        icon={SearchX}
        title="No entries match these filters"
        action={
          <Button variant="outline" onClick={clearAll}>
            Clear all filters
          </Button>
        }
      >
        Try a wider date range or fewer filters.
      </StatePlaceholder>
    ) : (
      <StatePlaceholder icon={History} title="Nothing recorded in the last 30 days">
        Sign-ins, ticket changes, hours, lookups and account changes appear here as they happen.
      </StatePlaceholder>
    );
  } else {
    body = (
      <AuditTable
        rows={rows}
        count={list.data?.count}
        page={page}
        onPage={(next) => setPaging({ key: filterKey, page: next })}
        sort={sort}
        onSort={setSort}
        people={people}
        onTarget={(next) => change({ target: next })}
        loading={list.isLoading}
        refreshing={list.isRefreshing}
        fetchedAt={list.fetchedAt}
      />
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="mx-auto flex min-h-[30rem] w-full max-w-6xl flex-1 flex-col gap-5"
      >
        <div className="grid gap-3">
          <Breadcrumb items={[{ label: "Audit Log" }]} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Audit Log</h1>
              <p className="text-label">Who did what, and when. Entries are never edited.</p>
            </div>
            <ExportButton
              path={`/audit/logs/export/?${exportParams}`}
              fallbackName={`audit-log_${range.start}_${range.end}.csv`}
              disabled={Boolean(problem) || !list.data || list.data.count === 0}
            />
          </div>
        </div>

        <AuditFilters
          state={filters}
          defaults={defaults}
          actions={actionList.data ?? []}
          panelOpen={panelOpen}
          onPanelOpenChange={setPanelOpen}
          onChange={change}
          onClearAll={clearAll}
          problem={problem}
          count={problem ? undefined : list.data?.count}
        />

        <Card className="-mt-2 min-h-0 flex-1 gap-0 overflow-hidden py-0 shadow-elev-1">
          {body}
        </Card>
      </motion.div>
      <Toaster position="bottom-right" />
    </MotionConfig>
  );
}
