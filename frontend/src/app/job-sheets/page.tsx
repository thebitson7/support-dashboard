"use client";

import { Suspense, useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import type { StaffUser, WorkLogEntry } from "@/types/working-hours";
import { ApiError, apiDelete } from "@/lib/api";
import { displayName, useAuth, type AuthUser } from "@/lib/auth";
import {
  addDaysToDate,
  formatDateDisplay,
  formatDateLong,
  parseLocalDate,
  todayInZone,
} from "@/lib/local-datetime";
import { WORK_CATEGORIES, entryMinutes, formatTimeRange } from "@/lib/working-hours";
import { useApiGet } from "@/hooks/use-api";
import { DateTimePicker } from "@/components/common/date-time-picker";
import { StatePlaceholder } from "@/components/common/state-placeholder";
import { DayEntries } from "@/components/job-sheets/day-entries";
import { DaySummary } from "@/components/job-sheets/day-summary";
import { formatMinutes } from "@/components/tickets/ticket-form/form-model";
import { LogHoursDialog } from "@/components/working-hours/log-hours-dialog";
import { UserPicker } from "@/components/working-hours/user-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";

type DeleteState = { entry: WorkLogEntry; pending: boolean; error: string | null };

/**
 * A person's work for one day: AMS entries mirrored from their ticket
 * activities (read-only here) plus the Non-AMS time they logged by hand.
 * Which day and whose are URL state (?date=YYYY-MM-DD&user_id=), so other
 * pages can link to a day and the back button works.
 */
export default function JobSheetsPage() {
  // useSearchParams needs a Suspense boundary (see the Next docs).
  return (
    <Suspense fallback={null}>
      <JobSheetFromUrl />
    </Suspense>
  );
}

function JobSheetFromUrl() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!user) return null; // AppShell only renders pages for a signed-in user.

  const isAdmin = user.role === "admin";
  // "Today" in the viewer's profile zone: the same calendar the API uses.
  const today = todayInZone(user.timezone);
  const requested = params.get("date") ?? "";
  // No future days: nothing can be logged there yet.
  const date = parseLocalDate(requested) && requested <= today ? requested : today;
  const userId = isAdmin ? params.get("user_id") || null : null;

  const navigate = (patch: { date?: string; userId?: string | null }) => {
    const next = new URLSearchParams(params.toString());
    const nextDate = patch.date ?? date;
    if (nextDate === today) next.delete("date");
    else next.set("date", nextDate);
    if (patch.userId !== undefined) {
      if (patch.userId) next.set("user_id", patch.userId);
      else next.delete("user_id");
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <JobSheet
      viewer={user}
      isAdmin={isAdmin}
      userId={userId}
      date={date}
      today={today}
      onDateChange={(next) => navigate({ date: next > today ? today : next })}
      onUserChange={(next) => navigate({ userId: next })}
    />
  );
}

function JobSheet({
  viewer,
  isAdmin,
  userId,
  date,
  today,
  onDateChange,
  onUserChange,
}: {
  viewer: AuthUser;
  isAdmin: boolean;
  /** Admin view: whose sheet (null = nobody picked yet). Staff: always null (themselves). */
  userId: string | null;
  date: string;
  today: string;
  onDateChange: (date: string) => void;
  onUserChange: (userId: string | null) => void;
}) {
  const dateLabelId = useId();
  const users = useApiGet<StaffUser[]>(isAdmin ? "/working-hours/users/" : null);
  const selected = users.data?.find((u) => String(u.id) === userId);
  const enabled = !isAdmin || userId !== null;

  const query = new URLSearchParams({ date });
  if (userId) query.set("user_id", userId);
  const entries = useApiGet<WorkLogEntry[]>(enabled ? `/working-hours/entries/?${query}` : null);

  const [dialog, setDialog] = useState<{ open: boolean; key: number; entry: WorkLogEntry | null }>({
    open: false,
    key: 0,
    entry: null,
  });
  const [deleting, setDeleting] = useState<DeleteState | null>(null);
  const openLog = (entry: WorkLogEntry | null) =>
    setDialog((d) => ({ open: true, key: d.key + 1, entry }));

  // Set only when an admin works on someone else's sheet: the dialogs then name them.
  const subjectName = isAdmin && selected ? displayName(selected) : undefined;
  const canLog = enabled && !entries.error;

  const entryLabel = (entry: WorkLogEntry) =>
    `${formatMinutes(entryMinutes(entry))} ${
      WORK_CATEGORIES.find((c) => c.value === entry.category)?.label
    } (${formatTimeRange(entry)}) on ${formatDateDisplay(entry.date)}`;

  async function confirmDelete() {
    if (!deleting) return;
    const { entry } = deleting;
    setDeleting({ entry, pending: true, error: null });
    try {
      await apiDelete(`/working-hours/entries/${entry.id}/`);
      toast.success("Entry deleted", { description: entryLabel(entry) });
      setDeleting(null);
      entries.retry();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Already gone (deleted elsewhere): the refreshed list will show that.
        setDeleting(null);
        entries.retry();
        return;
      }
      setDeleting({
        entry,
        pending: false,
        error:
          err instanceof ApiError && (err.status === 403 || err.status === 409)
            ? err.message
            : "Couldn't delete this entry. Try again.",
      });
    }
  }

  const who = isAdmin ? (selected ? displayName(selected) : null) : displayName(viewer);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Job Sheet</h1>
          <p className="text-label">
            {who
              ? `${isAdmin ? `${who} · ` : ""}${formatDateLong(date)}`
              : "Pick a team member to see their day"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <UserPicker users={users.data} value={userId} onChange={(id) => onUserChange(id)} />
          )}
          {canLog && (
            <Button onClick={() => openLog(null)}>
              <Plus aria-hidden />
              Log Hours
            </Button>
          )}
        </div>
      </header>

      <div role="group" aria-label="Choose the day" className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Previous day"
          onClick={() => onDateChange(addDaysToDate(date, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <span id={dateLabelId} className="sr-only">
          Day
        </span>
        <div className="w-44">
          <DateTimePicker
            mode="date"
            value={date}
            onChange={(next) => {
              if (next) onDateChange(next);
            }}
            aria-labelledby={dateLabelId}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Next day"
          disabled={date >= today}
          onClick={() => onDateChange(addDaysToDate(date, 1))}
        >
          <ChevronRight aria-hidden />
        </Button>
        {date !== today && (
          <Button variant="ghost" size="sm" onClick={() => onDateChange(today)}>
            Back to today
          </Button>
        )}
      </div>

      {/* Announces the day / person change for screen readers. */}
      <p className="sr-only" aria-live="polite">
        {who ? `Job sheet for ${who}, ${formatDateLong(date)}.` : ""}
      </p>

      {!enabled ? (
        <Card className="shadow-elev-1">
          {users.error ? (
            <StatePlaceholder icon={TriangleAlert} title="Couldn't load the team list" alert>
              {users.error.message || "Try reloading the page."}
            </StatePlaceholder>
          ) : (
            <StatePlaceholder icon={UserRound} title="No one selected yet">
              Search for a team member in the <strong className="font-semibold">Viewing</strong> box
              to see their job sheet.
            </StatePlaceholder>
          )}
        </Card>
      ) : (
        <>
          {!entries.error && <DaySummary entries={entries.data} />}
          <DayEntries
            entries={entries.data}
            error={entries.error}
            onRetry={entries.retry}
            canLog={canLog}
            onAdd={() => openLog(null)}
            onEdit={openLog}
            onDelete={(entry) => setDeleting({ entry, pending: false, error: null })}
          />
        </>
      )}

      {enabled && (
        <LogHoursDialog
          key={dialog.key}
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          userId={userId}
          subjectName={subjectName}
          today={today}
          defaultDate={date}
          entry={dialog.entry}
          onSaved={entries.retry}
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
                <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                <AlertDialogDescription>
                  {entryLabel(deleting.entry)} will be removed from{" "}
                  {subjectName ? `${subjectName}'s` : "your"} working hours.
                </AlertDialogDescription>
              </div>
              {deleting.error && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {deleting.error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <AlertDialogClose render={<Button variant="ghost" />} disabled={deleting.pending}>
                  Cancel
                </AlertDialogClose>
                <Button
                  variant="destructive"
                  onClick={() => void confirmDelete()}
                  disabled={deleting.pending}
                >
                  {deleting.pending && (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                  )}
                  Delete
                </Button>
              </div>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <Toaster />
    </div>
  );
}
