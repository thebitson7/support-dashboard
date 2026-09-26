"use client";

import { Globe } from "lucide-react";

import { TextCell } from "@/components/tickets/cells";
import { LookupPage } from "@/components/lookups/lookup-page";
import type { LookupConfig } from "@/components/lookups/types";

type CountryRow = { id: number; name: string; code: string };

const config: LookupConfig<CountryRow> = {
  title: "Countries",
  description: "Countries that sites and holidays can belong to.",
  noun: "country",
  nounPlural: "countries",
  endpoint: "/lookups/countries/",
  searchPlaceholder: "Search by name or code…",
  emptyIcon: Globe,
  columns: [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      cell: (r) => <TextCell value={r.name} strong />,
    },
    {
      id: "code",
      header: "Code",
      sortKey: "code",
      className: "w-32",
      cell: (r) => <TextCell value={r.code} mono />,
    },
  ],
  defaultSort: { column: "name" },
  fields: [
    { kind: "text", name: "name", label: "Country name", required: true, maxLength: 100 },
    {
      kind: "text",
      name: "code",
      label: "ISO code",
      required: true,
      maxLength: 2,
      uppercase: true,
      mono: true,
      placeholder: "MY",
      hint: "2-letter ISO 3166-1 code",
      validateWhileTyping: true,
    },
  ],
  validate: (v) => ({
    code: /^[A-Z]{2}$/.test(String(v.code)) ? undefined : "Use exactly 2 letters, e.g. MY.",
  }),
  rowLabel: (r) => `${r.name} (${r.code})`,
};

export default function CountriesPage() {
  return <LookupPage config={config} />;
}
