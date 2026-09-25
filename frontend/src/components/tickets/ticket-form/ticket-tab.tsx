"use client";

import { useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, LoaderCircle, Plus, Upload, X } from "lucide-react";

import { ApiError, apiPost } from "@/lib/api";
import { EASE } from "@/lib/motion";
import {
  searchCustomers,
  searchSites,
  searchUsers,
  siteOption,
  type ApiSite,
} from "@/lib/tickets-api";
import { SearchCombobox, type ComboOption } from "@/components/common/search-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  INCOMING_CHANNELS,
  MAX_PDF_BYTES,
  TICKET_TYPES,
  type FieldKey,
  type TicketValues,
} from "@/components/tickets/ticket-form/form-model";
import {
  ChoiceSelect,
  DateTimeInput,
  Field,
  FieldError,
  describedBy,
  errorId,
  fieldId,
  hintId,
} from "@/components/tickets/ticket-form/fields";

export type FormBindings = {
  values: TicketValues;
  set: <K extends FieldKey>(field: K, value: TicketValues[K]) => void;
  touch: (field: FieldKey) => void;
  /** The message to show for a field right now (respects touched/submitted). */
  error: (field: FieldKey) => string | undefined;
  /** Edit mode: the file already attached to the ticket (null once removed). */
  existingPdf?: string | null;
  removeExistingPdf?: () => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h3 className="text-caption font-semibold tracking-wide uppercase">{title}</h3>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** A user search bound to one form field. */
type UserFieldKey = "assigned_to" | "forwarded_to" | "cms_added_by";

function UserField({
  form,
  field,
  label,
  required,
  clearable,
}: {
  form: FormBindings;
  field: UserFieldKey;
  label: string;
  required?: boolean;
  clearable?: boolean;
}) {
  const error = form.error(field);
  return (
    <Field name={field} label={label} required={required} error={error}>
      <SearchCombobox
        id={fieldId(field)}
        aria-labelledby={`${fieldId(field)}-label`}
        aria-describedby={error ? errorId(field) : undefined}
        value={form.values[field]}
        onChange={(o) => form.set(field, o)}
        onBlur={() => form.touch(field)}
        loadOptions={searchUsers}
        placeholder="Search users…"
        emptyText="No users match."
        invalid={Boolean(error)}
        clearable={clearable}
      />
    </Field>
  );
}

function PdfUpload({ form }: { form: FormBindings }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string>();
  const file = form.values.pdf_attachment;
  const existing = form.existingPdf ?? null;
  const error = localError ?? form.error("pdf_attachment");

  const choose = (picked: File | undefined) => {
    if (!picked) return;
    if (picked.type !== "application/pdf" && !picked.name.toLowerCase().endsWith(".pdf")) {
      setLocalError("Choose a PDF file.");
      return;
    }
    if (picked.size > MAX_PDF_BYTES) {
      setLocalError("The PDF must be 10 MB or smaller.");
      return;
    }
    setLocalError(undefined);
    form.set("pdf_attachment", picked);
  };

  return (
    <div className="grid gap-1.5 sm:col-span-2">
      <span id={`${fieldId("pdf_attachment")}-label`} className="text-sm font-medium">
        PDF Attachment
      </span>
      <input
        ref={inputRef}
        id={fieldId("pdf_attachment")}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-labelledby={`${fieldId("pdf_attachment")}-label`}
        {...describedBy("pdf_attachment", error)}
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = ""; // picking the same file again still fires
        }}
      />
      {!file && existing ? (
        <div className="flex items-center gap-3 rounded-lg border border-control bg-card px-3 py-2 dark:bg-input/30">
          <FileText className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={existing}>
              {existing}
            </p>
            <p className="text-caption">Currently attached</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
            Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${existing}`}
            onClick={() => form.removeExistingPdf?.()}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : file ? (
        <div className="flex items-center gap-3 rounded-lg border border-control bg-card px-3 py-2 dark:bg-input/30">
          <FileText className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="text-caption tabular-nums">
              {(file.size / 1024 / 1024).toFixed(2)} MB
              {existing ? " · replaces the current file when saved" : ""}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
            Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${file.name}`}
            onClick={() => form.set("pdf_attachment", null)}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(e.dataTransfer.files[0]);
          }}
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-control px-4 py-4 text-sm text-muted-foreground transition-colors outline-none hover:border-primary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Upload className="size-4" aria-hidden />
          <span>
            <span className="font-semibold text-foreground">Choose a PDF</span> or drop it here
            <span className="text-caption"> · optional, up to 10 MB</span>
          </span>
        </button>
      )}
      {error && <FieldError id={errorId("pdf_attachment")}>{error}</FieldError>}
    </div>
  );
}

/** "+" next to Site: create a site (name + OCN) without leaving the form. */
function QuickAddSite({ onCreated }: { onCreated: (site: ComboOption) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ocn, setOcn] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const ids = { name: useId(), ocn: useId(), error: useId() };

  const reset = () => {
    setName("");
    setOcn("");
    setError(undefined);
  };

  const submit = async () => {
    if (!name.trim() || !ocn.trim()) {
      setError("Enter both the site name and its OCN.");
      return;
    }
    setSaving(true);
    try {
      const site = await apiPost<ApiSite>("/tickets/sites/", {
        name: name.trim(),
        ocn: ocn.trim(),
      });
      onCreated(siteOption(site));
      setOpen(false);
      reset();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? "That site and OCN already exist, or a value is invalid."
          : "Couldn't create the site. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            aria-label="Add a new site"
          />
        }
      >
        <Plus aria-hidden />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-80 gap-3 p-4">
        <div className="grid gap-0.5">
          <p className="text-sm font-semibold">Add a site</p>
          <p className="text-caption">It&apos;s selected for this ticket once saved.</p>
        </div>
        <div
          className="grid gap-3"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // don't submit the ticket form
              void submit();
            }
          }}
        >
          <div className="grid gap-1.5">
            <label htmlFor={ids.name} className="text-sm font-medium">
              Site name
            </label>
            <Input
              id={ids.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={ids.ocn} className="text-sm font-medium">
              Site OCN
            </label>
            <Input
              id={ids.ocn}
              value={ocn}
              onChange={(e) => setOcn(e.target.value)}
              placeholder="OCN01234-801-00"
              className="h-9 font-mono"
              aria-describedby={error ? ids.error : undefined}
            />
          </div>
          {error && (
            <p id={ids.error} role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void submit()} disabled={saving}>
              {saving && (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
              )}
              Save site
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TicketTab({
  form,
  activityCount,
  activitiesTotalHours,
}: {
  form: FormBindings;
  activityCount: number;
  activitiesTotalHours: number;
}) {
  const { values, set, touch, error } = form;
  const text = (field: "cms_next_ticket_no") => ({
    id: fieldId(field),
    value: values[field],
    onChange: (e: ChangeEvent<HTMLInputElement>) => set(field, e.target.value),
    onBlur: () => touch(field),
    ...describedBy(field, error(field)),
  });
  const area = (field: "issue_description" | "possible_root_cause" | "notes") => ({
    id: fieldId(field),
    value: values[field],
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => set(field, e.target.value),
    onBlur: () => touch(field),
    ...describedBy(field, error(field)),
  });
  const durationHint =
    activityCount > 0
      ? `Calculated from ${activityCount} ${activityCount === 1 ? "activity" : "activities"}. Edit them on the Activities tab.`
      : "Editable until you add activities; then it's calculated from them.";

  return (
    <div className="grid gap-7">
      <Section title="Source">
        <PdfUpload form={form} />
        <Field
          name="received_at"
          label="Ticket Received Date & Time"
          required
          error={error("received_at")}
        >
          <DateTimeInput
            name="received_at"
            value={values.received_at}
            onChange={(v) => set("received_at", v)}
            onBlur={() => touch("received_at")}
            error={error("received_at")}
          />
        </Field>
        <Field
          name="cms_next_ticket_no"
          label="CMS Next Ticket No"
          required
          error={error("cms_next_ticket_no")}
        >
          <Input
            {...text("cms_next_ticket_no")}
            required
            maxLength={50}
            className="h-9 font-mono"
            spellCheck={false}
          />
        </Field>
      </Section>

      <Section title="Site & assignment">
        <Field name="site" label="Site" required error={error("site")}>
          <div className="flex gap-2">
            <SearchCombobox
              id={fieldId("site")}
              aria-labelledby={`${fieldId("site")}-label`}
              aria-describedby={error("site") ? errorId("site") : undefined}
              value={values.site}
              onChange={(o) => set("site", o)}
              onBlur={() => touch("site")}
              loadOptions={searchSites}
              placeholder="Search sites or OCNs…"
              emptyText="No sites match. Use + to add one."
              invalid={Boolean(error("site"))}
              className="min-w-0 flex-1"
            />
            <QuickAddSite onCreated={(site) => set("site", site)} />
          </div>
        </Field>
        <Field name="customer" label="Customer" required error={error("customer")}>
          <SearchCombobox
            id={fieldId("customer")}
            aria-labelledby={`${fieldId("customer")}-label`}
            aria-describedby={error("customer") ? errorId("customer") : undefined}
            value={values.customer}
            onChange={(o) => set("customer", o)}
            onBlur={() => touch("customer")}
            loadOptions={searchCustomers}
            placeholder="Search customers…"
            emptyText="No customers match."
            invalid={Boolean(error("customer"))}
          />
        </Field>
        <UserField form={form} field="assigned_to" label="Ticket Assigned To" required />
        <Field name="ticket_type" label="Ticket Type" required error={error("ticket_type")}>
          <ChoiceSelect
            name="ticket_type"
            value={values.ticket_type}
            onChange={(v) => set("ticket_type", v)}
            onBlur={() => touch("ticket_type")}
            choices={TICKET_TYPES}
            placeholder="Select a type"
            error={error("ticket_type")}
          />
        </Field>
        <Field
          name="incoming_channel"
          label="Ticket Incoming Channel"
          required
          error={error("incoming_channel")}
        >
          <ChoiceSelect
            name="incoming_channel"
            value={values.incoming_channel}
            onChange={(v) => set("incoming_channel", v)}
            onBlur={() => touch("incoming_channel")}
            choices={INCOMING_CHANNELS}
            placeholder="Select a channel"
            error={error("incoming_channel")}
          />
        </Field>
        <UserField form={form} field="cms_added_by" label="CMS Ticket Added By" clearable />
        <Field
          name="cms_added_on"
          label="CMS Ticket Added On"
          required
          error={error("cms_added_on")}
        >
          <DateTimeInput
            name="cms_added_on"
            value={values.cms_added_on}
            onChange={(v) => set("cms_added_on", v)}
            onBlur={() => touch("cms_added_on")}
            error={error("cms_added_on")}
          />
        </Field>

        <div className="grid content-start gap-3 sm:col-span-2">
          <div className="flex items-center gap-3">
            <Switch
              id={fieldId("is_forwarded")}
              checked={values.is_forwarded}
              onCheckedChange={(checked) => set("is_forwarded", checked)}
              aria-controls={fieldId("forwarded_to")}
            />
            <label htmlFor={fieldId("is_forwarded")} className="text-sm font-medium">
              Ticket Forwarded
            </label>
          </div>
          <AnimatePresence initial={false}>
            {values.is_forwarded && (
              <motion.div
                key="forwarded"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="overflow-hidden"
              >
                {/* padding keeps focus rings from being clipped by the height animation */}
                <div className="p-1 sm:w-1/2 sm:pr-3.5">
                  <UserField form={form} field="forwarded_to" label="Forwarded To" required />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Section>

      <Section title="Details">
        <Field
          name="issue_description"
          label="Issue Description"
          required
          error={error("issue_description")}
          className="sm:col-span-2"
        >
          <Textarea {...area("issue_description")} required rows={3} />
        </Field>
        <Field name="possible_root_cause" label="Possible Root Cause" className="sm:col-span-2">
          <Textarea {...area("possible_root_cause")} rows={2} />
        </Field>
        <Field name="notes" label="Notes" required error={error("notes")} className="sm:col-span-2">
          <Textarea {...area("notes")} required rows={3} />
        </Field>
      </Section>

      <Section title="Time & flags">
        <Field
          name="total_duration_hours"
          label="Total Duration (Hours)"
          error={error("total_duration_hours")}
          hint={durationHint}
        >
          {activityCount > 0 ? (
            <Input
              id={fieldId("total_duration_hours")}
              value={activitiesTotalHours.toFixed(2)}
              readOnly
              aria-readonly
              aria-describedby={hintId("total_duration_hours")}
              className="h-9 bg-muted font-semibold tabular-nums dark:bg-muted"
            />
          ) : (
            <Input
              id={fieldId("total_duration_hours")}
              type="number"
              inputMode="decimal"
              min={0}
              max={9999.99}
              step={0.25}
              placeholder="0.00"
              value={values.total_duration_hours}
              onChange={(e) => set("total_duration_hours", e.target.value)}
              onBlur={() => touch("total_duration_hours")}
              {...describedBy("total_duration_hours", error("total_duration_hours"), durationHint)}
              className="h-9 tabular-nums"
            />
          )}
        </Field>
        <div className="flex items-center gap-3 self-center sm:pt-6">
          <Switch
            id={fieldId("is_pre")}
            checked={values.is_pre}
            onCheckedChange={(checked) => set("is_pre", checked)}
          />
          <label htmlFor={fieldId("is_pre")} className="text-sm font-medium">
            PRE
          </label>
        </div>
      </Section>
    </div>
  );
}
