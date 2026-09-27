// Short, safe, human wording for an HTTP failure, keyed only by status.
// Shared by the API client and the server-side gateway, so a response body
// that isn't the API's own JSON (a Django debug page, a proxy's HTML 502)
// is never shown, or even relayed, as an error message.

/** The longest server-supplied message shown as-is; anything longer is replaced. */
const MAX_SERVER_MESSAGE = 300;

export function genericErrorMessage(status: number): string {
  if (status === 0) return "Couldn't reach the server. Check your connection and try again.";
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "Not found.";
  if (status === 413) return "The upload is too large.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status === 502 || status === 503 || status === 504) {
    return "The server is unavailable right now. Try again in a moment.";
  }
  if (status >= 500) return "The server returned an unexpected error.";
  return "The request couldn't be completed.";
}

/** True for a JSON Content-Type ("application/json", "application/problem+json", …). */
export function isJsonContentType(value: string | null): boolean {
  return /^application\/([\w.+-]+\+)?json\b/i.test(value?.trim() ?? "");
}

/**
 * A server message that's fit to show: a plain sentence, not markup, and
 * not a wall of text. Anything else gets the generic wording.
 */
export function safeServerMessage(message: unknown, status: number): string {
  if (typeof message !== "string") return genericErrorMessage(status);
  const text = message.trim();
  if (!text || text.length > MAX_SERVER_MESSAGE || /<[a-z!/]/i.test(text)) {
    return genericErrorMessage(status);
  }
  return text;
}
