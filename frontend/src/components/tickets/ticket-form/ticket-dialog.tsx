"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { motion, useReducedMotion } from "framer-motion";
import { CircleAlert, LoaderCircle, RotateCw, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import type { TicketStatus } from "@/types/tickets";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { EASE } from "@/lib/motion";
import type { ApiTicketDetail, ApiTicketRow, ApiWorkDoneCode } from "@/lib/tickets-api";
import { useApiGet } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusCell } from "@/components/tickets/cells";
import {
  ActivitiesTab,
  type WorkDoneCodesState,
} from "@/components/tickets/ticket-form/activities-tab";
import { RequiredMark, fieldId } from "@/components/tickets/ticket-form/fields";
import {
  activitiesFromTicket,
  activitiesTotalHours,
  buildTicketFormData,
  initialValues,
  mapServerErrors,
  tabOfField,
  validateTicket,
  valuesFromTicket,
  type ActivityDraft,
  type FieldKey,
  type ServerErrors,
  type TabId,
  type TicketValues,
} from "@/components/tickets/ticket-form/form-model";
import { TicketTab, type FormBindings } from "@/components/tickets/ticket-form/ticket-tab";
import { VerificationTab } from "@/components/tickets/ticket-form/verification-tab";

const TABS: { id: TabId; label: string }[] = [
  { id: "ticket", label: "Ticket" },
  { id: "activities", label: "Activities" },
  { id: "verification", label: "Ticket Verification" },
];
const TAB_INDEX = Object.fromEntries(TABS.map((t, i) => [t.id, i])) as Record<TabId, number>;
/** Field order for "go to the first error": tab by tab, top to bottom. */
const FIELD_ORDER = Object.keys(initialValues()) as FieldKey[];
const NO_SERVER_ERRORS: ServerErrors = { fields: {}, activities: {}, general: [] };

const statusLabel = (s: "open" | "closed"): TicketStatus => (s === "closed" ? "Closed" : "Open");

/** What the dialog shell needs to know about the form to guard closing. */
type FormGuard = { dirty: boolean; submitting: boolean };

type Mode = { kind: "create" } | { kind: "edit"; ticket: ApiTicketDetail };

// --- The form (identical for create and edit) ---------------------------------

function TicketForm({
  mode,
  codes,
  guardRef,
  onCancel,
  onSaved,
}: {
  mode: Mode;
  codes: WorkDoneCodesState;
  guardRef: RefObject<FormGuard>;
  onCancel: () => void;
  onSaved: (message: string, description: string) => void;
}) {
  const reduce = useReducedMotion();
  const editing = mode.kind === "edit" ? mode.ticket : null;

  const [values, setValues] = useState<TicketValues>(() =>
    editing ? valuesFromTicket(editing) : initialValues(),
  );
  const [activities, setActivities] = useState<ActivityDraft[]>(() =>
    editing ? activitiesFromTicket(editing) : [],
  );
  const [existingPdf, setExistingPdf] = useState(editing?.pdf_attachment_name ?? null);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerErrors>(NO_SERVER_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<TabId>("ticket");
  const [direction, setDirection] = useState(1);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Keep the shell's close guard in sync.
  useEffect(() => {
    guardRef.current = { dirty, submitting };
  }, [guardRef, dirty, submitting]);

  const clientErrors = useMemo(
    () => validateTicket(values, activities.length),
    [values, activities.length],
  );

  // Focus a field once its tab has rendered (after switching to it).
  useEffect(() => {
    if (!pendingFocus) return;
    const id = requestAnimationFrame(() => {
      document.getElementById(pendingFocus)?.focus();
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingFocus, tab]);

  const goToTab = (next: TabId) => {
    setDirection(TAB_INDEX[next] >= TAB_INDEX[tab] ? 1 : -1);
    setTab(next);
  };
  const goToField = (field: string) => {
    goToTab(tabOfField(field));
    setPendingFocus(field === "activities" ? null : fieldId(field));
  };

  const form: FormBindings = {
    values,
    set: (field, value) => {
      setValues((v) => ({ ...v, [field]: value }));
      setDirty(true);
      // A server message describes the old value; editing clears it.
      if (serverErrors.fields[field]) {
        setServerErrors((e) => ({ ...e, fields: { ...e.fields, [field]: undefined } }));
      }
    },
    touch: (field) => setTouched((t) => (t[field] ? t : { ...t, [field]: true })),
    error: (field) =>
      serverErrors.fields[field] ?? (attempted || touched[field] ? clientErrors[field] : undefined),
    existingPdf,
    removeExistingPdf: () => {
      setExistingPdf(null);
      setDirty(true);
    },
  };

  const updateActivities = (next: ActivityDraft[]) => {
    setActivities(next);
    setDirty(true);
    setServerErrors((e) => ({ ...e, activities: {} }));
  };

  // Live per-tab "needs attention" dots (not gated on touched: the point is
  // to show where required fields are still missing without hunting).
  const tabNeedsAttention = (id: TabId) => {
    if (id === "activities") return Object.keys(serverErrors.activities).length > 0;
    return FIELD_ORDER.some(
      (f) => tabOfField(f) === id && Boolean(clientErrors[f] ?? serverErrors.fields[f]),
    );
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setAttempted(true);

    const firstInvalid = FIELD_ORDER.find((f) => clientErrors[f]);
    if (firstInvalid) {
      goToField(firstInvalid);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setServerErrors(NO_SERVER_ERRORS);
    try {
      if (editing) {
        const body = buildTicketFormData(values, activities, {
          removeExistingPdf: Boolean(editing.pdf_attachment_name) && existingPdf === null,
        });
        const saved = await apiPatch<ApiTicketDetail>(`/tickets/${editing.id}/`, body);
        onSaved("Ticket updated", `${saved.cms_next_ticket_no} · now ${statusLabel(saved.status)}`);
      } else {
        const created = await apiPost<ApiTicketRow>(
          "/tickets/",
          buildTicketFormData(values, activities),
        );
        onSaved("Ticket created", `${created.cms_next_ticket_no} · ${created.site_name}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const mapped = mapServerErrors(err.data, activities);
        setServerErrors(mapped);
        const firstField = FIELD_ORDER.find((f) => mapped.fields[f]);
        if (firstField) goToField(firstField);
        else if (Object.keys(mapped.activities).length) goToTab("activities");
      } else {
        const offline = err instanceof ApiError && (err.status === 0 || err.status === 502);
        const gone = err instanceof ApiError && err.status === 404;
        const code = err instanceof ApiError && err.status ? ` (error ${err.status})` : "";
        setServerErrors({
          ...NO_SERVER_ERRORS,
          general: [
            offline
              ? "Couldn't reach the server. Your entries are kept; try again."
              : gone
                ? "This ticket no longer exists, so the changes can't be saved."
                : `The ticket couldn't be saved${code}. Your entries are kept; try again.`,
          ],
        });
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const totalHours = activitiesTotalHours(activities);

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={submitting}
      className="flex min-h-0 flex-1 flex-col"
      // Enter shouldn't submit a form this size by accident (e.g. from the
      // CMS number field); saving is an explicit action.
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
    >
      <Tabs.Root
        value={tab}
        onValueChange={(next) => goToTab(next as TabId)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List
          aria-label="Ticket sections"
          className="flex shrink-0 gap-1 border-b border-border px-5 py-2"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            const attention = tabNeedsAttention(t.id);
            return (
              <Tabs.Tab
                key={t.id}
                value={t.id}
                className={cn(
                  "relative flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="ticket-dialog-tab-pill"
                    transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
                    className="absolute inset-0 rounded-full bg-primary"
                    aria-hidden
                  />
                )}
                <span className="relative">{t.label}</span>
                {t.id === "activities" && activities.length > 0 && (
                  <span
                    className={cn(
                      "relative grid min-w-5 place-items-center rounded-full px-1.5 text-xs tabular-nums",
                      active ? "bg-black/15" : "bg-muted text-foreground",
                    )}
                  >
                    {activities.length}
                    <span className="sr-only"> added</span>
                  </span>
                )}
                {attention && (
                  <span className="relative flex items-center">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        active ? "bg-primary-foreground" : "bg-destructive",
                      )}
                    />
                    <span className="sr-only">, needs attention</span>
                  </span>
                )}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>

        <div className="scrollbar-styled min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {serverErrors.general.length > 0 && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-destructive/30"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <ul className="grid gap-0.5">
                {serverErrors.general.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {TABS.map((t) => (
            <Tabs.Panel key={t.id} value={t.id} className="outline-none">
              <motion.div
                initial={reduce ? false : { opacity: 0, x: 16 * direction }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
                {t.id === "ticket" && (
                  <TicketTab
                    form={form}
                    activityCount={activities.length}
                    activitiesTotalHours={totalHours}
                  />
                )}
                {t.id === "activities" && (
                  <ActivitiesTab
                    activities={activities}
                    onChange={updateActivities}
                    codes={codes}
                    serverErrors={serverErrors.activities}
                  />
                )}
                {t.id === "verification" && (
                  <VerificationTab
                    form={form}
                    currentStatus={editing ? statusLabel(editing.status) : undefined}
                  />
                )}
              </motion.div>
            </Tabs.Panel>
          ))}
        </div>
      </Tabs.Root>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-3">
        <p className="text-caption">
          <RequiredMark /> Required field
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} className="min-w-32">
            {submitting && (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            {editing
              ? submitting
                ? "Saving…"
                : "Save Changes"
              : submitting
                ? "Creating…"
                : "Create Ticket"}
          </Button>
        </div>
      </footer>
    </form>
  );
}

// --- Loading / error states for edit mode --------------------------------------

function FormSkeleton() {
  const bar = "rounded-full motion-reduce:animate-none";
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading ticket"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex gap-2 border-b border-border px-5 py-2.5">
        {[20, 24, 36].map((w) => (
          <Skeleton key={w} className={cn(bar, "h-8")} style={{ width: `${w * 0.25}rem` }} />
        ))}
      </div>
      <div className="grid flex-1 content-start gap-x-5 gap-y-5 overflow-hidden px-6 py-5 sm:grid-cols-2">
        <Skeleton className={cn(bar, "h-14 sm:col-span-2")} />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="grid gap-2">
            <Skeleton className={cn(bar, "h-3.5 w-32")} />
            <Skeleton className="h-9 rounded-lg motion-reduce:animate-none" />
          </div>
        ))}
        <Skeleton className="h-24 rounded-lg motion-reduce:animate-none sm:col-span-2" />
      </div>
    </div>
  );
}

function LoadError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const gone = error.status === 404;
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <TriangleAlert className="size-7" aria-hidden />
      </span>
      <div className="grid gap-1">
        <p className="text-title">{gone ? "Ticket not found" : "Couldn't load this ticket"}</p>
        <p className="text-label">
          {gone ? "It may have been removed." : "Check your connection, then try again."}
        </p>
      </div>
      {!gone && (
        <Button type="button" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}

// --- The dialog shell ----------------------------------------------------------

/**
 * New / Edit Ticket. Without `ticketId` it creates a ticket; with one it
 * loads that ticket, pre-fills all three tabs and saves with PATCH. Mount it
 * with a fresh `key` per opening so every form starts clean.
 */
export function TicketDialog({
  open,
  onOpenChange,
  ticketId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId?: number;
  onSaved: () => void;
}) {
  const isEdit = ticketId !== undefined;
  // The page remounts this dialog (new `key`) for every opening, so "opened
  // in this mount" is fixed at mount. Keying the fetches on it rather than on
  // `open` keeps the data on screen during the closing animation.
  const [active] = useState(open);
  const detail = useApiGet<ApiTicketDetail>(active && isEdit ? `/tickets/${ticketId}/` : null);
  const codes = useApiGet<ApiWorkDoneCode[]>(active ? "/tickets/work-done-codes/" : null);
  const guardRef = useRef<FormGuard>({ dirty: false, submitting: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const requestClose = () => {
    if (guardRef.current.submitting) return;
    if (guardRef.current.dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  };

  const saved = (message: string, description: string) => {
    toast.success(message, { description });
    guardRef.current = { dirty: false, submitting: false };
    onSaved();
    onOpenChange(false);
  };

  const codesState: WorkDoneCodesState = {
    data: codes.data,
    failed: Boolean(codes.error),
    retry: codes.retry,
  };
  const ticket = detail.data;

  let body;
  if (!isEdit) {
    body = (
      <TicketForm
        mode={{ kind: "create" }}
        codes={codesState}
        guardRef={guardRef}
        onCancel={requestClose}
        onSaved={saved}
      />
    );
  } else if (ticket) {
    body = (
      <TicketForm
        key={ticket.id}
        mode={{ kind: "edit", ticket }}
        codes={codesState}
        guardRef={guardRef}
        onCancel={requestClose}
        onSaved={saved}
      />
    );
  } else {
    body = (
      <>
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.retry} />
        ) : (
          <FormSkeleton />
        )}
        <footer className="flex justify-end border-t border-border bg-muted/40 px-6 py-3">
          <Button type="button" variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
        </footer>
      </>
    );
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else requestClose();
        }}
      >
        <DialogContent
          className="h-[min(56rem,calc(100dvh-2rem))] w-[min(68rem,calc(100vw-2rem))]"
          // The form's first field gets focus (not the close button) once it exists.
          initialFocus={() => document.getElementById(fieldId("cms_next_ticket_no"))}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
            <div className="grid gap-1">
              <DialogTitle>{isEdit ? "Edit Ticket" : "New Ticket"}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                {!isEdit ? (
                  "Log an AMS ticket with its activities and, if resolved, its verification."
                ) : ticket ? (
                  <>
                    <span className="font-mono text-foreground">{ticket.cms_next_ticket_no}</span>
                    <span aria-hidden>·</span>
                    <span>{ticket.site.name}</span>
                    <StatusCell status={statusLabel(ticket.status)} />
                  </>
                ) : (
                  "Loading ticket…"
                )}
              </DialogDescription>
            </div>
            {/* A plain button (not Dialog.Close) so it goes through the same
                "discard changes?" check as Esc and clicking outside. */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={requestClose}
              className="-mr-2 shrink-0 rounded-full"
            >
              <X aria-hidden />
            </Button>
          </header>
          {body}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <div className="grid gap-1">
            <AlertDialogTitle>
              {isEdit ? "Discard your changes?" : "Discard this ticket?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isEdit
                ? "Your edits haven't been saved and will be lost."
                : "The details you've entered haven't been saved and will be lost."}
            </AlertDialogDescription>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialogClose render={<Button variant="ghost" />}>Keep editing</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                guardRef.current = { dirty: false, submitting: false };
                onOpenChange(false);
              }}
            >
              Discard
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
