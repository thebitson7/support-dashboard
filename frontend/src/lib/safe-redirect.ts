const PROBE_ORIGIN = "http://same-origin.invalid";

/**
 * Turns a `?next=` value into a same-origin path, or "/" if it points
 * anywhere else. Uses the URL parser rather than string checks because
 * browsers also accept "/\evil.com", tabs/newlines, etc. as off-site URLs.
 */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next) return "/";
  try {
    const url = new URL(next, PROBE_ORIGIN);
    return url.origin === PROBE_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
