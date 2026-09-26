"use client";

// Ticket-form controls on top of the shared field building blocks (which are
// re-exported so the ticket form keeps importing everything from here).
export {
  Field,
  FieldError,
  RequiredMark,
  describedBy,
  errorId,
  fieldId,
  hintId,
} from "@/components/common/form-field";

import { DateTimePicker } from "@/components/common/date-time-picker";
import { describedBy, errorId, fieldId } from "@/components/common/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A date-time field: the custom picker, wired to the field's label and messages. */
export function DateTimeInput({
  name,
  value,
  onChange,
  onBlur,
  error,
  clearable,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  clearable?: boolean;
}) {
  return (
    <DateTimePicker
      id={fieldId(name)}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      clearable={clearable}
      invalid={Boolean(error)}
      aria-labelledby={`${fieldId(name)}-label`}
      aria-describedby={error ? errorId(name) : undefined}
    />
  );
}

export function ChoiceSelect({
  name,
  value,
  onChange,
  onBlur,
  choices,
  placeholder,
  error,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  choices: { value: string; label: string }[];
  placeholder: string;
  error?: string;
}) {
  return (
    <Select
      items={choices}
      value={value || null}
      onValueChange={(v) => onChange(typeof v === "string" ? v : "")}
      onOpenChange={(open) => {
        if (!open) onBlur?.();
      }}
    >
      <SelectTrigger
        id={fieldId(name)}
        aria-labelledby={`${fieldId(name)}-label`}
        {...describedBy(name, error)}
        className="h-9 w-full bg-card dark:bg-input/30"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
