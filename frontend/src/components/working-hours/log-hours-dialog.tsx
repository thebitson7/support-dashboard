"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { CircleAlert, Clock, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";

import type { WorkCategory, WorkLogEntry } from "@/types/working-hours";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { formatDateDisplay } from "@/lib/local-datetime";
import { formatTimeRange, spanMinutes, userQuery, WORK_CATEGORIES } from "@/lib/working-hours";
import { DateTimePicker } from "@/components/common/date-time-picker";
import { Field, RequiredMark, describedBy, errorId, fieldId } from "@/components/common/form-field";
import { formatMinutes } from "@/components/tickets/ticket-form/form-model";
import { ChoiceSelect } from "@/components/tickets/ticket-form/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Values = {
  date: string;
  category: WorkCategory | "";
  /** "HH:mm" or "". */
  start_time: string;
  end_time: string;
  note: string;
};
type FieldName = keyof Values;
/** Form order: "go to the first error" follows it. */
const FIELDS: FieldName[] = ["date", "category", "start_time", "end_time", "note"];

// Same rule and wording as the API (working_hours/serializers.py): an entry
// lies within its one date, so a shift crossing midnight is two entries.
const END_BEFORE_START =
  "End time must be after the start time. For a shift that crosses midnight, log it as two entries, one on each date.";

function validate(values: Values, today: string): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  if (!values.date) errors.date = "Choose a date.";
  // "YYYY-MM-DD" strings compare correctly as text.
  else if (values.date > today) errors.date = "You can't log hours for a future date.";
  if (!values.category) errors.category = "Choose AMS or Non-AMS.";
  if (!values.start_time) errors.start_time = "Choose a start time.";
  if (!values.end_time) errors.end_time = "Choose an end time.";
  else if (values.start_time && spanMinutes(values.start_time, values.end_time) === null) {
    errors.end_time = END_BEFORE_START;
  }
  return errors;
}

/**
 * Log a new entry (entry = null) or edit one. Mount with a fresh `key` per
 * opening so the form starts clean.
 *
 * `subjectName` is set when an admin logs for someone else: the copy then
 * names that person, so it's unmistakable whose record changes.
 */
export function LogHoursDialog({
  open,
  onOpenChange,
  userId,
  subjectName,
  today,
  entry,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose entry (admin view); null = the signed-in user's own. */
  userId: string | null;
  subjectName?: string;
  /** "YYYY-MM-DD" in the viewer's zone, as the summary computed it. */
  today: string;
  entry: WorkLogEntry | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Values>(() =>
    entry
      ? {
          date: entry.date,
          category: entry.category,
          start_time: entry.start_time,
          end_time: entry.end_time,
          note: entry.note,
        }
      : { date: today, category: "", start_time: "", end_time: "", note: "" },
  );
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const clientErrors = useMemo(() => validate(values, today), [values, today]);
  // Live, like the duration preview: once both times are picked, an
  // end-before-start is shown straight away rather than after leaving a field.
  const liveOrderError = clientErrors.end_time === END_BEFORE_START;
  const error = (name: FieldName) =>
    serverErrors[name] ??
    (attempted || touched[name] || (name === "end_time" && liveOrderError)
      ? clientErrors[name]
      : undefined);
  const minutes = spanMinutes(values.start_time, values.end_time);
  const set = <K extends FieldName>(name: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [name]: value }));
    // A server message describes the old value; editing clears it.
    setServerErrors((e) => ({ ...e, [name]: undefined }));
  };
  const touch = (name: FieldName) => setTouched((t) => (t[name] ? t : { ...t, [name]: true }));

  const forSomeoneElse = Boolean(subjectName);
  const title = `${entry ? "Edit entry" : "Log hours"}${forSomeoneElse ? ` for ${subjectName}` : ""}`;
  const description = forSomeoneElse
    ? `This changes ${subjectName}'s working hours, not yours.`
    : entry
      ? "Changes count toward your totals as soon as they're saved."
      : "Adds to your totals as soon as it's saved.";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setAttempted(true);
    const firstInvalid = FIELDS.find((f) => clientErrors[f]);
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setGeneral(null);
    // No `hours`: the server computes it from the times.
    const body = {
      date: values.date,
      category: values.category,
      start_time: values.start_time,
      end_time: values.end_time,
      note: values.note.trim(),
    };
    try {
      if (entry) {
        await apiPatch<WorkLogEntry>(`/working-hours/entries/${entry.id}/`, body);
      } else {
        await apiPost<WorkLogEntry>(`/working-hours/entries/${userQuery(userId)}`, body);
      }
      const category = WORK_CATEGORIES.find((c) => c.value === values.category)?.label;
      toast.success(entry ? "Entry updated" : "Hours logged", {
        description: `${formatMinutes(minutes ?? 0)} ${category} · ${formatTimeRange(values)} on ${formatDateDisplay(values.date)}${
          forSomeoneElse ? ` for ${subjectName}` : ""
        }`,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && isRecord(err.data)) {
        const fields: Partial<Record<FieldName, string>> = {};
        const other: string[] = [];
        for (const [key, value] of Object.entries(err.data)) {
          const message = Array.isArray(value) ? String(value[0]) : String(value);
          if ((FIELDS as string[]).includes(key)) fields[key as FieldName] = message;
          else other.push(message);
        }
        setServerErrors(fields);
        setGeneral(other.join(" ") || null);
        const first = FIELDS.find((f) => fields[f]);
        if (first) document.getElementById(fieldId(first))?.focus();
      } else if (err instanceof ApiError && err.status === 403) {
        setGeneral("You can only log and change your own hours.");
      } else if (err instanceof ApiError && err.status === 404) {
        setGeneral(
          entry
            ? "This entry no longer exists; it may have been deleted."
            : "This person's account doesn't exist or has been deactivated.",
        );
      } else {
        const offline = err instanceof ApiError && (err.status === 0 || err.status === 502);
        setGeneral(
          offline
            ? "Couldn't reach the server. Your entries are kept; try again."
            : "Something went wrong while saving. Your entries are kept; try again.",
        );
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))]"
        initialFocus={() => document.getElementById(fieldId(entry ? "start_time" : "category"))}
      >
        <form onSubmit={submit} noValidate aria-busy={submitting} className="flex min-h-0 flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
            <div className="grid gap-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="-mr-2 shrink-0 rounded-full"
            >
              <X aria-hidden />
            </Button>
          </header>

          <div className="scrollbar-styled min-h-0 overflow-y-auto px-6 py-5">
            {general && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-destructive/30"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                {general}
              </div>
            )}
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <Field name="date" label="Date" required error={error("date")}>
                <DateTimePicker
                  id={fieldId("date")}
                  mode="date"
                  value={values.date}
                  onChange={(v) => set("date", v)}
                  onBlur={() => touch("date")}
                  invalid={Boolean(error("date"))}
                  aria-labelledby={`${fieldId("date")}-label`}
                  aria-describedby={error("date") ? errorId("date") : undefined}
                />
              </Field>
              <Field name="category" label="Category" required error={error("category")}>
                <ChoiceSelect
                  name="category"
                  value={values.category}
                  onChange={(v) => set("category", v as WorkCategory | "")}
                  onBlur={() => touch("category")}
                  choices={WORK_CATEGORIES}
                  placeholder="AMS or Non-AMS"
                  error={error("category")}
                />
              </Field>
              {(["start_time", "end_time"] as const).map((name) => (
                <Field
                  key={name}
                  name={name}
                  label={name === "start_time" ? "Start Time" : "End Time"}
                  required
                  error={error(name)}
                >
                  <DateTimePicker
                    id={fieldId(name)}
                    mode="time"
                    value={values[name]}
                    onChange={(v) => set(name, v)}
                    onBlur={() => touch(name)}
                    invalid={Boolean(error(name))}
                    aria-labelledby={`${fieldId(name)}-label`}
                    aria-describedby={error(name) ? errorId(name) : "log-hours-duration"}
                  />
                </Field>
              ))}
              {/* Live preview of what the server will compute (it's authoritative). */}
              <p
                id="log-hours-duration"
                aria-live="polite"
                className="text-label -mt-1 flex items-center gap-1.5 sm:col-span-2"
              >
                <Clock className="size-3.5 shrink-0" aria-hidden />
                {minutes !== null ? (
                  <span>
                    Duration:{" "}
                    <strong className="font-semibold text-foreground tabular-nums">
                      {formatMinutes(minutes)}
                    </strong>
                  </span>
                ) : (
                  <span>The duration is worked out from the start and end times.</span>
                )}
              </p>
              <Field
                name="note"
                label="Note"
                error={error("note")}
                hint="Optional: what the time was for."
                className="sm:col-span-2"
              >
                <Input
                  id={fieldId("note")}
                  value={values.note}
                  maxLength={200}
                  placeholder="e.g. LIS interface outage at Tan Tock Seng"
                  onChange={(e) => set("note", e.target.value)}
                  onBlur={() => touch("note")}
                  {...describedBy("note", error("note"), true)}
                  className="h-9"
                />
              </Field>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-3">
            <p className="text-caption">
              <RequiredMark /> Required field
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="min-w-28">
                {submitting && (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                )}
                {submitting ? "Saving…" : entry ? "Save Changes" : "Log Hours"}
              </Button>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
