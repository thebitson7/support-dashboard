"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { ApiError, apiDownload } from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * Downloads a CSV export (see apiDownload). Failures are a toast, so the
 * page needs a <Toaster />.
 */
export function ExportButton({
  path,
  fallbackName,
  label = "Export CSV",
  disabled,
  className,
}: {
  /** The export endpoint with the current view's query, e.g. "/tickets/export/?status=open". */
  path: string;
  /** Used if the server doesn't name the file. */
  fallbackName: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      await apiDownload(path, fallbackName);
    } catch (err) {
      toast.error("Couldn't export the CSV", {
        description:
          err instanceof ApiError && err.status !== 0
            ? err.message
            : "Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="lg"
      onClick={() => void download()}
      disabled={disabled || busy}
      aria-busy={busy}
      className={className}
    >
      {busy ? (
        <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <Download aria-hidden />
      )}
      {busy ? "Exporting…" : label}
    </Button>
  );
}
