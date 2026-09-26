"use client";

import { Building2 } from "lucide-react";

import { TextCell } from "@/components/tickets/cells";
import { LookupPage } from "@/components/lookups/lookup-page";
import type { LookupConfig } from "@/components/lookups/types";

type CustomerRow = { id: number; name: string };

const config: LookupConfig<CustomerRow> = {
  title: "Customers",
  description:
    "The customers tickets are raised for. A customer with tickets can't be deleted until they move to another customer.",
  noun: "customer",
  nounPlural: "customers",
  endpoint: "/lookups/customers/",
  searchPlaceholder: "Search by name…",
  emptyIcon: Building2,
  columns: [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      cell: (r) => <TextCell value={r.name} strong />,
    },
  ],
  defaultSort: { column: "name" },
  fields: [
    {
      kind: "text",
      name: "name",
      label: "Customer name",
      required: true,
      maxLength: 200,
      wide: true,
      hint: "Must be unique (capitalisation doesn't make a new customer).",
    },
  ],
  rowLabel: (r) => r.name,
};

export default function CustomersPage() {
  return <LookupPage config={config} />;
}
