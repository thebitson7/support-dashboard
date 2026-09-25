"use client";

import { Info } from "lucide-react";

import type { TicketStatus } from "@/types/tickets";
import { searchUsers } from "@/lib/tickets-api";
import { SearchCombobox } from "@/components/common/search-combobox";
import { StatusCell } from "@/components/tickets/cells";
import { VERIFICATION_FIELDS } from "@/components/tickets/ticket-form/form-model";
import { DateTimeInput, Field, errorId, fieldId } from "@/components/tickets/ticket-form/fields";
import type { FormBindings } from "@/components/tickets/ticket-form/ticket-tab";

type UserKey = "resolution_verified_by" | "cms_closed_by";
type DateKey = "resolution_verified_on" | "cms_closed_on" | "service_closed_date";

export function VerificationTab({
  form,
  currentStatus,
}: {
  form: FormBindings;
  /** Edit mode: the ticket's status as last saved. */
  currentStatus?: TicketStatus;
}) {
  const { values, set, touch, error } = form;
  const filled = VERIFICATION_FIELDS.filter((f) => values[f] !== null && values[f] !== "").length;
  const closing = filled === VERIFICATION_FIELDS.length;

  const user = (field: UserKey, label: string) => (
    <Field name={field} label={label} required error={error(field)}>
      <SearchCombobox
        id={fieldId(field)}
        aria-labelledby={`${fieldId(field)}-label`}
        aria-describedby={error(field) ? errorId(field) : undefined}
        value={values[field]}
        onChange={(o) => set(field, o)}
        onBlur={() => touch(field)}
        loadOptions={searchUsers}
        placeholder="Search users…"
        emptyText="No users match."
        invalid={Boolean(error(field))}
        clearable
      />
    </Field>
  );
  const date = (field: DateKey, label: string) => (
    <Field name={field} label={label} required error={error(field)}>
      <DateTimeInput
        name={field}
        value={values[field]}
        onChange={(v) => set(field, v)}
        onBlur={() => touch(field)}
        error={error(field)}
        clearable
      />
    </Field>
  );

  return (
    <div className="grid gap-6">
      <div className="flex gap-3 rounded-xl bg-muted/60 px-4 py-3 ring-1 ring-foreground/10">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="grid gap-2 text-sm">
          <p>
            <span className="font-semibold">Filling these marks the ticket as closed.</span> Leave
            them all empty to keep it open (or clear all five to reopen it). Once any is filled, all
            five are required.
          </p>
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground" aria-live="polite">
            {currentStatus && (
              <>
                Currently <StatusCell status={currentStatus} />
                <span aria-hidden>→</span>
              </>
            )}
            Will be saved as <StatusCell status={closing ? "Closed" : "Open"} />
            {filled > 0 && !closing && (
              <span>
                ({filled} of {VERIFICATION_FIELDS.length} filled)
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        {user("resolution_verified_by", "Ticket Resolution Verified By")}
        {date("resolution_verified_on", "Ticket Resolution Verified On")}
        {user("cms_closed_by", "CMS Ticket Closed By")}
        {date("cms_closed_on", "CMS Ticket Closed On")}
        {date("service_closed_date", "Service Closed Date")}
      </div>
    </div>
  );
}
