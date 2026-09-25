"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, ClipboardList, Pencil, Plus, RotateCw, Trash2 } from "lucide-react";
import { cn } from "cn";

import type { ApiWorkDoneCode } from "@/lib/tickets-api";
import { searchUsers } from "@/lib/tickets-api";
import { EASE } from "@/lib/motion";
import { SearchCombobox } from "@/components/common/search-combobox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FlagCell } from "@/components/tickets/cells";
import {
  ACTIVITY_TYPES,
  formatMinutes,
  labelOf,
  minutesBetween,
  validateActivity,
  type ActivityDraft,
  type ActivityErrors,
} from "@/components/tickets/ticket-form/form-model";
import {
  ChoiceSelect,
  DateTimeInput,
  Field,
  fieldId,
} from "@/components/tickets/ticket-form/fields";

type Draft = Omit<ActivityDraft, "key">;

const EMPTY_DRAFT: Draft = {
  activity_type: "",
  start_at: "",
  end_at: "",
  work_done_code: "",
  is_likely_cause: false,
  resolved_by: null,
};

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtDate = (local: string) => (local ? DATE_FMT.format(new Date(local)) : "—");

let nextKey = 0;
const newKey = () => `activity-${Date.now()}-${nextKey++}`;

export type WorkDoneCodesState = {
  data: ApiWorkDoneCode[] | undefined;
  failed: boolean;
  retry: () => void;
};

/** The add/edit panel: one activity at a time, validated before it joins the list. */
function ActivityEditor({
  initial,
  codes,
  onSave,
  onCancel,
}: {
  initial: Draft;
  codes: WorkDoneCodesState;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const errors = validateActivity(draft);
  const show = (f: keyof Draft) =>
    attempted || touched[f] ? errors[f as keyof ActivityErrors] : undefined;
  const touch = (f: keyof Draft) => () => setTouched((t) => ({ ...t, [f]: true }));
  const set = <K extends keyof Draft>(f: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [f]: value }));
  const minutes = minutesBetween(draft.start_at, draft.end_at);
  const codeChoices = (codes.data ?? []).map((c) => ({
    value: String(c.id),
    label: `${c.code} · ${c.description}`,
  }));

  const save = () => {
    setAttempted(true);
    const first = Object.keys(errors)[0];
    if (first) {
      document.getElementById(fieldId(`act_${first}`))?.focus();
      return;
    }
    onSave(draft);
  };

  return (
    <div
      role="group"
      aria-label={initial === EMPTY_DRAFT ? "New activity" : "Edit activity"}
      className="grid gap-4 rounded-xl bg-muted/50 p-4 ring-1 ring-foreground/10"
      // Enter in a text field saves the activity instead of submitting the ticket.
      onKeyDown={(e) => {
        // (Not from a combobox: there Enter picks the highlighted option.)
        if (
          e.key === "Enter" &&
          e.target instanceof HTMLInputElement &&
          e.target.getAttribute("role") !== "combobox"
        ) {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          name="act_activity_type"
          label="Activity Type"
          required
          error={show("activity_type")}
        >
          <ChoiceSelect
            name="act_activity_type"
            value={draft.activity_type}
            onChange={(v) => set("activity_type", v)}
            onBlur={touch("activity_type")}
            choices={ACTIVITY_TYPES}
            placeholder="Select a type"
            error={show("activity_type")}
          />
        </Field>
        <Field name="act_start_at" label="Start" required error={show("start_at")}>
          <DateTimeInput
            name="act_start_at"
            value={draft.start_at}
            onChange={(v) => set("start_at", v)}
            onBlur={touch("start_at")}
            error={show("start_at")}
          />
        </Field>
        <Field
          name="act_end_at"
          label="End"
          required
          error={show("end_at")}
          hint={
            minutes !== null && !errors.end_at ? `Duration: ${formatMinutes(minutes)}` : undefined
          }
        >
          <DateTimeInput
            name="act_end_at"
            value={draft.end_at}
            onChange={(v) => set("end_at", v)}
            onBlur={touch("end_at")}
            error={show("end_at")}
          />
        </Field>
        <Field
          name="act_work_done_code"
          label="Work Done Code"
          required
          error={show("work_done_code")}
          hint={
            codes.failed ? (
              <span className="flex items-center gap-2">
                Couldn&apos;t load the codes.
                <button
                  type="button"
                  onClick={codes.retry}
                  className="font-semibold underline underline-offset-2"
                >
                  Retry
                </button>
              </span>
            ) : undefined
          }
        >
          <ChoiceSelect
            name="act_work_done_code"
            value={draft.work_done_code}
            onChange={(v) => set("work_done_code", v)}
            onBlur={touch("work_done_code")}
            choices={codeChoices}
            placeholder={codes.data ? "Select a code" : "Loading codes…"}
            error={show("work_done_code")}
          />
        </Field>
        <div className="flex items-center gap-3 self-center sm:pt-6">
          <Switch
            id={fieldId("act_is_likely_cause")}
            checked={draft.is_likely_cause}
            onCheckedChange={(checked) => set("is_likely_cause", checked)}
            aria-describedby={`${fieldId("act_is_likely_cause")}-hint`}
          />
          <div className="grid">
            <label htmlFor={fieldId("act_is_likely_cause")} className="text-sm font-medium">
              Likely Cause
            </label>
            <span id={`${fieldId("act_is_likely_cause")}-hint`} className="text-caption">
              This activity identified the likely cause
            </span>
          </div>
        </div>
        <Field name="act_resolved_by" label="Resolved By">
          <SearchCombobox
            id={fieldId("act_resolved_by")}
            aria-labelledby={`${fieldId("act_resolved_by")}-label`}
            value={draft.resolved_by}
            onChange={(o) => set("resolved_by", o)}
            loadOptions={searchUsers}
            placeholder="Search users…"
            emptyText="No users match."
            clearable
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" onClick={save}>
          {initial === EMPTY_DRAFT ? "Add to list" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

export function ActivitiesTab({
  activities,
  onChange,
  codes,
  serverErrors,
}: {
  activities: ActivityDraft[];
  onChange: (next: ActivityDraft[]) => void;
  codes: WorkDoneCodesState;
  /** Errors the API reported per activity, keyed by the activity's key. */
  serverErrors: Record<string, ActivityErrors>;
}) {
  // null = closed, "new" = adding, otherwise the key being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const codeLabel = (id: string) => {
    const code = codes.data?.find((c) => String(c.id) === id);
    return code ? `${code.code} · ${code.description}` : "—";
  };
  const editingActivity = activities.find((a) => a.key === editing);

  const save = (draft: Draft) => {
    onChange(
      editing === "new"
        ? [...activities, { ...draft, key: newKey() }]
        : activities.map((a) => (a.key === editing ? { ...draft, key: a.key } : a)),
    );
    setEditing(null);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-label">
          Log the work done on this ticket. Durations add up to the ticket&apos;s total.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing("new")}
          disabled={editing !== null}
        >
          <Plus aria-hidden />
          Add Activity
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {editing !== null && (
          <motion.div
            key={editing}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="p-0.5">
              <ActivityEditor
                initial={editingActivity ?? EMPTY_DRAFT}
                codes={codes}
                onSave={save}
                onCancel={() => setEditing(null)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {activities.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <ClipboardList className="size-6" aria-hidden />
          </span>
          <div className="grid gap-1">
            <p className="text-title">No activities added yet</p>
            <p className="text-label">Activities are optional; add one for each piece of work.</p>
          </div>
        </div>
      ) : (
        <div className="scrollbar-styled overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {[
                  "Activity Type",
                  "Start Date",
                  "End Date",
                  "Duration",
                  "Work Done Code",
                  "Likely Cause",
                  "Resolved By",
                ].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="border-b border-border bg-muted px-3 py-2 text-left text-[13px] font-semibold whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
                <th
                  scope="col"
                  className="border-b border-border bg-muted px-3 py-2 text-right text-[13px] font-semibold"
                >
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a, index) => {
                const minutes = minutesBetween(a.start_at, a.end_at) ?? 0;
                const errs = serverErrors[a.key];
                const label = `${labelOf(ACTIVITY_TYPES, a.activity_type)} activity ${index + 1}`;
                return (
                  <tr key={a.key} className={cn(errs && "bg-destructive/5")}>
                    <td className="border-b border-border/60 px-3 py-2 font-medium whitespace-nowrap">
                      {errs && (
                        <CircleAlert
                          className="mr-1.5 inline size-4 text-destructive"
                          aria-label="Has errors"
                        />
                      )}
                      {labelOf(ACTIVITY_TYPES, a.activity_type)}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 whitespace-nowrap tabular-nums">
                      {fmtDate(a.start_at)}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 whitespace-nowrap tabular-nums">
                      {fmtDate(a.end_at)}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 whitespace-nowrap tabular-nums">
                      {minutes} min
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 whitespace-nowrap">
                      {codeLabel(a.work_done_code)}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2">
                      <FlagCell checked={a.is_likely_cause} label="Likely cause" />
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 whitespace-nowrap">
                      {a.resolved_by?.label ?? "—"}
                    </td>
                    <td className="border-b border-border/60 px-2 py-1 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${label}`}
                        disabled={editing !== null}
                        onClick={() => setEditing(a.key)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${label}`}
                        disabled={editing !== null}
                        onClick={() => onChange(activities.filter((x) => x.key !== a.key))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {Object.keys(serverErrors).length > 0 && (
            <ul
              className="grid gap-1 border-t border-border bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
              role="alert"
            >
              {activities.map((a, index) =>
                serverErrors[a.key]
                  ? Object.values(serverErrors[a.key]).map((message) => (
                      <li key={`${a.key}-${message}`} className="flex items-center gap-1.5">
                        <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                        Activity {index + 1}: {message}
                      </li>
                    ))
                  : null,
              )}
            </ul>
          )}
        </div>
      )}

      {codes.failed && editing === null && (
        <p className="text-caption flex items-center gap-2">
          Work done codes couldn&apos;t be loaded.
          <Button type="button" variant="ghost" size="xs" onClick={codes.retry}>
            <RotateCw aria-hidden />
            Retry
          </Button>
        </p>
      )}
    </div>
  );
}
