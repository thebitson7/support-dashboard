"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { cn } from "cn";

import {
  daysInMonth,
  formatDateDisplay,
  formatLocal,
  formatLocalDate,
  formatLocalDisplay,
  formatLocalTime,
  formatTimeDisplay,
  from12h,
  nowLocal,
  nowLocalTime,
  parseLocal,
  parseLocalDate,
  parseLocalTime,
  partsOfDate,
  to12h,
  todayLocalDate,
  type LocalParts,
} from "@/lib/local-datetime";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// A date + time picker: a calendar month grid (Monday first) beside hour /
// minute / AM-PM columns. Its value is a local "YYYY-MM-DDTHH:mm" string (or
// ""), the same format the native datetime-local input produced. With
// mode="date" it's a plain date picker: calendar only, value "YYYY-MM-DD".
// With mode="time" it's the time columns only, value "HH:mm".

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTH_FMT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const DAY_LABEL_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

type Day = { year: number; month: number; day: number };

const sameDay = (a: Day | null, b: Day | null) =>
  !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;

/** Day arithmetic through Date, so month/year rollover is always right. */
function addDays(d: Day, delta: number): Day {
  const next = new Date(d.year, d.month - 1, d.day + delta);
  return { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
}

function addMonths(d: Day, delta: number): Day {
  const first = new Date(d.year, d.month - 1 + delta, 1);
  const year = first.getFullYear();
  const month = first.getMonth() + 1;
  // Clamp: 31 Jan + 1 month -> 28/29 Feb, not 3 Mar.
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}

/** The 6×7 grid for a month, Monday-first, including leading/trailing days. */
function monthGrid(year: number, month: number): Day[] {
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays({ year, month, day: 1 }, i - offset));
}

const today = (): Day => {
  const p = partsOfDate(new Date());
  return { year: p.year, month: p.month, day: p.day };
};

function Calendar({ selected, onSelect }: { selected: Day | null; onSelect: (day: Day) => void }) {
  // `focused` is the roving-tabindex day; the visible month follows it.
  const [focused, setFocused] = useState<Day>(selected ?? today());
  const [moveFocus, setMoveFocus] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const now = today();
  const days = monthGrid(focused.year, focused.month);
  const key = (d: Day) => `${d.year}-${d.month}-${d.day}`;

  // After keyboard navigation, move DOM focus to the newly focused day.
  useEffect(() => {
    if (!moveFocus) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key(focused)}"]`)?.focus();
    const id = requestAnimationFrame(() => setMoveFocus(false));
    return () => cancelAnimationFrame(id);
  }, [focused, moveFocus]);

  const navigate = (next: Day) => {
    setFocused(next);
    setMoveFocus(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const weekday = (new Date(focused.year, focused.month - 1, focused.day).getDay() + 6) % 7;
    const moves: Record<string, () => Day> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -weekday),
      End: () => addDays(focused, 6 - weekday),
      PageUp: () => addMonths(focused, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, e.shiftKey ? 12 : 1),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    navigate(move());
  };

  const monthLabel = MONTH_FMT.format(new Date(focused.year, focused.month - 1, 1));

  return (
    <div className="grid w-[16.5rem] content-start gap-2">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => setFocused(addMonths(focused, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <p className="text-sm font-semibold" aria-live="polite">
          {monthLabel}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => setFocused(addMonths(focused, 1))}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={monthLabel}
        onKeyDown={onKeyDown}
        className="grid gap-0.5"
      >
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((d, i) => (
            <span
              key={d}
              role="columnheader"
              aria-label={WEEKDAY_NAMES[i]}
              className="grid h-7 place-items-center text-[11px] font-semibold text-muted-foreground"
            >
              {d}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div key={week} role="row" className="grid grid-cols-7 gap-0.5">
            {days.slice(week * 7, week * 7 + 7).map((d) => {
              const outside = d.month !== focused.month;
              const isSelected = sameDay(d, selected);
              const isToday = sameDay(d, now);
              const isFocused = sameDay(d, focused);
              return (
                <div key={key(d)} role="gridcell" aria-selected={isSelected}>
                  <button
                    type="button"
                    data-day={key(d)}
                    tabIndex={isFocused ? 0 : -1}
                    aria-label={DAY_LABEL_FMT.format(new Date(d.year, d.month - 1, d.day))}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => {
                      setFocused(d);
                      onSelect(d);
                    }}
                    className={cn(
                      "relative grid size-9 w-full place-items-center rounded-lg text-sm tabular-nums outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
                      isSelected
                        ? "bg-primary font-bold text-primary-foreground"
                        : cn(
                            "hover:bg-accent hover:text-accent-foreground",
                            outside && "text-muted-foreground/70",
                            isToday && "font-bold text-foreground ring-1 ring-primary/60",
                          ),
                    )}
                  >
                    {d.day}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A scrollable column of options; the selected one is scrolled into view on mount. */
function TimeColumn<T extends number | boolean>({
  label,
  accessibleLabel = label,
  options,
  value,
  render,
  onSelect,
}: {
  /** Short visible heading ("Min"). */
  label: string;
  /** Full name for assistive tech ("Minute"), when the heading is abbreviated. */
  accessibleLabel?: string;
  options: T[];
  value: T | null;
  render: (option: T) => string;
  onSelect: (option: T) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Centre the selected option by scrolling only this list (scrollIntoView
    // would also scroll the dialog behind the popover).
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (list && item) list.scrollTop = item.offsetTop - (list.clientHeight - item.clientHeight) / 2;
  }, []);

  return (
    <div className="grid content-start gap-1">
      <span className="text-center text-[11px] font-semibold text-muted-foreground">{label}</span>
      <div
        ref={listRef}
        role="group"
        aria-label={accessibleLabel}
        className="scrollbar-styled relative grid max-h-[15.25rem] content-start gap-0.5 overflow-y-auto px-0.5"
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={String(option)}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(option)}
              className={cn(
                "h-8 min-w-11 rounded-md px-2 text-sm tabular-nums outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50",
                selected
                  ? "bg-primary font-bold text-primary-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {render(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateTimePicker({
  id,
  mode = "datetime",
  value,
  onChange,
  onBlur,
  placeholder = mode === "date"
    ? "Select date"
    : mode === "time"
      ? "Select time"
      : "Select date & time",
  clearable,
  invalid,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  /** "date": no time columns, value "YYYY-MM-DD". "time": no calendar, value "HH:mm". */
  mode?: "datetime" | "date" | "time";
  value: string;
  onChange: (value: string) => void;
  /** Called when the picker closes (for touched/validation state). */
  onBlur?: () => void;
  placeholder?: string;
  clearable?: boolean;
  invalid?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  // Bumped by "Now" so the calendar re-opens on the current month.
  const [calendarKey, setCalendarKey] = useState(0);
  const dateOnly = mode === "date";
  const timeOnly = mode === "time";
  const parts = dateOnly
    ? parseLocalDate(value)
    : timeOnly
      ? parseLocalTime(value)
      : parseLocal(value);
  const selectedDay: Day | null = parts
    ? { year: parts.year, month: parts.month, day: parts.day }
    : null;
  const time = parts ? to12h(parts.hour) : null;

  // Any change fills in what's missing from "now" (a day picked first gets
  // the current time; a time picked first gets today's date).
  const update = (patch: Partial<LocalParts>) => {
    const base = parts ?? partsOfDate(new Date());
    const next = { ...base, ...patch };
    onChange(
      dateOnly ? formatLocalDate(next) : timeOnly ? formatLocalTime(next) : formatLocal(next),
    );
  };
  const setHour12 = (hour12: number) => update({ hour: from12h(hour12, time?.pm ?? false) });
  const setPm = (pm: boolean) =>
    update({ hour: from12h(time?.hour12 ?? to12h(new Date().getHours()).hour12, pm) });

  const display = dateOnly
    ? formatDateDisplay(value)
    : timeOnly
      ? formatTimeDisplay(value)
      : formatLocalDisplay(value);
  const TriggerIcon = timeOnly ? Clock : CalendarDays;
  const close = () => {
    setOpen(false);
    onBlur?.();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <div className="relative">
        <PopoverTrigger
          id={id}
          // Name = field label + current value, e.g. "Received … 24 Sep 2026, 2:30 PM".
          aria-labelledby={ariaLabelledBy && id ? `${ariaLabelledBy} ${id}` : ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-control bg-card py-1 pr-9 pl-2.5 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-popup-open:border-ring dark:bg-input/30 dark:aria-invalid:border-destructive/50",
          )}
        >
          <TriggerIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className={cn("truncate tabular-nums", !display && "text-muted-foreground")}>
            {display || placeholder}
          </span>
        </PopoverTrigger>
        {clearable && value && (
          <button
            type="button"
            aria-label={timeOnly ? "Clear time" : dateOnly ? "Clear date" : "Clear date and time"}
            onClick={() => onChange("")}
            className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <PopoverContent
        align="start"
        sideOffset={6}
        // Same fade + slight scale as the app's other popovers (tw-animate,
        // EASE curve); none at all for reduced motion.
        className="w-auto max-w-[calc(100vw-2rem)] gap-3 p-3 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none"
        aria-label={
          dateOnly ? "Choose a date" : timeOnly ? "Choose a time" : "Choose date and time"
        }
        ref={popupRef}
        // Start on the selected (or today's) day, ready for arrow keys; with
        // no calendar, on the selected hour (or the first one).
        initialFocus={() =>
          popupRef.current?.querySelector<HTMLElement>(
            timeOnly
              ? '[role="group"] button[aria-pressed="true"], [role="group"] button'
              : '[role="grid"] button[tabindex="0"]',
          ) ?? true
        }
      >
        <div className="flex flex-wrap gap-3">
          {!timeOnly && (
            <Calendar
              key={calendarKey}
              selected={selectedDay}
              onSelect={(d) => {
                update(d);
                // A date alone is the whole answer: done.
                if (dateOnly) close();
              }}
            />
          )}
          {!dateOnly && (
            <div className={cn("flex gap-1", !timeOnly && "border-l border-border pl-3")}>
              <TimeColumn
                label="Hour"
                options={HOURS_12}
                value={time?.hour12 ?? null}
                render={String}
                onSelect={setHour12}
              />
              <TimeColumn
                label="Min"
                accessibleLabel="Minute"
                options={MINUTES}
                value={parts?.minute ?? null}
                render={(m) => String(m).padStart(2, "0")}
                onSelect={(minute) => update({ minute })}
              />
              <TimeColumn
                label="AM/PM"
                accessibleLabel="AM or PM"
                options={[false, true]}
                value={time?.pm ?? null}
                render={(pm) => (pm ? "PM" : "AM")}
                onSelect={setPm}
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(dateOnly ? todayLocalDate() : timeOnly ? nowLocalTime() : nowLocal());
              setCalendarKey((k) => k + 1);
            }}
          >
            {dateOnly ? "Today" : "Now"}
          </Button>
          <p className="text-caption min-w-0 truncate tabular-nums" aria-live="polite">
            {display || (timeOnly ? "No time chosen" : "No date chosen")}
          </p>
          <Button type="button" size="sm" onClick={close}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
