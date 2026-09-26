"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { motion, MotionConfig, useReducedMotion } from "framer-motion";
import {
  ChevronRight,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  SearchX,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { ApiError, apiDelete } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EASE } from "@/lib/motion";
import { useApiGet } from "@/hooks/use-api";
import { SortIcon } from "@/components/common/sort-icon";
import { LoadErrorPlaceholder, StatePlaceholder } from "@/components/common/state-placeholder";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { LookupFormDialog, capitalize } from "@/components/lookups/lookup-form-dialog";
import type { LookupConfig, LookupRow } from "@/components/lookups/types";

const SEARCH_DEBOUNCE_MS = 250;

const alignClass = (align?: "center" | "right") =>
  align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

/** Column `sortKey` ("month,day") + direction -> the API's `ordering` ("-month,-day"). */
const orderingFor = (sortKey: string, desc: boolean) =>
  sortKey
    .split(",")
    .map((key) => `${desc ? "-" : ""}${key.trim()}`)
    .join(",");

type DeleteState<Row> = {
  row: Row;
  pending: boolean;
  /** Set when the API refused (409 in use, or another failure). */
  error: string | null;
  inUse: boolean;
};

/**
 * A complete reference-data page for one entity: header, debounced search,
 * sortable table, add/edit dialog and delete confirmation. Anyone signed in
 * can view; only admins see Add / Edit / Delete (the API enforces the same).
 */
export function LookupPage<Row extends LookupRow>({ config }: { config: LookupConfig<Row> }) {
  const { user } = useAuth();
  const canManage = user?.role === "admin";
  const reduce = useReducedMotion();

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({
    column: config.defaultSort.column,
    desc: config.defaultSort.desc ?? false,
  });
  const [form, setForm] = useState<{ open: boolean; key: number; row: Row | null }>({
    open: false,
    key: 0,
    row: null,
  });
  const [deleting, setDeleting] = useState<DeleteState<Row> | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const sortKey = config.columns.find((c) => c.id === sort.column)?.sortKey;
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (sortKey) params.set("ordering", orderingFor(sortKey, sort.desc));
  const list = useApiGet<Row[]>(`${config.endpoint}?${params}`, { keepPreviousData: true });
  const rows = list.data ?? [];

  const openForm = (row: Row | null) => setForm((f) => ({ open: true, key: f.key + 1, row }));

  async function confirmDelete() {
    if (!deleting) return;
    const { row } = deleting;
    setDeleting({ ...deleting, pending: true, error: null });
    try {
      await apiDelete(`${config.endpoint}${row.id}/`);
      toast.success(`${capitalize(config.noun)} deleted`, { description: config.rowLabel(row) });
      setDeleting(null);
      list.retry();
    } catch (err) {
      const inUse = err instanceof ApiError && err.status === 409;
      setDeleting({
        row,
        pending: false,
        inUse,
        error:
          err instanceof ApiError && (err.status === 409 || err.status === 403)
            ? err.message
            : `Couldn't delete this ${config.noun}. Try again.`,
      });
    }
  }

  const columnCount = config.columns.length + (canManage ? 1 : 0);

  let body: ReactNode;
  if (list.error && !list.data) {
    body = (
      <LoadErrorPlaceholder error={list.error} what={config.nounPlural} onRetry={list.retry} />
    );
  } else if (list.data && rows.length === 0) {
    body = search ? (
      <StatePlaceholder
        icon={SearchX}
        title={`No ${config.nounPlural} match “${search}”`}
        action={
          <Button variant="outline" onClick={() => setQuery("")}>
            Clear search
          </Button>
        }
      >
        Try a different keyword.
      </StatePlaceholder>
    ) : (
      <StatePlaceholder
        icon={config.emptyIcon}
        title={`No ${config.nounPlural} yet`}
        action={
          canManage && (
            <Button onClick={() => openForm(null)}>
              <Plus aria-hidden />
              Add your first {config.noun}
            </Button>
          )
        }
      >
        {canManage
          ? `${capitalize(config.nounPlural)} you add will show up here.`
          : `An admin hasn't added any ${config.nounPlural} yet.`}
      </StatePlaceholder>
    );
  } else {
    body = (
      <div
        role="region"
        aria-label={`${config.title} table`}
        tabIndex={0}
        className="scrollbar-styled min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <table
          aria-busy={list.isLoading || list.isRefreshing}
          className="w-full border-separate border-spacing-0 text-sm"
        >
          <thead>
            <tr>
              {config.columns.map((column) => {
                const active = sort.column === column.id;
                const direction = active ? (sort.desc ? "desc" : "asc") : false;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : column.sortKey
                            ? "none"
                            : undefined
                    }
                    className={cn(
                      "sticky top-0 z-10 border-b border-border bg-muted px-4 py-2 text-[13px] font-semibold whitespace-nowrap",
                      alignClass(column.align),
                      column.className,
                    )}
                  >
                    {column.sortKey ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSort((s) =>
                            s.column === column.id
                              ? { ...s, desc: !s.desc }
                              : { column: column.id, desc: false },
                          )
                        }
                        className={cn(
                          "-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 outline-none transition-colors duration-150 hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.header}
                        <SortIcon direction={direction} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {canManage && (
                <th
                  scope="col"
                  className="sticky top-0 z-10 w-24 border-b border-border bg-muted px-4 py-2 text-right text-[13px] font-semibold"
                >
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          {list.isLoading ? (
            <tbody>
              {Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  {Array.from({ length: columnCount }, (_, j) => (
                    <td key={j} className="border-b border-border/60 px-4 py-3">
                      <Skeleton className="h-4 w-24 rounded-full motion-reduce:animate-none" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : (
            <motion.tbody
              key={list.fetchedAt?.getTime()}
              initial={{ opacity: reduce ? 1 : 0.35 }}
              animate={{ opacity: list.isRefreshing ? 0.55 : 1 }}
              transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
            >
              {rows.map((row) => {
                const label = config.rowLabel(row);
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "transition-colors duration-150 hover:bg-foreground/5",
                      config.isDimmed?.(row) && "text-muted-foreground",
                    )}
                  >
                    {config.columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          "border-b border-border/60 px-4 py-2.5",
                          alignClass(column.align),
                          column.className,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                    {canManage && (
                      <td className="border-b border-border/60 px-2 py-1 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${label}`}
                          onClick={() => openForm(row)}
                          className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${label}`}
                          onClick={() =>
                            setDeleting({ row, pending: false, error: null, inUse: false })
                          }
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </motion.tbody>
          )}
        </table>
      </div>
    );
  }

  const countText = list.data
    ? `${rows.length} ${rows.length === 1 ? config.noun : config.nounPlural}${search ? " found" : ""}`
    : "";

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="mx-auto flex min-h-[30rem] w-full max-w-6xl flex-1 flex-col gap-5"
      >
        <div className="grid gap-3">
          <nav aria-label="Breadcrumb">
            <ol className="text-label flex items-center gap-1.5">
              <li>
                <Link
                  href="/"
                  className="rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Home
                </Link>
              </li>
              <li aria-hidden className="flex">
                <ChevronRight className="size-4" strokeWidth={2} />
              </li>
              <li>Lookups</li>
              <li aria-hidden className="flex">
                <ChevronRight className="size-4" strokeWidth={2} />
              </li>
              <li aria-current="page" className="font-semibold text-foreground">
                {config.title}
              </li>
            </ol>
          </nav>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">{config.title}</h1>
              <p className="text-label">{config.description}</p>
            </div>
            {canManage ? (
              <motion.div
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.16, ease: EASE }}
              >
                <Button
                  size="lg"
                  onClick={() => openForm(null)}
                  className="h-10 gap-2 rounded-full px-5 font-semibold shadow-elev-1 transition-shadow duration-200 hover:bg-primary hover:shadow-elev-hover"
                >
                  <Plus className="size-4.5" strokeWidth={2.5} aria-hidden />
                  Add {config.noun}
                </Button>
              </motion.div>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                <Eye className="size-3.5" aria-hidden />
                View only
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="relative w-full max-w-md flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={config.searchPlaceholder}
              aria-label={`Search ${config.nounPlural}`}
              spellCheck={false}
              className="h-10 bg-card pl-9 shadow-elev-1"
            />
          </div>
          <p className="text-label tabular-nums" aria-live="polite">
            {countText}
          </p>
        </div>

        <Card className="min-h-0 flex-1 gap-0 py-0 shadow-elev-1">{body}</Card>
      </motion.div>

      {canManage && (
        <LookupFormDialog
          key={form.key}
          config={config}
          row={form.row}
          open={form.open}
          onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
          onSaved={list.retry}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleting?.pending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          {deleting && (
            <>
              <div className="grid gap-1">
                <AlertDialogTitle>
                  Delete {config.noun} “{config.rowLabel(deleting.row)}”?
                </AlertDialogTitle>
                <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
              </div>
              {deleting.error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-destructive/30"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  {deleting.error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <AlertDialogClose render={<Button variant="ghost" />} disabled={deleting.pending}>
                  {deleting.inUse ? "Close" : "Cancel"}
                </AlertDialogClose>
                {deleting.inUse ? (
                  config.deactivateField && (
                    <Button
                      onClick={() => {
                        const row = deleting.row;
                        setDeleting(null);
                        openForm(row);
                      }}
                    >
                      <Pencil aria-hidden />
                      Edit to deactivate
                    </Button>
                  )
                ) : (
                  <Button variant="destructive" onClick={confirmDelete} disabled={deleting.pending}>
                    {deleting.pending && (
                      <LoaderCircle
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                    )}
                    Delete
                  </Button>
                )}
              </div>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="bottom-right" />
    </MotionConfig>
  );
}
