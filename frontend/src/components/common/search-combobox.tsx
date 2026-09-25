"use client";

import { useEffect, useMemo, useState, type Ref } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, LoaderCircle, Search, X } from "lucide-react";
import { cn } from "cn";

export type ComboOption = {
  value: string;
  label: string;
  /** A second, quieter line (e.g. "@username" or an OCN). */
  description?: string;
};

const SEARCH_DEBOUNCE_MS = 200;

// Matches the Select trigger/popup styling (components/ui/select.tsx) so the
// searchable fields read as the same family of control.
const inputClass =
  "h-9 w-full min-w-0 rounded-lg border border-control bg-card py-1 pr-16 pl-8 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";
const popupClass =
  "max-h-[min(18rem,var(--available-height))] w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
const itemClass =
  "group relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";
const iconButton =
  "grid w-8 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

function matches(option: ComboOption, query: string) {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    option.label.toLowerCase().includes(q) ||
    Boolean(option.description?.toLowerCase().includes(q))
  );
}

/** Debounced, cancellable server search driven by what the user types. */
function useRemoteOptions(
  load: ((query: string, signal: AbortSignal) => Promise<ComboOption[]>) | undefined,
  query: string,
  open: boolean,
) {
  const [state, setState] = useState<{ key: string; options: ComboOption[]; failed: boolean }>();
  const key = `${open}:${query}`;

  useEffect(() => {
    if (!load || !open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      load(query.trim(), controller.signal).then(
        (options) => setState({ key, options, failed: false }),
        () => {
          if (!controller.signal.aborted) setState({ key, options: [], failed: true });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, query, open, key]);

  const settled = state?.key === key ? state : undefined;
  return {
    // While a new query is in flight, keep the previous results on screen.
    options: state?.options ?? [],
    loading: Boolean(load && open && !settled),
    failed: settled?.failed ?? false,
  };
}

/**
 * A searchable single-select. Give it either `options` (filtered locally as
 * you type) or `loadOptions` (queried on the server, debounced, cancelling
 * stale requests). Keyboard: type to filter, ↑/↓ to move, Enter to pick,
 * Esc to close.
 */
export function SearchCombobox({
  id,
  value,
  onChange,
  options,
  loadOptions,
  placeholder = "Search…",
  emptyText = "No matches.",
  disabled,
  invalid,
  clearable,
  onBlur,
  inputRef,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  value: ComboOption | null;
  onChange: (option: ComboOption | null) => void;
  options?: ComboOption[];
  loadOptions?: (query: string, signal: AbortSignal) => Promise<ComboOption[]>;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Shows an × to empty the field (for optional fields). */
  clearable?: boolean;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const remote = useRemoteOptions(loadOptions, query, open);

  const items = useMemo(() => {
    const list = loadOptions ? remote.options : (options ?? []);
    // Keep the current value selectable/visible even if the latest search
    // results don't include it.
    return value && !list.some((o) => o.value === value.value) ? [value, ...list] : list;
  }, [loadOptions, remote.options, options, value]);

  return (
    <Combobox.Root
      items={items}
      value={value}
      onValueChange={(option: ComboOption | null) => onChange(option)}
      itemToStringLabel={(option: ComboOption) => option.label}
      isItemEqualToValue={(a: ComboOption, b: ComboOption) => a.value === b.value}
      // Server search already filtered the list.
      filter={loadOptions ? null : matches}
      open={open}
      onOpenChange={setOpen}
      onInputValueChange={(text, details) => {
        // Only real typing is a search; picking an item also rewrites the
        // input (to its label) and must not trigger a query for that label.
        setQuery(details.reason === "input-change" ? text : "");
      }}
      disabled={disabled}
    >
      <div className={cn("relative", className)}>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Combobox.Input
          id={id}
          ref={inputRef}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={invalid || undefined}
          onBlur={onBlur}
          className={inputClass}
        />
        <div className="absolute inset-y-0 right-0 flex">
          {remote.loading ? (
            <span className="grid w-8 place-items-center text-muted-foreground" aria-hidden>
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            </span>
          ) : (
            clearable &&
            value && (
              <Combobox.Clear aria-label="Clear selection" className={iconButton}>
                <X className="size-4" aria-hidden />
              </Combobox.Clear>
            )
          )}
          <Combobox.Trigger aria-label="Show options" className={cn(iconButton, "rounded-r-lg")}>
            <ChevronDownIcon className="size-4" aria-hidden />
          </Combobox.Trigger>
        </div>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-[70]">
          <Combobox.Popup className={popupClass} aria-busy={remote.loading || undefined}>
            <Combobox.Empty className="px-2 py-3 text-center text-sm text-muted-foreground empty:m-0 empty:p-0">
              {remote.failed
                ? "Couldn't load results. Try typing again."
                : remote.loading
                  ? "Searching…"
                  : emptyText}
            </Combobox.Empty>
            <Combobox.List>
              {(option: ComboOption) => (
                <Combobox.Item key={option.value} value={option} className={itemClass}>
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">{option.label}</span>
                    {option.description && (
                      <span className="truncate text-xs text-muted-foreground group-data-highlighted:text-accent-foreground">
                        {option.description}
                      </span>
                    )}
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
  );
}
