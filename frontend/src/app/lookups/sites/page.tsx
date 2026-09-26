"use client";

import { MapPin } from "lucide-react";

import { Dash, TextCell } from "@/components/tickets/cells";
import { LookupPage } from "@/components/lookups/lookup-page";
import { ActiveBadge, COUNTRY_OPTIONS, CountryCell } from "@/components/lookups/shared";
import type { LookupConfig } from "@/components/lookups/types";

type SiteRow = {
  id: number;
  name: string;
  ocn: string;
  country: number | null;
  country_name: string | null;
  country_code: string | null;
  address: string;
  is_active: boolean;
};

const config: LookupConfig<SiteRow> = {
  title: "Sites",
  description: "Customer sites and their OCNs. Inactive sites are hidden from the ticket form.",
  noun: "site",
  nounPlural: "sites",
  endpoint: "/lookups/sites/",
  searchPlaceholder: "Search by name, OCN, country or address…",
  emptyIcon: MapPin,
  columns: [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      className: "min-w-[16rem]",
      cell: (r) => <TextCell value={r.name} strong />,
    },
    {
      id: "ocn",
      header: "OCN",
      sortKey: "ocn",
      className: "whitespace-nowrap",
      cell: (r) => <TextCell value={r.ocn} mono />,
    },
    {
      id: "country",
      header: "Country",
      sortKey: "country__name",
      cell: (r) => <CountryCell name={r.country_name} code={r.country_code} />,
    },
    {
      id: "address",
      header: "Address",
      sortKey: "address",
      className: "min-w-[14rem]",
      cell: (r) => (r.address ? r.address : <Dash />),
    },
    {
      id: "active",
      header: "Active",
      sortKey: "is_active",
      cell: (r) => <ActiveBadge active={r.is_active} />,
    },
  ],
  defaultSort: { column: "name" },
  fields: [
    { kind: "text", name: "name", label: "Site name", required: true, maxLength: 200, wide: true },
    {
      kind: "text",
      name: "ocn",
      label: "OCN",
      required: true,
      maxLength: 50,
      uppercase: true,
      mono: true,
      placeholder: "OCN01234-801-00",
    },
    {
      kind: "select",
      name: "country",
      label: "Country",
      source: COUNTRY_OPTIONS,
      noneLabel: "No country",
    },
    { kind: "text", name: "address", label: "Address", maxLength: 300, wide: true },
    {
      kind: "switch",
      name: "is_active",
      label: "Active",
      defaultValue: true,
      wide: true,
      hint: (v) =>
        v.is_active
          ? "Offered in the ticket form's site search."
          : "Hidden from the ticket form. Tickets that already use it are unaffected.",
    },
  ],
  rowLabel: (r) => `${r.name} (${r.ocn})`,
  isDimmed: (r) => !r.is_active,
  deactivateField: "is_active",
};

export default function SitesPage() {
  return <LookupPage config={config} />;
}
