"use client";

import { ListChecks } from "lucide-react";

import { LookupPage } from "@/components/lookups/lookup-page";
import { ActiveBadge } from "@/components/lookups/shared";
import type { LookupConfig } from "@/components/lookups/types";

type WorkDoneCodeRow = { id: number; code: string; description: string; is_active: boolean };

const config: LookupConfig<WorkDoneCodeRow> = {
  title: "Work Done Codes",
  description:
    "The categories of work logged on ticket activities. Inactive codes can't be picked for new activities.",
  noun: "work done code",
  nounPlural: "work done codes",
  endpoint: "/lookups/work-done-codes/",
  searchPlaceholder: "Search by code or description…",
  emptyIcon: ListChecks,
  columns: [
    {
      id: "code",
      header: "Code",
      sortKey: "code",
      className: "w-32",
      cell: (r) => <span className="font-mono text-[13px] font-semibold">{r.code}</span>,
    },
    {
      id: "description",
      header: "Description",
      sortKey: "description",
      cell: (r) => r.description,
    },
    {
      id: "active",
      header: "Active",
      sortKey: "is_active",
      className: "w-32",
      cell: (r) => <ActiveBadge active={r.is_active} />,
    },
  ],
  defaultSort: { column: "code" },
  fields: [
    {
      kind: "text",
      name: "code",
      label: "Code",
      required: true,
      maxLength: 20,
      uppercase: true,
      mono: true,
      placeholder: "HWR",
    },
    {
      kind: "text",
      name: "description",
      label: "Description",
      required: true,
      maxLength: 200,
      wide: true,
    },
    {
      kind: "switch",
      name: "is_active",
      label: "Active",
      defaultValue: true,
      wide: true,
      hint: (v) =>
        v.is_active
          ? "Can be chosen for new ticket activities."
          : "Kept on existing activities, but can't be chosen for new ones.",
    },
  ],
  rowLabel: (r) => `${r.code} · ${r.description}`,
  isDimmed: (r) => !r.is_active,
  deactivateField: "is_active",
};

export default function WorkDoneCodesPage() {
  return <LookupPage config={config} />;
}
