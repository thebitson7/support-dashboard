"use client";

import { useId, useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, Search } from "lucide-react";

import type { StaffUser } from "@/types/working-hours";
import { displayName } from "@/lib/auth";

type Item = { value: string; label: string; username: string };

// Matches the Select trigger/popup styling (components/ui/select.tsx) so the
// searchable picker reads as the same family of control.
const inputClass =
  "h-9 w-full min-w-0 rounded-lg border border-control bg-card py-1 pr-9 pl-8 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";
const popupClass =
  "max-h-[min(18rem,var(--available-height))] w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
const itemClass =
  "group relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";

/**
 * Searchable team-member picker (filters by name or username as you type).
 * Keyboard: type to filter, ↑/↓ to move, Enter to pick, Esc to close.
 */
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
  const items = useMemo<Item[]>(
    () =>
      (users ?? []).map((u) => ({
        value: String(u.id),
        label: displayName(u),
        username: u.username,
      })),
    [users],
  );
  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="text-label shrink-0">
        Viewing:
      </span>
      <Combobox.Root
        items={items}
        value={selected}
        onValueChange={(item: Item | null) => onChange(item?.value ?? null)}
        itemToStringLabel={(item: Item) => item.label}
        isItemEqualToValue={(a: Item, b: Item) => a.value === b.value}
        filter={(item: Item, query: string) => {
          const q = query.trim().toLowerCase();
          return !q || item.label.toLowerCase().includes(q) || item.username.includes(q);
        }}
        disabled={!users}
      >
        <div className="relative w-60">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Combobox.Input
            aria-labelledby={labelId}
            placeholder={users ? "Search team members…" : "Loading team…"}
            className={inputClass}
          />
          <Combobox.Trigger
            aria-label="Show all team members"
            className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronDownIcon className="size-4" aria-hidden />
          </Combobox.Trigger>
        </div>

        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="isolate z-50">
            <Combobox.Popup className={popupClass}>
              <Combobox.Empty className="px-2 py-3 text-center text-sm text-muted-foreground empty:m-0 empty:p-0">
                No team members match.
              </Combobox.Empty>
              <Combobox.List>
                {(item: Item) => (
                  <Combobox.Item key={item.value} value={item} className={itemClass}>
                    <span className="grid min-w-0">
                      <span className="truncate font-medium">{item.label}</span>
                      <span className="truncate text-xs text-muted-foreground group-data-highlighted:text-accent-foreground">
                        @{item.username}
                      </span>
                    </span>
                    <Combobox.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
                      <CheckIcon className="size-4" aria-hidden />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
