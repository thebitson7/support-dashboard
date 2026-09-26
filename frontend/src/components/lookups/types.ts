// The config a Lookups page hands to <LookupPage>. Everything entity-specific
// lives in one of these; the table, search, sorting, add/edit dialog, delete
// confirmation and permissions are shared machinery.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type LookupRow = { id: number };

/** Form state: text/select/date fields hold strings ("" = empty), switches booleans. */
export type LookupValues = Record<string, string | boolean>;

export type SelectOption = { value: string; label: string };

/** Where a select field's options come from (fetched when the dialog opens). */
export type OptionSource = {
  endpoint: string;
  toOption: (row: never) => SelectOption;
};

type FieldBase = {
  /** The API field name (values and server errors map straight onto it). */
  name: string;
  label: string;
  /** Help text under the control; may depend on the other values. */
  hint?: ReactNode | ((values: LookupValues) => ReactNode);
  /** Span both columns of the dialog's two-column grid. */
  wide?: boolean;
};

export type LookupField =
  | (FieldBase & {
      kind: "text";
      required?: boolean;
      placeholder?: string;
      maxLength?: number;
      /** Upper-cases as you type (codes). */
      uppercase?: boolean;
      mono?: boolean;
      /** Show this field's error while typing, not only after leaving it. */
      validateWhileTyping?: boolean;
    })
  | (FieldBase & { kind: "switch"; defaultValue?: boolean })
  | (FieldBase & {
      kind: "select";
      source: OptionSource;
      required?: boolean;
      /** Offer an explicit "none" choice (sent as null), labelled like this. */
      noneLabel?: string;
      placeholder?: string;
    })
  | (FieldBase & { kind: "date"; required?: boolean });

export type LookupColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** The API `ordering` for this column (comma-separated for several keys); omit if not sortable. */
  sortKey?: string;
  align?: "center" | "right";
  /** Width / min-width utilities for the column. */
  className?: string;
};

export type LookupConfig<Row extends LookupRow> = {
  title: string;
  description: string;
  /** "site" / "sites": used in buttons, toasts, empty states and confirmations. */
  noun: string;
  nounPlural: string;
  /** e.g. "/lookups/sites/" (list = GET/POST, row = <endpoint><id>/). */
  endpoint: string;
  searchPlaceholder: string;
  emptyIcon: LucideIcon;
  columns: LookupColumn<Row>[];
  /** Initial sort: a column id from `columns`. */
  defaultSort: { column: string; desc?: boolean };
  fields: LookupField[];
  /** Checks beyond "required" (which is automatic), keyed by field name. */
  validate?: (values: LookupValues) => Record<string, string | undefined>;
  /** How a row is named in confirmations and toasts. */
  rowLabel: (row: Row) => string;
  /** Rows shown dimmed (e.g. inactive sites). */
  isDimmed?: (row: Row) => boolean;
  /**
   * If the entity can be deactivated, the switch's field name: when a delete
   * is refused because the record is in use, the dialog offers to edit it.
   */
  deactivateField?: string;
};
