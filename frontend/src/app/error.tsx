"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Route-level error boundary. It renders inside the root layout, so a crash in
 * one page keeps the sidebar and theme intact and offers a retry instead of
 * blanking the whole app.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Card
        role="alert"
        className="w-full max-w-md items-center gap-4 px-6 py-8 text-center shadow-elev-1"
      >
        <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
          <TriangleAlert className="size-7" strokeWidth={2} />
        </span>
        <div className="grid gap-1">
          <h1 className="text-title">Something went wrong</h1>
          <p className="text-label">
            This page hit an unexpected error. You can try again, or use the sidebar to go
            elsewhere.
          </p>
          {error.digest && <p className="text-caption mt-1 font-mono">Reference: {error.digest}</p>}
        </div>
        <Button onClick={reset}>Try again</Button>
      </Card>
    </div>
  );
}
