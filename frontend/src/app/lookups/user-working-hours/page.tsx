"use client";

import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ClipboardList,
  Clock,
  RotateCw,
  ShieldAlert,
  TriangleAlert,
  UserRound,
  UserX,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";

import type { StaffUser, WorkingHoursSummary } from "@/types/working-hours";
import type { ApiError } from "@/lib/api";
import { displayName, useAuth } from "@/lib/auth";
import { EASE, markChoreographyStart } from "@/lib/motion";
import { toPeriodSummary, userQuery } from "@/lib/working-hours";
import { useApiGet } from "@/hooks/use-api";
import { PeriodCardsSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { MotionRoot } from "@/components/dashboard/motion-root";
import { PeriodCards } from "@/components/dashboard/period-cards";
import { UserPicker } from "@/components/working-hours/user-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.16, ease: EASE },
};

// --- Error / empty states -----------------------------------------------------

type Tone = "neutral" | "danger";

type ErrorView = {
  icon: LucideIcon;
  title: string;
  message: string;
  tone: Tone;
  /** Retrying only helps when the failure might be transient. */
  retryable: boolean;
};

/** Each failure gets its own icon, title and tone so they can't be mistaken for each other. */
function errorView(error: ApiError, subject: string): ErrorView {
  if (error.status === 0 || error.status === 502 || error.status === 503) {
    return {
      icon: WifiOff,
      title: "Can't reach the server",
      message: "Check your connection, then try again.",
      tone: "neutral",
      retryable: true,
    };
  }
  if (error.status === 403) {
    return {
      icon: ShieldAlert,
      title: "Access denied",
      message: `You don't have permission to view ${subject}.`,
      tone: "danger",
      retryable: false,
    };
  }
  if (error.status === 404) {
    return {
      icon: UserX,
      title: "User not found",
      message:
        "This account doesn't exist or has been deactivated. Choose someone else from the Viewing menu.",
      tone: "neutral",
      retryable: false,
    };
  }
  return {
    icon: TriangleAlert,
    title: `Couldn't load ${subject}`,
    message: error.message || "The server returned an unexpected error.",
    tone: "danger",
    retryable: true,
  };
}

function StateCard({
  icon: Icon,
  title,
  children,
  action,
  tone = "neutral",
  alert,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  alert?: boolean;
}) {
  return (
    <Card
      role={alert ? "alert" : undefined}
      className={cn(
        "items-center gap-4 px-6 py-12 text-center shadow-elev-1",
        tone === "danger" && "ring-destructive/30",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-14 place-items-center rounded-full",
          tone === "danger"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-7" strokeWidth={2} />
      </span>
      <div className="grid max-w-sm gap-1">
        <h2 className="text-title">{title}</h2>
        <p className="text-label">{children}</p>
      </div>
      {action}
    </Card>
  );
}

function ErrorCard({
  error,
  subject,
  onRetry,
}: {
  error: ApiError;
  subject: string;
  onRetry: () => void;
}) {
  const view = errorView(error, subject);
  return (
    <StateCard
      alert
      icon={view.icon}
      title={view.title}
      tone={view.tone}
      action={
        view.retryable && (
          <Button variant="outline" onClick={onRetry}>
            <RotateCw aria-hidden />
            Try again
          </Button>
        )
      }
    >
      {view.message}
    </StateCard>
  );
}

// --- Summary ------------------------------------------------------------------

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * "As of 3:42 PM" + the zone the periods were cut in + a manual refresh. The
 * API always uses the viewer's own zone (for admins too, whoever they view).
 */
function FreshnessBar({
  fetchedAt,
  timezone,
  refreshing,
  onRefresh,
}: {
  fetchedAt: Date;
  timezone: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="text-caption flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5" role="status">
        <Clock className="size-3.5" aria-hidden />
        <span>
          As of <time dateTime={fetchedAt.toISOString()}>{timeFormat.format(fetchedAt)}</time>
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
          days counted in your time zone ({timezone.replace(/_/g, " ")})
        </span>
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        className="text-muted-foreground"
      >
        <RotateCw
          aria-hidden
          className={cn(refreshing && "animate-spin motion-reduce:animate-none")}
        />
        {refreshing ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}

/** Restarts the entrance cascade each time a (new) summary mounts. */
function SummaryCards({ summary }: { summary: WorkingHoursSummary }) {
  useLayoutEffect(() => markChoreographyStart(), []);
  const periods = useMemo(() => summary.periods.map(toPeriodSummary), [summary]);
  return <PeriodCards periods={periods} />;
}

type SummaryResult = ReturnType<typeof useApiGet<WorkingHoursSummary>>;

function Summary({ path, summary }: { path: string; summary: SummaryResult }) {
  const { data, error, fetchedAt, isLoading, isRefreshing, retry } = summary;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {isLoading ? (
        <motion.div
          key={`loading-${path}`}
          {...fade}
          role="status"
          aria-busy="true"
          aria-label="Loading working hours"
        >
          <PeriodCardsSkeleton />
        </motion.div>
      ) : error ? (
        <motion.div key={`error-${path}`} {...fade}>
          <ErrorCard error={error} subject="these working hours" onRetry={retry} />
        </motion.div>
      ) : data && fetchedAt ? (
        // Keyed by the *response's* user as well as the path, so cards can
        // never be reused across two different people's numbers.
        <motion.div key={`data-${path}-${data.user.id}`} {...fade} className="flex flex-col gap-3">
          <FreshnessBar
            fetchedAt={fetchedAt}
            timezone={data.timezone}
            refreshing={isRefreshing}
            onRefresh={retry}
          />
          <SummaryCards summary={data} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// --- One person's hours ----------------------------------------------------------

/**
 * Everything below the page title for one person: their period summary.
 * The day-by-day detail, and logging hours, live on the Job Sheet page,
 * which `header` receives a link to (null until there's someone to show).
 */
function HoursWorkspace({
  userId,
  enabled,
  header,
  placeholder,
}: {
  /** Whose hours (admin view); null = the signed-in user's own. */
  userId: string | null;
  enabled: boolean;
  header: (jobSheetLink: ReactNode) => ReactNode;
  /** Shown instead of the summary while `enabled` is false. */
  placeholder?: ReactNode;
}) {
  const summaryPath = `/working-hours/summary/${userQuery(userId)}`;
  const summary = useApiGet<WorkingHoursSummary>(enabled ? summaryPath : null);
  const jobSheetHref = userId
    ? `/job-sheets?${new URLSearchParams({ user_id: userId })}`
    : "/job-sheets";

  const jobSheetLink = enabled ? (
    <Link href={jobSheetHref} className={buttonVariants({ variant: "outline", size: "lg" })}>
      <ClipboardList aria-hidden />
      View Job Sheet
    </Link>
  ) : null;

  return (
    <>
      {header(jobSheetLink)}
      {enabled ? <Summary path={summaryPath} summary={summary} /> : placeholder}
    </>
  );
}

// --- Views --------------------------------------------------------------------

function AdminView() {
  const users = useApiGet<StaffUser[]>("/working-hours/users/");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = users.data?.find((u) => String(u.id) === selectedId);

  return (
    <>
      {/* One workspace whether or not anyone is picked, so the picker in its
          header is never remounted by the first selection. */}
      <HoursWorkspace
        userId={selectedId}
        enabled={Boolean(selected)}
        header={(jobSheetLink) => (
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">User Working Hours</h1>
              <p className="text-label">
                {selected
                  ? `Logged hours for ${displayName(selected)}`
                  : "Pick a team member to see their logged hours"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <UserPicker users={users.data} value={selectedId} onChange={setSelectedId} />
              {jobSheetLink}
            </div>
          </header>
        )}
        placeholder={
          users.error ? (
            <ErrorCard error={users.error} subject="the team list" onRetry={users.retry} />
          ) : (
            <StateCard icon={UserRound} title="No one selected yet">
              Search for a team member in the <strong className="font-semibold">Viewing</strong> box
              to see their hours for today, this week and this month.
            </StateCard>
          )
        }
      />

      {/* Confirms a selection change to screen readers even after the popup closes. */}
      <p className="sr-only" aria-live="polite">
        {selected ? `Showing working hours for ${displayName(selected)}.` : ""}
      </p>
    </>
  );
}

function StaffView() {
  return (
    // No user id: the API always answers with the caller's own data.
    <HoursWorkspace
      userId={null}
      enabled
      header={(jobSheetLink) => (
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Your Working Hours</h1>
            <p className="text-label">Your logged AMS and Non-AMS hours against goal</p>
          </div>
          {jobSheetLink}
        </header>
      )}
    />
  );
}

export default function UserWorkingHoursPage() {
  const { user } = useAuth();
  if (!user) return null; // AppShell only renders pages for a signed-in user.

  return (
    <MotionRoot>
      <div className="@container mx-auto flex w-full max-w-7xl flex-col gap-6">
        {user.role === "admin" ? <AdminView /> : <StaffView />}
      </div>
    </MotionRoot>
  );
}
