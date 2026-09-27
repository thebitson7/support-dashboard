"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion, MotionConfig, useReducedMotion } from "framer-motion";
import {
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  SearchX,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import type { AdminUser } from "@/types/administration";
import { ApiError, apiPatch } from "@/lib/api";
import { displayName, type AuthUser } from "@/lib/auth";
import { formatLocalDisplay, isoToLocal } from "@/lib/local-datetime";
import { EASE } from "@/lib/motion";
import { useApiGet } from "@/hooks/use-api";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { SortIcon } from "@/components/common/sort-icon";
import { LoadErrorPlaceholder, StatePlaceholder } from "@/components/common/state-placeholder";
import { UserFormDialog } from "@/components/administration/user-form-dialog";
import { Dash, TextCell } from "@/components/tickets/cells";
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

const SEARCH_DEBOUNCE_MS = 250;

type Column = {
  id: string;
  header: string;
  /** The API's `ordering` key(s), comma-separated. */
  sortKey: string;
  className?: string;
  cell: (user: AdminUser, self: boolean) => ReactNode;
};

function RoleBadge({ role }: { role: AdminUser["role"] }) {
  const admin = role === "admin";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        admin ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {admin && <ShieldCheck className="size-3.5 text-primary" aria-hidden />}
      {admin ? "Admin" : "Staff"}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  const token = active ? "var(--chart-success)" : "var(--muted-foreground)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        color: active
          ? "color-mix(in oklab, var(--chart-success), var(--foreground) 45%)"
          : undefined,
        backgroundColor: `color-mix(in oklab, ${token} 14%, transparent)`,
      }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: token }} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

const COLUMNS: Column[] = [
  {
    id: "username",
    header: "Username",
    sortKey: "username",
    cell: (u, self) => (
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <TextCell value={u.username} mono />
        {self && (
          <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
            You
          </span>
        )}
      </span>
    ),
  },
  {
    id: "name",
    header: "Name",
    sortKey: "first_name,last_name",
    className: "min-w-[12rem]",
    cell: (u) =>
      u.first_name || u.last_name ? <TextCell value={displayName(u)} strong /> : <Dash />,
  },
  { id: "role", header: "Role", sortKey: "role", cell: (u) => <RoleBadge role={u.role} /> },
  {
    id: "timezone",
    header: "Time zone",
    sortKey: "timezone",
    className: "whitespace-nowrap",
    cell: (u) => u.timezone.replace(/_/g, " "),
  },
  {
    id: "status",
    header: "Status",
    sortKey: "is_active",
    cell: (u) => <StatusBadge active={u.is_active} />,
  },
  {
    id: "last_login",
    header: "Last sign-in",
    sortKey: "last_login",
    className: "whitespace-nowrap tabular-nums",
    cell: (u) =>
      u.last_login ? (
        formatLocalDisplay(isoToLocal(u.last_login))
      ) : (
        <span className="text-caption">Never</span>
      ),
  },
];

const orderingFor = (sortKey: string, desc: boolean) =>
  sortKey
    .split(",")
    .map((key) => `${desc ? "-" : ""}${key}`)
    .join(",");

type Toggling = { user: AdminUser; pending: boolean; error: string | null };

/**
 * Administration: every account, with Add, Edit and Deactivate/Reactivate.
 * Built like the Lookups pages (header, debounced search, sortable card
 * table, dialogs), since it's the same kind of page. Admin only: the route
 * page guards it, the nav hides it, and the API refuses anyone else.
 */
export function UsersPage({ viewer }: { viewer: AuthUser }) {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ column: "name", desc: false });
  const [form, setForm] = useState<{ open: boolean; key: number; user: AdminUser | null }>({
    open: false,
    key: 0,
    user: null,
  });
  const [toggling, setToggling] = useState<Toggling | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const sortKey = COLUMNS.find((c) => c.id === sort.column)?.sortKey ?? "first_name,last_name";
  const params = new URLSearchParams({ ordering: orderingFor(sortKey, sort.desc) });
  if (search) params.set("search", search);
  const list = useApiGet<AdminUser[]>(`/accounts/admin/users/?${params}`, {
    keepPreviousData: true,
  });
  const rows = list.data ?? [];

  const openForm = (user: AdminUser | null) =>
    setForm((f) => ({ open: true, key: f.key + 1, user }));

  async function confirmToggle() {
    if (!toggling) return;
    const { user } = toggling;
    const activate = !user.is_active;
    setToggling({ user, pending: true, error: null });
    try {
      await apiPatch(`/accounts/admin/users/${user.id}/`, { is_active: activate });
      toast.success(activate ? "User reactivated" : "User deactivated", {
        description: activate
          ? `${displayName(user)} can sign in again.`
          : `${displayName(user)} can't sign in any more and was signed out everywhere. Their history is kept.`,
      });
      setToggling(null);
      list.retry();
    } catch (err) {
      const data =
        err instanceof ApiError && err.data && typeof err.data === "object" ? err.data : null;
      const detail =
        data && "is_active" in data ? String((data as { is_active: unknown }).is_active) : null;
      setToggling({
        user,
        pending: false,
        error:
          detail ??
          (err instanceof ApiError && err.status === 429
            ? err.message
            : "Couldn't change this account. Try again."),
      });
    }
  }

  let body: ReactNode;
  if (list.error && !list.data) {
    body = <LoadErrorPlaceholder error={list.error} what="users" onRetry={list.retry} />;
  } else if (list.data && rows.length === 0) {
    body = search ? (
      <StatePlaceholder
        icon={SearchX}
        title={`No users match “${search}”`}
        action={
          <Button variant="outline" onClick={() => setQuery("")}>
            Clear search
          </Button>
        }
      >
        Try a username, first or last name.
      </StatePlaceholder>
    ) : (
      <StatePlaceholder icon={Users} title="No users yet">
        Add the first account with Add user.
      </StatePlaceholder>
    );
  } else {
    body = (
      <div
        role="region"
        aria-label="Users table"
        tabIndex={0}
        // relative: clips absolutely positioned descendants (sr-only text) too; without it they leaked out and made the page scroll sideways.
        className="scrollbar-styled relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <table
          aria-busy={list.isLoading || list.isRefreshing}
          className="w-full border-separate border-spacing-0 text-sm"
        >
          <thead>
            <tr>
              {COLUMNS.map((column) => {
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
                          : "none"
                    }
                    className="sticky top-0 z-10 border-b border-border bg-muted px-4 py-2 text-left text-[13px] font-semibold whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) =>
                          s.column === column.id
                            ? { ...s, desc: !s.desc }
                            : { column: column.id, desc: false },
                        )
                      }
                      className="-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 outline-none transition-colors duration-150 hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {column.header}
                      <SortIcon direction={direction} />
                    </button>
                  </th>
                );
              })}
              <th
                scope="col"
                className="sticky top-0 right-0 z-20 w-24 border-b border-border bg-muted px-4 py-2 text-right text-[13px] font-semibold"
              >
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {list.isLoading ? (
            <tbody>
              {Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  {Array.from({ length: COLUMNS.length + 1 }, (_, j) => (
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
              {rows.map((user) => {
                const self = user.id === viewer.id;
                const name = displayName(user);
                return (
                  <tr
                    key={user.id}
                    className={cn(
                      "group transition-colors duration-150 hover:bg-foreground/5",
                      !user.is_active && "text-muted-foreground",
                    )}
                  >
                    {COLUMNS.map((column) => (
                      <td
                        key={column.id}
                        className={cn("border-b border-border/60 px-4 py-2.5", column.className)}
                      >
                        {column.cell(user, self)}
                      </td>
                    ))}
                    <td className="sticky right-0 border-b border-border/60 bg-card px-2 py-1 text-right whitespace-nowrap shadow-[-8px_0_8px_-8px_color-mix(in_oklab,var(--foreground)_18%,transparent)] transition-colors duration-150 group-hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_5%)]">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${name}`}
                        onClick={() => openForm(user)}
                        className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        // Your own account can't be deactivated (the API refuses it too).
                        disabled={self}
                        aria-label={
                          self
                            ? "You can't deactivate your own account"
                            : `${user.is_active ? "Deactivate" : "Reactivate"} ${name}`
                        }
                        title={self ? "You can't deactivate your own account" : undefined}
                        onClick={() => setToggling({ user, pending: false, error: null })}
                        className={cn(
                          "text-muted-foreground",
                          user.is_active
                            ? "hover:bg-destructive/10 hover:text-destructive"
                            : "hover:bg-foreground/10 hover:text-foreground",
                        )}
                      >
                        {user.is_active ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
                      </Button>
                    </td>
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
    ? `${rows.length} ${rows.length === 1 ? "user" : "users"}${search ? " found" : ""}`
    : "";
  const toggleUser = toggling?.user;

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="mx-auto flex min-h-[30rem] w-full max-w-6xl flex-1 flex-col gap-5"
      >
        <div className="grid gap-3">
          <Breadcrumb items={[{ label: "Administration" }]} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Administration</h1>
              <p className="text-label">
                Accounts, roles and access. People are deactivated, never deleted.
              </p>
            </div>
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
                Add user
              </Button>
            </motion.div>
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
              placeholder="Search by username or name…"
              aria-label="Search users"
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

      <UserFormDialog
        key={form.key}
        user={form.user}
        isSelf={form.user?.id === viewer.id}
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        onSaved={list.retry}
      />

      <AlertDialog
        open={toggling !== null}
        onOpenChange={(open) => {
          if (!open && !toggling?.pending) setToggling(null);
        }}
      >
        <AlertDialogContent>
          {toggleUser && (
            <>
              <div className="grid gap-1">
                <AlertDialogTitle>
                  {toggleUser.is_active ? "Deactivate" : "Reactivate"} {displayName(toggleUser)}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {toggleUser.is_active
                    ? "They won't be able to sign in, and they're signed out everywhere. Their tickets and logged hours are kept."
                    : "They'll be able to sign in again with their existing password."}
                </AlertDialogDescription>
              </div>
              {toggling.error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-destructive/30"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  {toggling.error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <AlertDialogClose render={<Button variant="ghost" />} disabled={toggling.pending}>
                  Cancel
                </AlertDialogClose>
                <Button
                  variant={toggleUser.is_active ? "destructive" : "default"}
                  onClick={() => void confirmToggle()}
                  disabled={toggling.pending}
                >
                  {toggling.pending && (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                  )}
                  {toggleUser.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="bottom-right" />
    </MotionConfig>
  );
}
