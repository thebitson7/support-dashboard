"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { useApiGet } from "@/hooks/use-api";
import { DateTimePicker } from "@/components/common/date-time-picker";
import { Field, RequiredMark, describedBy, errorId, fieldId } from "@/components/common/form-field";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  LookupConfig,
  LookupField,
  LookupRow,
  LookupValues,
  SelectOption,
} from "@/components/lookups/types";

/** base-ui Select can't represent "no value" as an item, so "none" gets a sentinel. */
const NONE = "__none__";

// --- Values <-> rows / payloads (driven by the field kinds) ----------------------

function valuesFor(fields: LookupField[], row: LookupRow | null): LookupValues {
  const source = (row ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    fields.map((f) => {
      const raw = source[f.name];
      if (f.kind === "switch") return [f.name, row ? Boolean(raw) : (f.defaultValue ?? false)];
      return [f.name, raw === null || raw === undefined ? "" : String(raw)];
    }),
  );
}

function payloadFor(fields: LookupField[], values: LookupValues): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => {
      const value = values[f.name];
      if (f.kind === "switch") return [f.name, Boolean(value)];
      const text = String(value).trim();
      // Empty optional selects/dates are "none" to the API.
      if (f.kind === "select" || f.kind === "date") return [f.name, text || null];
      return [f.name, text];
    }),
  );
}

function validate<Row extends LookupRow>(config: LookupConfig<Row>, values: LookupValues) {
  const errors: Record<string, string | undefined> = {};
  for (const f of config.fields) {
    if (f.kind !== "switch" && f.required && !String(values[f.name]).trim()) {
      errors[f.name] = "This field is required.";
    }
  }
  const extra = config.validate?.(values) ?? {};
  for (const [name, message] of Object.entries(extra)) {
    if (message && !errors[name]) errors[name] = message;
  }
  return errors;
}

// --- Field controls ----------------------------------------------------------------

type Bind = {
  values: LookupValues;
  set: (name: string, value: string | boolean) => void;
  touch: (name: string) => void;
  error: (name: string) => string | undefined;
};

function SelectControl({
  field,
  bind,
}: {
  field: Extract<LookupField, { kind: "select" }>;
  bind: Bind;
}) {
  const options = useApiGet<unknown[]>(field.source.endpoint);
  const items: SelectOption[] = useMemo(() => {
    const loaded = (options.data ?? []).map((row) => field.source.toOption(row as never));
    return field.noneLabel ? [{ value: NONE, label: field.noneLabel }, ...loaded] : loaded;
  }, [options.data, field]);
  const value = String(bind.values[field.name]);
  const error = bind.error(field.name);

  return (
    <Select
      items={items}
      value={value || (field.noneLabel ? NONE : null)}
      onValueChange={(v) => bind.set(field.name, v === NONE || typeof v !== "string" ? "" : v)}
      onOpenChange={(open) => {
        if (!open) bind.touch(field.name);
      }}
      disabled={!options.data && !options.error}
    >
      <SelectTrigger
        id={fieldId(field.name)}
        aria-labelledby={`${fieldId(field.name)}-label`}
        {...describedBy(field.name, error)}
        className="h-9 w-full bg-card dark:bg-input/30"
      >
        <SelectValue
          placeholder={
            options.error
              ? "Couldn't load options"
              : options.data
                ? (field.placeholder ?? "Select…")
                : "Loading…"
          }
        />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.value === NONE ? (
              <span className="text-muted-foreground">{item.label}</span>
            ) : (
              item.label
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FieldControl({ field, bind }: { field: LookupField; bind: Bind }) {
  const hint = typeof field.hint === "function" ? field.hint(bind.values) : field.hint;
  const error = bind.error(field.name);

  if (field.kind === "switch") {
    return (
      <div className={cn("flex items-start gap-3 pt-1", field.wide && "sm:col-span-2")}>
        <Switch
          id={fieldId(field.name)}
          checked={Boolean(bind.values[field.name])}
          onCheckedChange={(checked) => bind.set(field.name, checked)}
          aria-describedby={hint ? `${fieldId(field.name)}-hint` : undefined}
          className="mt-0.5"
        />
        <div className="grid gap-0.5">
          <label htmlFor={fieldId(field.name)} className="text-sm font-medium">
            {field.label}
          </label>
          {hint && (
            <p id={`${fieldId(field.name)}-hint`} className="text-caption">
              {hint}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Field
      name={field.name}
      label={field.label}
      required={field.required}
      error={error}
      hint={hint}
      className={cn(field.wide && "sm:col-span-2")}
    >
      {field.kind === "text" && (
        <Input
          id={fieldId(field.name)}
          value={String(bind.values[field.name])}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          spellCheck={!field.mono}
          onChange={(e) =>
            bind.set(field.name, field.uppercase ? e.target.value.toUpperCase() : e.target.value)
          }
          onBlur={() => bind.touch(field.name)}
          {...describedBy(field.name, error, hint)}
          className={cn("h-9", field.mono && "font-mono tracking-wide")}
        />
      )}
      {field.kind === "select" && <SelectControl field={field} bind={bind} />}
      {field.kind === "date" && (
        <DateTimePicker
          id={fieldId(field.name)}
          mode="date"
          value={String(bind.values[field.name])}
          onChange={(v) => bind.set(field.name, v)}
          onBlur={() => bind.touch(field.name)}
          invalid={Boolean(error)}
          aria-labelledby={`${fieldId(field.name)}-label`}
          aria-describedby={error ? errorId(field.name) : undefined}
        />
      )}
    </Field>
  );
}

// --- The dialog ----------------------------------------------------------------------

/**
 * Add (row = null) or edit a lookup record. Mount with a fresh `key` per
 * opening so the form starts clean.
 */
export function LookupFormDialog<Row extends LookupRow>({
  config,
  row,
  open,
  onOpenChange,
  onSaved,
}: {
  config: LookupConfig<Row>;
  row: Row | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState(() => valuesFor(config.fields, row));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const inFlight = useRef(false);

  const clientErrors = useMemo(() => validate(config, values), [config, values]);
  const liveFields = useMemo(
    () =>
      new Set(
        config.fields.filter((f) => f.kind === "text" && f.validateWhileTyping).map((f) => f.name),
      ),
    [config.fields],
  );

  const bind: Bind = {
    values,
    set: (name, value) => {
      setValues((v) => ({ ...v, [name]: value }));
      setDirty(true);
      // A server message describes the old value; editing clears it.
      setServerErrors((errors) => {
        if (!(name in errors)) return errors;
        const next = { ...errors };
        delete next[name];
        return next;
      });
    },
    touch: (name) => setTouched((t) => (t[name] ? t : { ...t, [name]: true })),
    error: (name) => {
      if (serverErrors[name]) return serverErrors[name];
      const show =
        attempted || touched[name] || (liveFields.has(name) && String(values[name]).trim() !== "");
      return show ? clientErrors[name] : undefined;
    },
  };

  const requestClose = () => {
    if (submitting) return;
    if (dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setAttempted(true);
    const firstInvalid = config.fields.find((f) => clientErrors[f.name]);
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid.name))?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setGeneral(null);
    try {
      const body = payloadFor(config.fields, values);
      const saved = row
        ? await apiPatch<Row>(`${config.endpoint}${row.id}/`, body)
        : await apiPost<Row>(config.endpoint, body);
      toast.success(`${capitalize(config.noun)} ${row ? "updated" : "added"}`, {
        description: config.rowLabel(saved),
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && isRecord(err.data)) {
        const fields: Record<string, string> = {};
        const other: string[] = [];
        for (const [key, value] of Object.entries(err.data)) {
          const message = Array.isArray(value) ? String(value[0]) : String(value);
          if (config.fields.some((f) => f.name === key)) fields[key] = message;
          else other.push(message);
        }
        setServerErrors(fields);
        setGeneral(other.join(" ") || null);
        const first = config.fields.find((f) => fields[f.name]);
        if (first) document.getElementById(fieldId(first.name))?.focus();
      } else if (err instanceof ApiError && err.status === 403) {
        setGeneral(`Only admins can change ${config.nounPlural}.`);
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

  const title = `${row ? "Edit" : "Add"} ${config.noun}`;
  const hasRequired = config.fields.some((f) => f.kind !== "switch" && f.required);

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
          className="max-h-[calc(100dvh-2rem)] w-[min(38rem,calc(100vw-2rem))]"
          initialFocus={() => document.getElementById(fieldId(config.fields[0].name))}
        >
          <form
            onSubmit={submit}
            noValidate
            aria-busy={submitting}
            className="flex min-h-0 flex-col"
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
              <div className="grid gap-1">
                <DialogTitle>{capitalize(title)}</DialogTitle>
                <DialogDescription>
                  {row ? config.rowLabel(row) : `Add a new ${config.noun} to the list.`}
                </DialogDescription>
              </div>
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
                {config.fields.map((field) => (
                  <FieldControl key={field.name} field={field} bind={bind} />
                ))}
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-3">
              <p className="text-caption">
                {hasRequired && (
                  <>
                    <RequiredMark /> Required field
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={requestClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="min-w-28">
                  {submitting && (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                  )}
                  {submitting ? "Saving…" : row ? "Save Changes" : `Add ${config.noun}`}
                </Button>
              </div>
            </footer>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <div className="grid gap-1">
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              They haven&apos;t been saved and will be lost.
            </AlertDialogDescription>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialogClose render={<Button variant="ghost" />}>Keep editing</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
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

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
