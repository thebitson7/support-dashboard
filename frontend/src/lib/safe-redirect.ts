const PROBE_ORIGIN = "http://same-origin.invalid";

/**
 * Turns a `?next=` value into a same-origin path, or "/" if it points
 * anywhere else. Uses the URL parser rather than string checks because
 * browsers also accept "/\evil.com", tabs/newlines, etc. as off-site URLs.
 *
 * The parsed path is checked too: dot segments are resolved during parsing,
 * so "/.//evil.com" is same-origin here but comes out as "//evil.com", which
 * is protocol-relative (off-site) wherever it's used next.
 */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next) return "/";
  try {
    const url = new URL(next, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
