"use client";

import { useId, useMemo } from "react";

import type { StaffUser } from "@/types/working-hours";
import { displayName } from "@/lib/auth";
import { SearchCombobox, type ComboOption } from "@/components/common/search-combobox";

/** Searchable team-member picker (filters the preloaded staff list by name or username). */
export function UserPicker({
  users,
  value,
  onChange,
}: {
  users: StaffUser[] | undefined;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const labelId = useId();
  const options = useMemo<ComboOption[]>(
    () =>
      (users ?? []).map((u) => ({
        value: String(u.id),
        label: displayName(u),
        description: `@${u.username}`,
      })),
    [users],
  );
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="text-label shrink-0">
        Viewing:
      </span>
      <SearchCombobox
        aria-labelledby={labelId}
        value={selected}
        onChange={(option) => onChange(option?.value ?? null)}
        options={options}
        placeholder={users ? "Search team members…" : "Loading team…"}
        emptyText="No team members match."
        disabled={!users}
        className="w-60"
      />
    </div>
  );
}
