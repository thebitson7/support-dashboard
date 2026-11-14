"use client";

import { useId, useState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";

import { describeOverlap, type Overlap } from "@/lib/overlaps";
import { formatDateDisplay } from "@/lib/local-datetime";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/dialog";

export const OVERLAP_EXPLANATION =
  "These times overlap with other work you logged. Overlapping time is counted twice in your hours.";

/** "Activity 1 · Syed Hussain · 4 Nov 2026": which time it is, under each line. */
function context(o: Overlap, showPerson: boolean): string {
  return [
    o.activity ? `Activity ${o.activity}` : null,
    showPerson ? o.person.name : null,
    `${formatDateDisplay(o.date)}, ${o.start}-${o.end}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "Save anyway?" for a save the server refused because its time overlaps
 * other time the same person logged (a 409 with the overlaps listed).
 *
 * It opens on top of the form that tried to save (an alert dialog above the
 * form's dialog, like the "discard changes?" confirmation), so nothing the
 * user entered is lost. Saving needs the box ticked; "Go back and edit" and
 * Escape return to the form; clicking outside does nothing. Focus starts on
 * the checkbox. Mount with a fresh `key` per opening so the box starts clear.
 */
export function OverlapConfirmDialog({
  open,
  overlaps,
  submitting = false,
  onConfirm,
  onBack,
}: {
  open: boolean;
  overlaps: Overlap[];
  submitting?: boolean;
  /** Resend the same request with confirm_overlaps: true. */
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const checkboxId = useId();
  const listId = useId();
  // Name the person only when the overlaps are about more than one.
  const showPerson = new Set(overlaps.map((o) => o.person.id)).size > 1;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onBack();
      }}
    >
      <AlertDialogContent
        className="w-[min(34rem,calc(100vw-2rem))] motion-reduce:transition-none"
        initialFocus={() => document.getElementById(checkboxId)}
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div className="grid gap-1">
            <AlertDialogTitle>Overlapping time</AlertDialogTitle>
            <AlertDialogDescription>{OVERLAP_EXPLANATION}</AlertDialogDescription>
          </div>
        </div>

        <ul
          id={listId}
          aria-label="Overlaps"
          className="scrollbar-styled grid max-h-64 gap-2 overflow-y-auto rounded-lg bg-muted/50 p-3 ring-1 ring-foreground/10"
        >
          {overlaps.map((o, index) => (
            <li key={index} className="grid gap-0.5 text-sm">
              <span className="font-medium break-words">{describeOverlap(o)}</span>
              <span className="text-caption break-words">{context(o, showPerson)}</span>
            </li>
          ))}
        </ul>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
          <Checkbox
            id={checkboxId}
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
            aria-describedby={listId}
            disabled={submitting}
            className="mt-0.5"
          />
          I confirm this overlap is correct
        </label>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
            Go back and edit
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!confirmed || submitting}>
            {submitting && (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            {submitting ? "Saving…" : "Save anyway"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
