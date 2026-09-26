// Small building blocks shared by several Lookups pages.

import { Globe } from "lucide-react";

import { Dash } from "@/components/tickets/cells";
import type { OptionSource } from "@/components/lookups/types";

export type ApiCountry = { id: number; name: string; code: string };

/** Countries as select options, alphabetical ("Malaysia (MY)"). */
export const COUNTRY_OPTIONS: OptionSource = {
  endpoint: "/lookups/countries/?ordering=name",
  toOption: (country: ApiCountry) => ({
    value: String(country.id),
    label: `${country.name} (${country.code})`,
  }),
};

/** "Malaysia  MY", or a dash / a "global" label when there's no country. */
export function CountryCell({
  name,
  code,
  globalLabel,
}: {
  name: string | null;
  code: string | null;
  /** Shown instead of a dash when "no country" means "everywhere". */
  globalLabel?: string;
}) {
  if (!name) {
    return globalLabel ? (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Globe className="size-3.5" aria-hidden />
        {globalLabel}
      </span>
    ) : (
      <Dash />
    );
  }
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {name}
      <span className="rounded bg-muted px-1.5 font-mono text-[11px] font-semibold text-muted-foreground">
        {code}
      </span>
    </span>
  );
}

/** Active / Inactive pill (same shape as the ticket status badge). */
export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={
        active
          ? {
              color: "color-mix(in oklab, var(--chart-success), var(--foreground) 45%)",
              backgroundColor: "color-mix(in oklab, var(--chart-success) 14%, transparent)",
            }
          : undefined
      }
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: active ? "var(--chart-success)" : "var(--muted-foreground)" }}
      />
      <span className={active ? undefined : "text-muted-foreground"}>
        {active ? "Active" : "Inactive"}
      </span>
    </span>
  );
}
