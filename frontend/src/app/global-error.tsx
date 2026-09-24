"use client";

import "./globals.css";

/**
 * Last-resort boundary for errors thrown by the root layout itself (where
 * `error.tsx` can't help). It replaces the whole document, so it must render
 * its own <html> and <body>.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
        <div role="alert" className="grid max-w-md gap-4 text-center">
          <h1 className="text-title">Something went wrong</h1>
          <p className="text-label">The application failed to load. Please try again.</p>
          <button
            type="button"
            onClick={reset}
            className="mx-auto h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
