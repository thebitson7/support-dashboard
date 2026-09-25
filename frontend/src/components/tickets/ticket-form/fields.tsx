"use client";

import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "cn";

import { DateTimePicker } from "@/components/common/date-time-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Ids shared by a control and its label / messages. */
export const fieldId = (name: string) => `nt-${name}`;
export const errorId = (name: string) => `nt-${name}-error`;
export const hintId = (name: string) => `nt-${name}-hint`;

/** aria props for a control whose message may be an error or a hint. */
export function describedBy(name: string, error: string | undefined, hint?: ReactNode) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId(name) : hint ? hintId(name) : undefined,
  };
}

export function RequiredMark() {
  return (
    <>
      <span aria-hidden className="text-destructive">
        {" *"}
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-xs font-medium text-destructive">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/**
 * Label + control + (error or hint). The label is a real <label> for native
 * inputs; for composite controls it still names them via aria-labelledby.
 */
export function Field({
  name,
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  name: string;
  label: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label id={`${fieldId(name)}-label`} htmlFor={fieldId(name)} className="text-sm font-medium">
        {label}
        {required && <RequiredMark />}
      </label>
      {children}
      {error ? (
        <FieldError id={errorId(name)}>{error}</FieldError>
      ) : hint ? (
        <p id={hintId(name)} className="text-caption">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

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
