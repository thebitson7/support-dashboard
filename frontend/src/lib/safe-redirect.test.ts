// The open-redirect guard for "?next=" after sign-in (src/proxy.ts and the
// AppShell). Every value here reaches it straight from a URL an attacker can
// craft, so each bypass that browsers are known to accept is pinned down.

import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  it("defaults to home when there's nothing to go back to", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
  });

  it("keeps a same-origin path with its query and hash", () => {
    expect(safeRedirectPath("/ams-tickets")).toBe("/ams-tickets");
    expect(safeRedirectPath("/audit-log?actor=3&start=2026-09-01#top")).toBe(
      "/audit-log?actor=3&start=2026-09-01#top",
    );
    // A URL inside the query string is just data, not a destination.
    expect(safeRedirectPath("/reports?next=//evil.example")).toBe("/reports?next=//evil.example");
  });

  it("resolves a relative path against the site root", () => {
    expect(safeRedirectPath("job-sheets")).toBe("/job-sheets");
    expect(safeRedirectPath("/lookups/../reports")).toBe("/reports");
  });

  it.each([
    "https://evil.example",
    "http://evil.example/ams-tickets",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "\\/evil.example",
    " //evil.example",
    "\t//evil.example",
    "/\t/evil.example",
    "\n//evil.example",
    "https:evil.example",
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:someone@evil.example",
  ])("sends off-site value %j home instead", (next) => {
    expect(safeRedirectPath(next)).toBe("/");
  });

  it.each(["/.//evil.example", "/a/..//evil.example", "/%2e//evil.example", "/./\\evil.example"])(
    "rejects %j, which only becomes protocol-relative after dot segments resolve",
    (next) => {
      expect(safeRedirectPath(next)).toBe("/");
    },
  );

  it("never returns anything a browser would treat as another origin", () => {
    const tricky = ["/.//x", "//x", "/\\x", "https://x", "/ok", "ok", "/a/../b"];
    for (const next of tricky) {
      const result = safeRedirectPath(next);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
      expect(new URL(result, "https://app.example").origin).toBe("https://app.example");
    }
  });
});
